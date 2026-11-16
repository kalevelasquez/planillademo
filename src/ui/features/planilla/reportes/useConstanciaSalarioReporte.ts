import { useEffect, useState } from 'react';
import { supabase } from '../../../../config/supabaseClient';
import { calculoPlanillaService } from '../../../../services/calculoPlanillaService';
import { quincenasService, type Quincena } from '../../../../services/quincenasService';
import { descuentosService } from '../../../../services/descuentosService';
import { descuentoCategoriasService } from '../../../../services/descuentoCategoriasService';
import { planillaEmpleadosService } from '../../../../services/planillaEmpleadosService';
import { seleccionarQuincenasElegibles, calcularConstanciaSalarioDatos, type ConstanciaSalarioDatos } from '../../../../utils/constanciaSalarioUtils';
import type { ConfigFiscal, TramoRenta } from '../../../../utils/calculoPlanillaUtils';
import { Logger } from '../../../../utils/logger';

type EmpleadoReporte = Awaited<ReturnType<typeof planillaEmpleadosService.getEmpleadosParaReportes>>[number];

/**
 * IMPL-184 — config fiscal + tramos de Renta (frecuencia quincenal) vigentes A LA FECHA DE
 * EMISIÓN (hoy), para recalcular ISSS/AFP/Renta teóricamente sobre los ingresos que la Constancia
 * ya muestra. Mismo criterio de vigencia por fecha que usa el motor real
 * (`calcular_planilla_empleado`) y `exportacionesContablesService.obtenerTasasVigentes` — sin
 * filtro explícito de `tenant_id`: RLS ya lo resuelve por sesión, mismo patrón que ese service.
 */
async function obtenerConfigFiscalYTramosVigentes(): Promise<{ config: ConfigFiscal; tramos: TramoRenta[] }> {
    const hoy = new Date().toISOString().slice(0, 10);

    const { data: config, error: errorConfig } = await supabase
        .from('planilla_config_fiscal')
        .select('isss_tasa_empleado, isss_tope_base, afp_tasa_empleado, afp_tope_base, deduccion_fija_anual, deduccion_fija_tope_ingreso_anual, bono10_tasa, tope_descuentos_no_obligatorios_pct, salario_minimo_inembargable')
        .lte('vigente_desde', hoy)
        .or(`vigente_hasta.is.null,vigente_hasta.gte.${hoy}`)
        .order('vigente_desde', { ascending: false })
        .limit(1)
        .single();
    if (errorConfig) throw errorConfig;

    const { data: vigenteDesdeRow, error: errorVigente } = await supabase
        .from('planilla_renta_tramos')
        .select('vigente_desde')
        .lte('vigente_desde', hoy)
        .order('vigente_desde', { ascending: false })
        .limit(1)
        .single();
    if (errorVigente) throw errorVigente;

    const { data: tramos, error: errorTramos } = await supabase
        .from('planilla_renta_tramos')
        .select('orden, desde, hasta, tasa_pct, exceso_sobre, monto_fijo')
        .eq('vigente_desde', vigenteDesdeRow.vigente_desde)
        .eq('periodo', 'quincenal')
        .order('orden');
    if (errorTramos) throw errorTramos;

    return {
        config: {
            isssTasaEmpleado: config.isss_tasa_empleado,
            isssTopeBase: config.isss_tope_base,
            afpTasaEmpleado: config.afp_tasa_empleado,
            afpTopeBase: config.afp_tope_base,
            deduccionFijaAnual: config.deduccion_fija_anual,
            deduccionFijaTopeIngresoAnual: config.deduccion_fija_tope_ingreso_anual,
            bono10Tasa: config.bono10_tasa,
            topeDescuentosNoObligatoriosPct: config.tope_descuentos_no_obligatorios_pct,
            salarioMinimoInembargable: config.salario_minimo_inembargable,
        },
        tramos: (tramos ?? []).map((t) => ({
            orden: t.orden,
            desde: t.desde,
            hasta: t.hasta,
            tasaPct: t.tasa_pct,
            excesoSobre: t.exceso_sobre,
            montoFijo: t.monto_fijo,
        })),
    };
}

/**
 * Hook de la Constancia de Salario (US-EXP-04, IMPL-157). Carga empleados + quincenas + config
 * fiscal/tramos una sola vez; al generar para un empleado puntual, filtra las quincenas elegibles
 * PARA ESE EMPLEADO (IMPL-182 — depende de su fecha_ingreso), consulta los snapshots ya
 * persistidos por `calculoPlanillaService` para Ingresos, y RECALCULA teóricamente ISSS/AFP/Renta
 * sobre esos mismos ingresos (IMPL-184) — ver `calcularConstanciaSalarioDatos` para el detalle.
 */
export function useConstanciaSalarioReporte() {
    const [empleados, setEmpleados] = useState<EmpleadoReporte[]>([]);
    // IMPL-182 — todas las quincenas del tenant, sin filtrar todavía: la elegibilidad depende de
    // la fecha_ingreso de CADA empleado, así que el filtro se aplica por empleado en
    // `generarDatos`, no una sola vez acá (antes `ventana` se calculaba una sola vez al montar,
    // sin conocer todavía para quién se iba a generar la constancia).
    const [quincenasTenant, setQuincenasTenant] = useState<Quincena[]>([]);
    const [configFiscal, setConfigFiscal] = useState<ConfigFiscal | null>(null);
    const [tramosRenta, setTramosRenta] = useState<TramoRenta[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            planillaEmpleadosService.getEmpleadosParaReportes(),
            quincenasService.getQuincenas(),
            obtenerConfigFiscalYTramosVigentes(),
        ])
            .then(([empleadosData, quincenas, fiscal]) => {
                setEmpleados(empleadosData);
                setQuincenasTenant(quincenas);
                setConfigFiscal(fiscal.config);
                setTramosRenta(fiscal.tramos);
            })
            .catch((err: unknown) => Logger.error('Error al cargar datos base de Constancia de Salario', {}, err))
            .finally(() => setIsLoading(false));
    }, []);

    const generarDatos = async (empleado: EmpleadoReporte): Promise<ConstanciaSalarioDatos> => {
        if (!configFiscal) throw new Error('Configuración fiscal todavía no cargada');
        const ventana = seleccionarQuincenasElegibles(quincenasTenant, empleado.fecha_ingreso);
        const idsVentana = ventana.map((q) => q.id);
        const [calculosVentanaCompleta, descuentosEmpleado, categorias] = await Promise.all([
            calculoPlanillaService.getPorQuincenas(idsVentana),
            descuentosService.getPorEmpleado(empleado.id),
            descuentoCategoriasService.getTodos(),
        ]);
        const calculosEnVentana = calculosVentanaCompleta
            .filter((c) => c.empleado_id === empleado.id)
            .sort((a, b) => {
                const qa = ventana.findIndex((q) => q.id === a.quincena_id);
                const qb = ventana.findIndex((q) => q.id === b.quincena_id);
                return qa - qb;
            });

        return calcularConstanciaSalarioDatos(empleado, calculosEnVentana, descuentosEmpleado, categorias, configFiscal, tramosRenta);
    };

    return { empleados, isLoading, generarDatos };
}
