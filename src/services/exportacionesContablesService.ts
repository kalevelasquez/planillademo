import { supabase } from '../config/supabaseClient';
import { calculoPlanillaService, type CalculoEmpleado } from './calculoPlanillaService';
import { planillaEmpleadosService } from './planillaEmpleadosService';
import { departamentosService } from './departamentosService';
import { round2 } from '../utils/calculoPlanillaUtils';

export interface FilaCsvIsss {
    dui: string;
    nombre: string;
    salarioBase: number;
    cotizacionEmpleado: number;
    cotizacionPatronal: number;
    observacion: string;
}

export interface FilaCsvAfp {
    numeroAfiliacion: string;
    nombre: string;
    salarioBase: number;
    cotizacionEmpleado: number;
    cotizacionPatronal: number;
}

export interface FilaCuotaPatronal {
    codigoEmpleado: string;
    nombreEmpleado: string;
    isssPatronal: number;
    afpPatronal: number;
    insaforpPatronal: number;
    totalPatronal: number;
}

export interface LineaPartidaDiario {
    cuenta: string;
    concepto: string;
    tipo: 'debito' | 'credito';
    monto: number;
}

export interface TasasVigentes {
    isssTasaEmpleado: number;
    isssTasaPatronal: number;
    afpTasaEmpleado: number;
    afpTasaPatronal: number;
    /** Bugfix (auditoría, hallazgo menor): faltaban los topes de base — sin ellos,
     * `generarFilasIsss`/`generarFilasAfp` no tenían forma de reproducir el mismo tope que ya
     * aplica `calcular_planilla_empleado` (`isss_tope_base`/`afp_tope_base` en
     * `planilla_config_fiscal`) al exportar el "Salario Base". */
    isssTopeBase: number;
    afpTopeBase: number | null;
}

/** US-EXP-02 (IMPL-100) CA3 — las incapacidades registradas (Lote 5) son la fuente directa de
 * "observación"; no hay una tabla de códigos oficiales ISSS, se usa el `tipo` tal cual (propuesta
 * inicial, IMPL-99 CA2 exige validar contra el portal real). */
const OBSERVACION_POR_TIPO: Record<string, string> = {
    enfermedad_comun: 'Enfermedad Común',
    accidente_trabajo: 'Accidente de Trabajo',
    maternidad: 'Maternidad',
};

export const exportacionesContablesService = {
    /** Tasas ISSS/AFP realmente vigentes a la fecha de fin de la quincena (revisión de
     * arquitectura del PM) — antes los encabezados de `handleExportarIsss`/`handleExportarAfp`
     * traían el % como texto fijo; si `planilla_config_fiscal` cambiaba de tasa, el archivo
     * exportado a la institución quedaba con un encabezado incorrecto aunque el monto sí fuera
     * correcto. Misma resolución de vigencia por fecha que usa `calcular_planilla_empleado`. */
    async obtenerTasasVigentes(quincenaId: string): Promise<TasasVigentes> {
        const { data: quincena, error: errorQuincena } = await supabase
            .from('quincenas')
            .select('fecha_fin')
            .eq('id', quincenaId)
            .single();
        if (errorQuincena) throw errorQuincena;

        const { data: config, error: errorConfig } = await supabase
            .from('planilla_config_fiscal')
            .select('isss_tasa_empleado, isss_tasa_patronal, afp_tasa_empleado, afp_tasa_patronal, isss_tope_base, afp_tope_base')
            .lte('vigente_desde', quincena.fecha_fin)
            .or(`vigente_hasta.is.null,vigente_hasta.gte.${quincena.fecha_fin}`)
            .order('vigente_desde', { ascending: false })
            .limit(1)
            .single();
        if (errorConfig) throw errorConfig;

        return {
            isssTasaEmpleado: config.isss_tasa_empleado,
            isssTasaPatronal: config.isss_tasa_patronal,
            afpTasaEmpleado: config.afp_tasa_empleado,
            afpTasaPatronal: config.afp_tasa_patronal,
            isssTopeBase: config.isss_tope_base,
            afpTopeBase: config.afp_tope_base,
        };
    },

    /** US-EXP-01 (IMPL-99) CA1 + US-EXP-02 (IMPL-100) CA1/CA2 — una línea por empleado, y una
     * línea ADICIONAL por cada observación (incapacidad) más allá de la primera, repitiendo
     * todos los demás datos idénticos.
     *
     * Bugfix (auditoría, hallazgo menor): "Salario Base" exportaba `total_ingresos_gravables` SIN
     * topar, pero `cotizacionEmpleado` (`isss_empleado`) ya viene calculada por
     * `calcular_planilla_empleado` sobre `MIN(total_gravable, isss_tope_base)` — dos columnas
     * lado a lado que no cuadraban entre sí cuando el sueldo superaba el tope (la cotización no
     * escalaba con el "salario base" mostrado). Ahora se topa acá con la misma tasa vigente que
     * ya resuelve `obtenerTasasVigentes` (misma resolución por fecha que usa el motor real). */
    async generarFilasIsss(quincenaId: string): Promise<FilaCsvIsss[]> {
        const [{ data: calculos, error: errorCalculos }, { data: incapacidades, error: errorIncap }, tasas] = await Promise.all([
            supabase.from('planilla_calculo_empleado').select('empleado_id, total_ingresos_gravables, isss_empleado, isss_patronal').eq('quincena_id', quincenaId),
            supabase.from('planilla_incapacidades').select('empleado_id, tipo').eq('quincena_id', quincenaId),
            exportacionesContablesService.obtenerTasasVigentes(quincenaId),
        ]);
        if (errorCalculos) throw errorCalculos;
        if (errorIncap) throw errorIncap;

        const empleadoIds = (calculos || []).map((c) => c.empleado_id);
        if (empleadoIds.length === 0) return [];

        const { data: empleados, error: errorEmpleados } = await supabase
            .from('planilla_empleados')
            .select('id, nombre_completo, dui')
            .in('id', empleadoIds);
        if (errorEmpleados) throw errorEmpleados;

        const empleadoPorId = new Map((empleados || []).map((e) => [e.id, e]));
        const observacionesPorEmpleado = new Map<string, string[]>();
        (incapacidades || []).forEach((inc) => {
            const lista = observacionesPorEmpleado.get(inc.empleado_id) ?? [];
            lista.push(OBSERVACION_POR_TIPO[inc.tipo] ?? inc.tipo);
            observacionesPorEmpleado.set(inc.empleado_id, lista);
        });

        const filas: FilaCsvIsss[] = [];
        for (const c of calculos || []) {
            const emp = empleadoPorId.get(c.empleado_id);
            const observaciones = observacionesPorEmpleado.get(c.empleado_id) ?? [''];
            const salarioBase = round2(Math.min(c.total_ingresos_gravables, tasas.isssTopeBase));
            for (const observacion of observaciones) {
                filas.push({
                    dui: emp?.dui ?? '',
                    nombre: emp?.nombre_completo ?? c.empleado_id,
                    salarioBase,
                    cotizacionEmpleado: c.isss_empleado,
                    cotizacionPatronal: c.isss_patronal,
                    observacion,
                });
            }
        }
        return filas;
    },

    /** US-EXP-01 (IMPL-99) CA1 — un archivo por AFP (Crecer/Confía), cada empleado va en el de
     * su afiliación registrada.
     *
     * Bugfix (auditoría, hallazgo menor): mismo problema que `generarFilasIsss` — "Salario Base"
     * exportaba `total_ingresos_gravables` sin topar, mientras `cotizacionEmpleado` (`afp_empleado`)
     * ya se calculó sobre el tope AFP vigente (`afp_tope_base`, NULL desde 2023 — sin tope). Se
     * topa acá igual que el motor real (`LEAST` si hay tope, sin cambios si no lo hay). */
    async generarFilasAfp(quincenaId: string, tipoAfiliacion: 'afp_crecer' | 'afp_confia'): Promise<FilaCsvAfp[]> {
        const [{ data: calculos, error: errorCalculos }, tasas] = await Promise.all([
            supabase.from('planilla_calculo_empleado').select('empleado_id, total_ingresos_gravables, afp_empleado, afp_patronal').eq('quincena_id', quincenaId),
            exportacionesContablesService.obtenerTasasVigentes(quincenaId),
        ]);
        if (errorCalculos) throw errorCalculos;

        const empleadoIds = (calculos || []).map((c) => c.empleado_id);
        if (empleadoIds.length === 0) return [];

        const { data: empleados, error: errorEmpleados } = await supabase
            .from('planilla_empleados')
            .select('id, nombre_completo, numero_afiliacion_afp, tipo_afiliacion')
            .in('id', empleadoIds)
            .eq('tipo_afiliacion', tipoAfiliacion);
        if (errorEmpleados) throw errorEmpleados;

        const empleadoPorId = new Map((empleados || []).map((e) => [e.id, e]));
        return (calculos || [])
            .filter((c) => empleadoPorId.has(c.empleado_id))
            .map((c) => {
                const emp = empleadoPorId.get(c.empleado_id)!;
                const salarioBase = tasas.afpTopeBase != null
                    ? round2(Math.min(c.total_ingresos_gravables, tasas.afpTopeBase))
                    : c.total_ingresos_gravables;
                return {
                    numeroAfiliacion: emp.numero_afiliacion_afp ?? '',
                    nombre: emp.nombre_completo,
                    salarioBase,
                    cotizacionEmpleado: c.afp_empleado,
                    cotizacionPatronal: c.afp_patronal,
                };
            });
    },

    /** US-EXP-00 (IMPL-98) CA1, rediseñado (respuesta Imporfrut pregunta 8, 2026-10-02): el
     * ejemplo real de partida contable que compartieron reveló que cada concepto de GASTO tiene
     * una cuenta DISTINTA por grupo de costos (Administración/Ventas/Operaciones, IMPL-167) —
     * no una sola cuenta agregada por tenant como asumía la versión anterior. Ahora se desglosa
     * por grupo_costos del departamento del empleado y se resuelve contra el catálogo
     * configurable `planilla_catalogo_cuentas_contables` (ver migración 20261002100000 para qué
     * está sembrado y qué sigue pendiente de confirmar con Imporfrut).
     *
     * El lado de CRÉDITO (retenciones por institución, banco de desembolso, anticipos por
     * empleado) sigue con los códigos genéricos de la PROPUESTA INICIAL — esa parte del
     * documento real no se pudo transcribir con confianza (es una imagen escaneada, no texto),
     * queda pendiente para cuando se consiga una fuente más confiable o Imporfrut lo confirme.
     * Pregunta 8-a (2026-10-27): el banco de desembolso NO es fijo — Cuscatlán es el principal,
     * pero Imporfrut confirmó que puede variar por empleado (excepciones con saldos pendientes
     * en otro banco) "y esta dinámica puede continuar". No hay un criterio único que modelar acá;
     * queda sin cablear a propósito, no se inventa una regla donde Imporfrut mismo confirmó que
     * no la hay.
     *
     * Viáticos (Pregunta 8-b, 2026-10-27): "Gasto Depr. y Combustible Vendedores" SÍ es parte de
     * los Viáticos (confirmado con casos reales: Rina Manzo $125, Manuel Martínez $30, Melvin
     * Sánchez $30 — todos viáticos `tipo='fijo'`), pero Imporfrut los registra en su PROPIA
     * cuenta separada — se desglosa esa parte (`viaticosFijosPorEmpleado`) de la línea genérica
     * de Viáticos, que ahora solo lleva el resto (variable/ruta/kilometraje).
     *
     * Si falta una cuenta en el catálogo para un (concepto, grupo_costos) con monto != 0, se
     * emite igual una línea con cuenta 'PENDIENTE_CONFIGURAR' en vez de omitirla — así el total
     * de la partida sigue cuadrando y el hueco queda visible en el archivo exportado. */
    async generarPartidaDiario(quincenaId: string): Promise<LineaPartidaDiario[]> {
        const calculos = await calculoPlanillaService.getPorQuincena(quincenaId);
        const empleadoIds = new Set(calculos.map((c) => c.empleado_id));

        const [empleados, departamentos, { data: catalogoData, error: errorCatalogo }, { data: viaticosFijosData, error: errorViaticosFijos }] = await Promise.all([
            planillaEmpleadosService.getEmpleadosParaReportes(),
            departamentosService.getDepartamentos(),
            supabase.from('planilla_catalogo_cuentas_contables').select('concepto, grupo_costos, cuenta_codigo, cuenta_nombre'),
            // Pregunta 8 (b), confirmado por Imporfrut 2026-10-27: "Gasto Depr. y Combustible
            // Vendedores" ya forma parte de los Viáticos, pero se registra en su PROPIA cuenta,
            // separada del resto — casos reales citados: Rina Eleonora Manzo ($125 fijo), Manuel
            // Ángel Martínez ($30) y Melvin Fernando Sánchez ($30). Son viáticos `tipo='fijo'` —
            // el resto (variable, por ruta, kilometraje) sigue yendo a la cuenta genérica
            // "Viáticos" de siempre.
            supabase.from('planilla_viaticos_fijos_variables').select('empleado_id, monto').eq('quincena_id', quincenaId).eq('tipo', 'fijo'),
        ]);
        if (errorCatalogo) throw errorCatalogo;
        if (errorViaticosFijos) throw errorViaticosFijos;

        const viaticosFijosPorEmpleado = new Map<string, number>();
        for (const v of viaticosFijosData || []) {
            viaticosFijosPorEmpleado.set(v.empleado_id, round2((viaticosFijosPorEmpleado.get(v.empleado_id) ?? 0) + v.monto));
        }

        const grupoCostosPorDepartamento = new Map(departamentos.map((d) => [d.nombre.trim(), d.grupo_costos]));
        const empleadosPorId = new Map(empleados.filter((e) => empleadoIds.has(e.id)).map((e) => [e.id, e]));
        const grupoCostosDeEmpleado = (empleadoId: string): string => {
            const depto = empleadosPorId.get(empleadoId)?.departamento?.trim();
            return (depto && grupoCostosPorDepartamento.get(depto)) || 'SIN CLASIFICAR';
        };

        const cuentaPorConceptoYGrupo = new Map(
            (catalogoData || []).map((c) => [`${c.concepto}::${c.grupo_costos}`, { cuenta: c.cuenta_codigo, nombre: c.cuenta_nombre }])
        );

        const sum = (fn: (c: CalculoEmpleado) => number) => calculos.reduce((s, c) => s + fn(c), 0);
        const totalAnticipos = sum((c) =>
            c.descuentos_detalle.filter((d) => d.categoria === 'Anticipo de salario').reduce((s, d) => s + d.aplicado, 0)
        );

        /** Una línea por grupo_costos con monto != 0 para este concepto de gasto, resuelta
         * contra el catálogo (o 'PENDIENTE_CONFIGURAR' si ese grupo todavía no tiene cuenta). */
        const lineasPorGrupoCostos = (concepto: string, nombreGenerico: string, fn: (c: CalculoEmpleado) => number): LineaPartidaDiario[] => {
            const porGrupo = new Map<string, number>();
            for (const c of calculos) {
                const grupo = grupoCostosDeEmpleado(c.empleado_id);
                porGrupo.set(grupo, round2((porGrupo.get(grupo) ?? 0) + fn(c)));
            }
            return [...porGrupo.entries()]
                .filter(([, monto]) => monto !== 0)
                .map(([grupo, monto]) => {
                    const match = cuentaPorConceptoYGrupo.get(`${concepto}::${grupo}`);
                    return {
                        cuenta: match?.cuenta ?? 'PENDIENTE_CONFIGURAR',
                        concepto: `${nombreGenerico} — ${grupo}`,
                        tipo: 'debito' as const,
                        monto,
                    };
                });
        };

        const vacacionesCuenta = cuentaPorConceptoYGrupo.get('vacaciones::');

        return [
            ...lineasPorGrupoCostos('sueldos', 'Gasto Sueldos y Salarios', (c) => c.sueldo_proporcional),
            ...lineasPorGrupoCostos('horas_extras', 'Gasto Horas Extras', (c) => c.horas_extras_monto),
            // Viáticos fijos (confirmado por Imporfrut, Pregunta 8-b) van a su propia cuenta
            // "Gasto Depr. y Combustible Vendedores"; el resto (variable/ruta/kilometraje) sigue
            // en la cuenta genérica "Viáticos" de siempre — ver fetch de viaticosFijosPorEmpleado.
            ...lineasPorGrupoCostos('combustible_depreciacion_vendedores', 'Gasto Depr. y Combustible Vendedores', (c) => viaticosFijosPorEmpleado.get(c.empleado_id) ?? 0),
            ...lineasPorGrupoCostos('viaticos', 'Gasto Viáticos', (c) => round2(c.viaticos_monto - (viaticosFijosPorEmpleado.get(c.empleado_id) ?? 0))),
            ...lineasPorGrupoCostos('bonificaciones', 'Gasto Bonificaciones', (c) => c.bonificaciones_monto),
            // Bugfix (hallazgo UAT 2026-11-04): IMPL-178 (`20260925110000_fix_bono10_no_sumaba_al_neto.sql`)
            // agregó `vacaciones_bono10_base`/`otros_ingresos_bono10_base`/`incapacidad_bono10_base` al
            // NETO A PAGAR (crédito "Sueldos por Pagar"), pero nunca se sumaron acá del lado del débito —
            // esa plata salía por un lado y no entraba por el otro, descuadrando la Partida. `viaticos_monto`
            // no necesita el mismo ajuste: `viaticos_bono10_base` ya viene mezclado adentro desde el motor.
            { cuenta: vacacionesCuenta?.cuenta ?? 'PENDIENTE_CONFIGURAR', concepto: 'Gasto Vacaciones', tipo: 'debito', monto: round2(sum((c) => c.vacaciones_monto + c.vacaciones_bono10_base)) },
            { cuenta: '5122', concepto: 'Gasto Otros Ingresos', tipo: 'debito', monto: round2(sum((c) => c.otros_ingresos_gravables + c.otros_ingresos_no_gravables + c.otros_ingresos_bono10_base + c.incapacidad_bono10_base)) },
            ...lineasPorGrupoCostos('isss_patronal', 'Gasto ISSS Patronal', (c) => c.isss_patronal),
            // IPSFA (IMPL-87) y AFP son afiliaciones mutuamente excluyentes — mismo criterio que ya usa
            // `ResumenFinancieroSection.tsx` para sumarlas juntas, en vez de abrir una cuenta aparte.
            ...lineasPorGrupoCostos('afp_patronal', 'Gasto AFP Patronal', (c) => c.afp_patronal + c.ipsfa_patronal),
            ...lineasPorGrupoCostos('insaforp_patronal', 'Gasto INSAFORP', (c) => c.insaforp_patronal),
            { cuenta: '2110', concepto: 'Sueldos por Pagar', tipo: 'credito', monto: round2(sum((c) => c.neto_a_pagar)) },
            { cuenta: '2115', concepto: 'ISSS por Pagar', tipo: 'credito', monto: round2(sum((c) => c.isss_empleado + c.isss_patronal)) },
            { cuenta: '2120', concepto: 'AFP por Pagar', tipo: 'credito', monto: round2(sum((c) => c.afp_empleado + c.ipsfa_empleado + c.afp_patronal + c.ipsfa_patronal)) },
            { cuenta: '2125', concepto: 'ISR por Pagar', tipo: 'credito', monto: round2(sum((c) => c.renta_isr + c.renta_bono10)) },
            { cuenta: '2130', concepto: 'Anticipos Descontados', tipo: 'credito', monto: round2(totalAnticipos) },
            // Bugfix (hallazgo UAT 2026-11-04): INSAFORP es 100% patronal (no hay cuota de empleado,
            // a diferencia de ISSS/AFP) y nunca tuvo su contraparte de pasivo — el gasto se debitaba
            // arriba pero no existía ningún crédito que lo compensara.
            { cuenta: '2135', concepto: 'INSAFORP por Pagar', tipo: 'credito', monto: round2(sum((c) => c.insaforp_patronal)) },
        ];
    },

    /** CA14 (US-CIE-03/IMPL-106) — "vista de Cuotas Patronales" separada de la partida contable:
     * mismos 3 montos que ya suman las líneas 5120/5125/5130 de `generarPartidaDiario` (misma
     * fuente, `planilla_calculo_empleado`), pero desglosados por empleado en vez de un solo total
     * por cuenta contable — para que Contabilidad pueda auditar/instruir el pago sin tener que
     * reconstruirlo a mano desde el asiento. NO incluye `ipsfa_patronal` (IMPL-87): el CA solo
     * pide ISSS/AFP/INSAFORP — se documenta el gap en vez de agregarlo por iniciativa propia,
     * mismo criterio que se usó con los documentos legales al cablear IPSFA. */
    async generarFilasCuotasPatronales(quincenaId: string): Promise<FilaCuotaPatronal[]> {
        const [calculos, empleados] = await Promise.all([
            calculoPlanillaService.getPorQuincena(quincenaId),
            planillaEmpleadosService.getEmpleadosParaReportes(),
        ]);
        const empleadosPorId = new Map(empleados.map((e) => [e.id, e]));

        return calculos
            .map((c) => {
                const emp = empleadosPorId.get(c.empleado_id);
                return {
                    codigoEmpleado: emp?.codigo_empleado_manual ?? emp?.codigo ?? c.empleado_id,
                    nombreEmpleado: emp?.nombre_completo ?? c.empleado_id,
                    isssPatronal: c.isss_patronal,
                    afpPatronal: c.afp_patronal,
                    insaforpPatronal: c.insaforp_patronal,
                    totalPatronal: round2(c.isss_patronal + c.afp_patronal + c.insaforp_patronal),
                };
            })
            .sort((a, b) => a.nombreEmpleado.localeCompare(b.nombreEmpleado));
    },
};
