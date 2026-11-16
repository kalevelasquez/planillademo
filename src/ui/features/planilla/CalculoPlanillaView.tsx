import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Calculator, AlertTriangle, Settings2, FileSpreadsheet, FileText, Lock, ListChecks, RefreshCw } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { useToast } from '../../../context/ToastContext';
import { usePlanillaContext } from './PlanillaLayout';
import { planillaEmpleadosService, type Empleado } from '../../../services/planillaEmpleadosService';
import { calculoPlanillaService, type CalculoEmpleado } from '../../../services/calculoPlanillaService';
import { calculoVistasService, type VistaGuardada } from '../../../services/calculoVistasService';
import { descuentoCategoriasService, type DescuentoCategoria } from '../../../services/descuentoCategoriasService';
import { normalizarTexto } from '../../../utils/fuzzyMatchUtils';
import { COLUMNAS_DISPONIBLES, VISTAS_PREDEFINIDAS, type ColumnaKey } from '../../../utils/calculoPlanillaColumnas';
import { round2 } from '../../../utils/calculoPlanillaUtils';
import { exportToExcel } from '../../../utils/exportUtils';
import { Button } from '../../components/Button';
import { PageLoader } from '../../components/PageLoader';
import { DetalleDescuentosModal, type DescuentoDetalleItem } from './components/DetalleDescuentosModal';
import { RecalculoRentaModal } from './components/RecalculoRentaModal';
import { Logger } from '../../../utils/logger';
import { getCodigoEmpleado } from '../../../utils/empleadoCodigoUtils';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'codigo' | 'codigo_empleado_manual' | 'departamento'>;

/** Categoría usada en `descuentos_detalle` para diferenciar Anticipos del resto (US-CALC-06 CA1
 * agrupa "Anticipos" y "Otros Desc." como columnas separadas). */
const CATEGORIA_ANTICIPO = 'Anticipo de salario';

// Bugfix (hallazgo UAT 2026-11-03): sumar floats de JS sin redondear puede arrastrar error binario
// (ej. 0.1 + 0.2) que un empleado sin anticipos hacía visible como "Otros desc." ($221.56)
// desalineado en un centavo contra "Total desc." ($221.57, columna NUMERIC exacta persistida por
// el motor real) — mismos ítems, mismo total esperado. `round2` corrige el display, no cambia qué
// se cobra (eso ya lo decide el motor).
function getOtrosDescAplicado(r: CalculoEmpleado): number {
    return round2(r.descuentos_detalle.filter((d) => d.categoria !== CATEGORIA_ANTICIPO).reduce((s, d) => s + d.aplicado, 0));
}
function getAnticiposAplicado(r: CalculoEmpleado): number {
    return round2(r.descuentos_detalle.filter((d) => d.categoria === CATEGORIA_ANTICIPO).reduce((s, d) => s + d.aplicado, 0));
}

/** Bugfix real (consulta del usuario, 2026-09-25) — el triángulo junto al nombre del empleado
 * no tenía ningún texto asociado: se veía en pantalla pero nadie sabía qué significaba sin leer
 * el código. Devuelve las claves de traducción de cada condición activa, para armar el tooltip
 * del ícono y el aviso del modal de detalle a partir de la misma fuente. */
type ClaveAlertaEmpleado = 'alerta_tope_descuentos_superado' | 'alerta_neto_bajo_minimo';
function getClavesAlertaEmpleado(r: CalculoEmpleado): ClaveAlertaEmpleado[] {
    const claves: ClaveAlertaEmpleado[] = [];
    if (r.descuentos_alerta_tope_superado) claves.push('alerta_tope_descuentos_superado');
    if (r.alerta_neto_bajo_minimo) claves.push('alerta_neto_bajo_minimo');
    return claves;
}

/** Modal de detalle (fidelidad al DEMO) — arma los items a partir del snapshot real, nunca
 * inventa una categoría que la BD no tenga. ISSS/AFP/Renta salen de columnas propias
 * (no viven en `descuentos_detalle`, que es solo para lo NO obligatorio); Renta se separa en
 * ISR y Bono 10% porque el motor real las persiste distinto (el DEMO solo tiene un campo).
 *
 * Bugfix (hallazgo UAT, Procuraduría — 2026-11-03): `descuentos_detalle` (el snapshot JSONB que
 * arma `calcular_planilla_empleado`) solo guarda `categoria`/`monto`/`aplicado`/`diferido`, SIN
 * campo `tipo` — este modal etiquetaba TODO lo no-anticipo como "Variable" a secas, sin mirar la
 * categoría real. Eso nunca reflejó el tipo verdadero (préstamo/financiera/vivienda ya eran
 * `fijo` desde siempre, y ahora Procuraduría también) — se resuelve por nombre normalizado contra
 * `planilla_descuento_categorias.tipo` (mismo criterio que `resolverFilasDescuentoActivoPorCategoria`
 * en constanciaSalarioUtils.ts), con 'variable' como default solo si la categoría ya no existe. */
function getDescuentosDetalleItems(r: CalculoEmpleado, tipoPorCategoriaNombre: Map<string, DescuentoCategoria['tipo']>): DescuentoDetalleItem[] {
    const items: DescuentoDetalleItem[] = [];
    if (r.isss_empleado > 0) items.push({ concepto: 'ISSS', tipo: 'fijo', monto: r.isss_empleado });
    if (r.afp_empleado > 0) items.push({ concepto: 'AFP', tipo: 'fijo', monto: r.afp_empleado });
    if (r.renta_isr > 0) items.push({ concepto: 'Renta ISR', tipo: 'variable', monto: r.renta_isr });
    if (r.renta_bono10 > 0) items.push({ concepto: 'Renta sobre Bono 10%', tipo: 'variable', monto: r.renta_bono10 });
    r.descuentos_detalle.filter((d) => d.aplicado > 0).forEach((d) => {
        const tipo = d.categoria === CATEGORIA_ANTICIPO ? 'anticipo' : (tipoPorCategoriaNombre.get(normalizarTexto(d.categoria)) ?? 'variable');
        items.push({ concepto: d.categoria, tipo, monto: d.aplicado });
    });
    return items;
}

const VALOR_COLUMNA: Record<ColumnaKey, (r: CalculoEmpleado) => number | string> = {
    departamento: () => '',
    sueldo: (r) => r.sueldo_proporcional,
    permisos: (r) => r.permisos_sin_goce_monto,
    hhee: (r) => r.horas_extras_monto,
    viaticos: (r) => r.viaticos_monto,
    bonificaciones: (r) => r.bonificaciones_monto,
    otrosIngresos: (r) => r.otros_ingresos_gravables + r.otros_ingresos_no_gravables,
    totalIngresos: (r) => r.total_ingresos_gravables + r.total_no_gravable,
    isss: (r) => r.isss_empleado,
    afp: (r) => r.afp_empleado,
    renta: (r) => r.renta_isr + r.renta_bono10,
    anticipos: (r) => getAnticiposAplicado(r),
    otrosDesc: (r) => getOtrosDescAplicado(r),
    totalDesc: (r) => r.descuentos_no_obligatorios_aplicado,
};

const COLUMNA_ES_MONEDA: Record<ColumnaKey, boolean> = {
    departamento: false, sueldo: true, permisos: true, hhee: true, viaticos: true, bonificaciones: true,
    otrosIngresos: true, totalIngresos: true, isss: true, afp: true, renta: true,
    anticipos: true, otrosDesc: true, totalDesc: true,
};

/**
 * Panel de Resumen Financiero y Tabla de Cálculo (US-CALC-03/IMPL-89) + Columnas Configurables
 * y Vistas Guardadas (US-CALC-06/IMPL-92) + Exportar Excel/PDF (US-CALC-07/IMPL-93). Consume el
 * snapshot ya persistido en `planilla_calculo_empleado` (US-CALC-04/IMPL-90) — nunca calcula
 * nada en el cliente.
 */
export const CalculoPlanillaView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const { quincenaId, quincena: quincenaSeleccionada, quincenaCerrada } = usePlanillaContext();

    const [empleados, setEmpleados] = useState<EmpleadoActivo[]>([]);
    const [categorias, setCategorias] = useState<DescuentoCategoria[]>([]);
    const [registros, setRegistros] = useState<CalculoEmpleado[]>([]);
    const [detalleTarget, setDetalleTarget] = useState<CalculoEmpleado | null>(null);
    const [mostrarRecalculoModal, setMostrarRecalculoModal] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isCalculando, setIsCalculando] = useState(false);
    const [filtroBusqueda, setFiltroBusqueda] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pendientesProcesar, setPendientesProcesar] = useState({ anticipos: 0, descuentos: 0 });

    const [mostrarConfigColumnas, setMostrarConfigColumnas] = useState(false);
    const [columnasVisibles, setColumnasVisibles] = useState<Set<ColumnaKey>>(new Set(VISTAS_PREDEFINIDAS.completa));
    const [vistaActiva, setVistaActiva] = useState<string>('completa');
    const [vistasGuardadas, setVistasGuardadas] = useState<VistaGuardada[]>([]);
    const [nombreNuevaVista, setNombreNuevaVista] = useState('');

    useEffect(() => {
        planillaEmpleadosService.getEmpleadosActivos()
            .then(setEmpleados)
            .catch((err: unknown) => Logger.error('Error al cargar empleados', {}, err));
        calculoVistasService.getTodas()
            .then(setVistasGuardadas)
            .catch((err: unknown) => Logger.error('Error al cargar vistas guardadas', {}, err));
        descuentoCategoriasService.getTodos()
            .then(setCategorias)
            .catch((err: unknown) => Logger.error('Error al cargar categorías de descuento', {}, err));
    }, []);

    const tipoPorCategoriaNombre = useMemo(
        () => new Map(categorias.map((c) => [normalizarTexto(c.nombre), c.tipo] as const)),
        [categorias],
    );

    const cargar = (qId: string) => {
        setIsLoading(true);
        calculoPlanillaService.getPorQuincena(qId)
            .then(setRegistros)
            .catch((err: unknown) => Logger.error('Error al cargar cálculo de planilla', { quincenaId: qId }, err))
            .finally(() => setIsLoading(false));
    };

    useEffect(() => {
        if (!quincenaId) return;
        cargar(quincenaId);
    }, [quincenaId]);

    /** Auditoría: chequeo previo para avisar ANTES de calcular, en vez de que la planilla salga
     * calculada con $0 en anticipos/descuentos que nadie procesó todavía (ver migración). */
    useEffect(() => {
        if (!quincenaId) { setPendientesProcesar({ anticipos: 0, descuentos: 0 }); return; }
        calculoPlanillaService.contarPendientesProcesar(quincenaId)
            .then(setPendientesProcesar)
            .catch((err: unknown) => Logger.error('Error al chequear anticipos/descuentos pendientes', { quincenaId }, err));
    }, [quincenaId, registros]);

    const hayPendientesProcesar = pendientesProcesar.anticipos > 0 || pendientesProcesar.descuentos > 0;

    const empleadoPorId = useMemo(() => new Map(empleados.map((e) => [e.id, e])), [empleados]);

    const registrosFiltrados = useMemo(() => {
        const termino = filtroBusqueda.trim().toLowerCase();
        if (!termino) return registros;
        return registros.filter((r) => {
            const emp = empleadoPorId.get(r.empleado_id);
            return emp?.nombre_completo.toLowerCase().includes(termino) || (!!emp && getCodigoEmpleado(emp).toLowerCase().includes(termino));
        });
    }, [registros, empleadoPorId, filtroBusqueda]);

    /** CA1 — tarjetas de resumen. CA5 — total neto, # empleados, promedio. */
    const totales = useMemo(() => {
        const sum = (fn: (r: CalculoEmpleado) => number) => registros.reduce((s, r) => s + fn(r), 0);
        const totalSueldos = sum((r) => r.sueldo_proporcional);
        const totalHorasExtras = sum((r) => r.horas_extras_monto);
        const totalViaticos = sum((r) => r.viaticos_monto);
        const totalBonificaciones = sum((r) => r.bonificaciones_monto);
        const totalIsss = sum((r) => r.isss_empleado);
        const totalAfp = sum((r) => r.afp_empleado);
        const totalRenta = sum((r) => r.renta_isr + r.renta_bono10);
        const totalDescuentos = sum((r) => r.descuentos_no_obligatorios_aplicado);
        const totalNeto = sum((r) => r.neto_a_pagar);
        return {
            totalSueldos, totalHorasExtras, totalViaticos, totalBonificaciones,
            totalIsss, totalAfp, totalRenta, totalDescuentos, totalNeto,
            numEmpleados: registros.length,
            promedioNeto: registros.length > 0 ? totalNeto / registros.length : 0,
        };
    }, [registros]);

    const handleCalcular = async () => {
        if (!profile?.id || !quincenaId) return;
        setError(null);
        // Bugfix (auditoría): "Calcular Planilla" solo se deshabilitaba por pendientes de
        // procesar — nada impedía recalcular (y sobrescribir) el snapshot de una quincena ya
        // aprobada_cerrada. Mismo guard que ya existe en handleRecalcularRenta.
        if (quincenaCerrada) {
            setError(t('calculoPlanilla.error_calculo_quincena_cerrada'));
            return;
        }
        if (hayPendientesProcesar) {
            setError(t('calculoPlanilla.error_pendientes_procesar', pendientesProcesar));
            return;
        }
        setIsCalculando(true);
        try {
            const calculados = await calculoPlanillaService.calcularQuincena(quincenaId, profile.id);
            setRegistros(calculados);
            showToast(t('calculoPlanilla.toast_calculado', { count: calculados.length }), 'success');
        } catch (err: unknown) {
            Logger.error('Error al calcular planilla', { quincenaId }, err);
            setError(err instanceof Error ? err.message : t('calculoPlanilla.error_calcular'));
        } finally {
            setIsCalculando(false);
        }
    };

    const esAguinaldo = quincenaSeleccionada?.tipo === 'aguinaldo';
    // IMPL-14 (2026-10-19, fórmula confirmada por Imporfrut) — igual que Aguinaldo, Quincena 25
    // tiene su propio motor dedicado (`calcular_quincena_25_empleado`) disparado automáticamente
    // al crear la quincena, no por este botón — "Calcular Planilla" llamaría al RPC normal, que
    // rechaza cualquier tipo != 'normal' (calcular_planilla_empleado solo acepta 'normal').
    const esQuincena25 = quincenaSeleccionada?.tipo === 'quincena_25';

    /** US-CALC-08 (IMPL-94) CA1/CA2 — solo la 2ª quincena de junio/diciembre. */
    const esElegibleRecalculoRenta = useMemo(() => {
        if (!quincenaSeleccionada || quincenaSeleccionada.tipo !== 'normal') return false;
        const fin = new Date(`${quincenaSeleccionada.fecha_fin}T00:00:00`);
        return fin.getDate() >= 16 && (fin.getMonth() === 5 || fin.getMonth() === 11);
    }, [quincenaSeleccionada]);

    /** US-CALC-08 (fidelidad al DEMO) — devuelve la cantidad de ajustados para que
     * `RecalculoRentaModal` la muestre en su resumen visual, en vez de solo un toast.
     *
     * Bugfix (auditoría, hallazgo menor): `recalcular_renta_semestral` no chequeaba el estado
     * de la quincena — sobre una quincena cerrada, el RPC corría igual y devolvía "0 ajustados"
     * (porque cualquier diferencia ya fue aplicada al cerrar, o el RPC directamente no debería
     * tocar una quincena aprobada_cerrada), indistinguible en la UI de "no había nada que
     * ajustar". Se agrega el guard acá (rápido, sin round-trip) y también en el RPC mismo
     * (ver migración `20260907240000_bloquear_recalculo_renta_quincena_cerrada.sql`) como
     * defensa en profundidad — mismo patrón que `calcular_planilla_empleado` ya usa. */
    const handleRecalcularRenta = async (): Promise<number> => {
        if (!profile?.id || !quincenaId) return 0;
        setError(null);
        if (quincenaCerrada) {
            const mensaje = t('calculoPlanilla.error_recalculo_quincena_cerrada');
            setError(mensaje);
            throw new Error(mensaje);
        }
        try {
            const ajustados = await calculoPlanillaService.recalcularRentaSemestral(quincenaId, profile.id);
            if (ajustados.length > 0) cargar(quincenaId);
            return ajustados.length;
        } catch (err: unknown) {
            Logger.error('Error al recalcular renta semestral', { quincenaId }, err);
            setError(t('calculoPlanilla.error_recalcular'));
            throw err;
        }
    };

    const aplicarVista = (columnas: ColumnaKey[], id: string) => {
        setColumnasVisibles(new Set(columnas));
        setVistaActiva(id);
    };

    const handleToggleColumna = (key: ColumnaKey) => {
        setColumnasVisibles((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
        setVistaActiva('custom');
    };

    const handleGuardarVista = async () => {
        if (!profile?.tenant_id || !profile.id || !nombreNuevaVista.trim()) return;
        try {
            const nueva = await calculoVistasService.guardar(profile.tenant_id, nombreNuevaVista.trim(), Array.from(columnasVisibles), profile.id);
            setVistasGuardadas((prev) => [...prev, nueva].sort((a, b) => a.nombre.localeCompare(b.nombre)));
            setVistaActiva(nueva.id);
            setNombreNuevaVista('');
            showToast(t('calculoPlanilla.toast_vista_guardada'), 'success');
        } catch (err: unknown) {
            Logger.error('Error al guardar vista', {}, err);
            showToast(t('calculoPlanilla.error_guardar_vista'), 'error');
        }
    };

    const columnasOrdenadas = useMemo(
        () => COLUMNAS_DISPONIBLES.filter((c) => columnasVisibles.has(c.key)),
        [columnasVisibles]
    );

    /** Nota de exportar (fidelidad al DEMO) — nombre legible de la vista activa. */
    const vistaActivaLabel = useMemo(() => {
        if (vistaActiva === 'completa') return t('calculoPlanilla.vista_completa');
        if (vistaActiva === 'contabilidad') return t('calculoPlanilla.vista_contabilidad');
        if (vistaActiva === 'rrhh') return t('calculoPlanilla.vista_rrhh');
        return vistasGuardadas.find((v) => v.id === vistaActiva)?.nombre ?? t('calculoPlanilla.vista_personalizada');
    }, [vistaActiva, vistasGuardadas, t]);

    // Bugfix (auditoría): antes un neto negativo mostraba "$-53.20" — el signo va afuera del
    // símbolo de moneda.
    const fmt = (n: number) => (n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`);

    /** US-CALC-07 (IMPL-93) CA1 — respeta las columnas visibles de la vista activa. */
    const handleExportarExcel = () => {
        const filas = registrosFiltrados.map((r) => {
            const fila: Record<string, string | number> = {
                [t('vacaciones.col_empleado')]: empleadoPorId.get(r.empleado_id)?.nombre_completo ?? r.empleado_id,
            };
            columnasOrdenadas.forEach((c) => {
                const valor = VALOR_COLUMNA[c.key](r);
                fila[t(`calculoPlanilla.col_${c.key}`)] = c.key === 'departamento' ? (empleadoPorId.get(r.empleado_id)?.departamento ?? '') : Number(valor);
            });
            fila[t('calculoPlanilla.col_neto')] = r.neto_a_pagar;
            return fila;
        });
        const quincenaLabel = quincenaSeleccionada?.etiqueta_estandar ?? quincenaId;
        exportToExcel(filas, `Calculo_Planilla_${quincenaLabel}`, 'Cálculo de Planilla', { title: `Cálculo de Planilla — ${quincenaLabel}` })
            .catch((err: unknown) => Logger.error('Error al exportar a Excel', {}, err));
    };

    /** US-CALC-07 (IMPL-93) CA1 — "Exportar PDF": sin librería PDF en el proyecto (confirmado,
     * ninguna dependencia jspdf/similar) — se usa el diálogo nativo de impresión del navegador
     * ("Guardar como PDF"), que respeta la tabla ya renderizada con las columnas visibles. */
    const handleExportarPDF = () => {
        window.print();
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            {/* CA1 — tarjetas de resumen (fidelidad al DEMO: fila con scroll horizontal, no grid). */}
            <div className="flex gap-md overflow-x-auto pb-sm">
                {[
                    { label: t('calculoPlanilla.stat_total_sueldos'), value: totales.totalSueldos, cls: 'text-heading', bg: 'bg-white' },
                    { label: t('calculoPlanilla.stat_total_hhee'), value: totales.totalHorasExtras, cls: 'text-heading', bg: 'bg-white' },
                    { label: t('calculoPlanilla.stat_total_viaticos'), value: totales.totalViaticos, cls: 'text-heading', bg: 'bg-white' },
                    { label: t('calculoPlanilla.stat_total_bonificaciones'), value: totales.totalBonificaciones, cls: 'text-heading', bg: 'bg-white' },
                    { label: t('calculoPlanilla.stat_total_isss'), value: totales.totalIsss, cls: 'text-error', bg: 'bg-white' },
                    { label: t('calculoPlanilla.stat_total_afp'), value: totales.totalAfp, cls: 'text-error', bg: 'bg-white' },
                    { label: t('calculoPlanilla.stat_total_renta'), value: totales.totalRenta, cls: 'text-error', bg: 'bg-white' },
                    { label: t('calculoPlanilla.stat_total_descuentos'), value: totales.totalDescuentos, cls: 'text-error', bg: 'bg-white' },
                    { label: t('calculoPlanilla.stat_neto_total'), value: totales.totalNeto, cls: 'text-primary', bg: 'bg-primary-light', bold: true },
                ].map((s) => (
                    <div key={s.label} className={`${s.bg} rounded-xl border border-border shadow-cards p-md shrink-0 flex flex-col gap-xs min-w-[140px] sm:min-w-[160px] ${s.bold ? 'border-primary/30' : ''}`}>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary leading-tight">{s.label}</p>
                        <p className={`text-[1.25rem] font-bold leading-tight ${s.cls}`}>{fmt(s.value)}</p>
                    </div>
                ))}
            </div>

            {(!(esAguinaldo || esQuincena25) || esElegibleRecalculoRenta) && (
                <div className="print:hidden flex items-center justify-end gap-2">
                    {!esAguinaldo && !esQuincena25 && (
                        <Button type="button" onClick={handleCalcular} isLoading={isCalculando} disabled={hayPendientesProcesar || quincenaCerrada} className="flex items-center gap-1.5">
                            <Calculator size={16} /> {t('calculoPlanilla.action_calcular')}
                        </Button>
                    )}
                    {esElegibleRecalculoRenta && (
                        <Button type="button" variant="ghost" onClick={() => setMostrarRecalculoModal(true)} className="flex items-center gap-1.5">
                            <RefreshCw size={16} /> {t('calculoPlanilla.action_recalcular_renta')}
                        </Button>
                    )}
                </div>
            )}
            {quincenaCerrada && (
                <div className="flex items-center gap-sm px-md py-sm rounded-lg bg-heading">
                    <Lock size={15} className="text-white shrink-0" />
                    <p className="text-white text-[12px] font-semibold">{t('calculoPlanilla.banner_quincena_cerrada')}</p>
                </div>
            )}
            {!esAguinaldo && !esQuincena25 && hayPendientesProcesar && (
                <div className="print:hidden flex items-start gap-sm px-md py-sm rounded-lg bg-amber-50 border border-amber-200">
                    <AlertTriangle size={16} className="text-amber-700 shrink-0 mt-0.5" />
                    <p className="text-[12px] text-amber-800">
                        {t('calculoPlanilla.banner_pendientes_procesar', pendientesProcesar)}{' '}
                        <Link to="/planilla/anticipos" className="font-semibold underline hover:no-underline">{t('calculoPlanilla.link_ir_anticipos')}</Link>
                        {' · '}
                        <Link to="/planilla/descuentos" className="font-semibold underline hover:no-underline">{t('calculoPlanilla.link_ir_descuentos')}</Link>
                    </p>
                </div>
            )}
            {esAguinaldo && (
                <p className="text-caption text-text-secondary italic">{t('calculoPlanilla.aguinaldo_nota_solo_lectura')}</p>
            )}
            {esQuincena25 && (
                <p className="text-caption text-text-secondary italic">{t('calculoPlanilla.quincena25_nota_motor_pendiente')}</p>
            )}
            {error && <p className="text-caption text-error">{error}</p>}

            <section className="flex flex-col gap-3 bg-white rounded-lg shadow-cards border border-border p-lg">
                <div className="print:hidden flex flex-wrap items-center gap-2 justify-between">
                    <input
                        type="text"
                        value={filtroBusqueda}
                        onChange={(e) => setFiltroBusqueda(e.target.value)}
                        placeholder={t('calculoPlanilla.filtro_busqueda_placeholder')}
                        className="rounded-md border border-border bg-white px-3 py-2 text-sm max-w-[24rem] flex-1"
                    />
                    <div className="flex items-center gap-2">
                        <select
                            value={vistaActiva}
                            onChange={(e) => {
                                const id = e.target.value;
                                if (id === 'contabilidad' || id === 'rrhh' || id === 'completa') {
                                    aplicarVista(VISTAS_PREDEFINIDAS[id], id);
                                } else {
                                    const guardada = vistasGuardadas.find((v) => v.id === id);
                                    if (guardada) aplicarVista(guardada.columnas, guardada.id);
                                }
                            }}
                            className="rounded-md border border-border bg-white px-2 py-2 text-[13px]"
                        >
                            <option value="completa">{t('calculoPlanilla.vista_completa')}</option>
                            <option value="contabilidad">{t('calculoPlanilla.vista_contabilidad')}</option>
                            <option value="rrhh">{t('calculoPlanilla.vista_rrhh')}</option>
                            {vistasGuardadas.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
                            {vistaActiva === 'custom' && <option value="custom">{t('calculoPlanilla.vista_personalizada')}</option>}
                        </select>
                        <button type="button" onClick={() => setMostrarConfigColumnas((v) => !v)} className="p-2 rounded-md border border-border text-text-secondary hover:text-heading transition-colors" title={t('calculoPlanilla.action_configurar_columnas')}>
                            <Settings2 size={16} />
                        </button>
                    </div>
                </div>

                {mostrarConfigColumnas && (
                    <div className="print:hidden flex flex-col gap-3 bg-surface rounded-lg p-md">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">{t('calculoPlanilla.config_columnas_title')}</p>
                        {(['general', 'ingresos', 'deducciones'] as const).map((grupo) => (
                            <div key={grupo} className="flex flex-col gap-1.5">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">{t(`calculoPlanilla.grupo_${grupo}`)}</p>
                                <div className="flex flex-wrap gap-3">
                                    {COLUMNAS_DISPONIBLES.filter((c) => c.grupo === grupo).map((c) => (
                                        <label key={c.key} className="flex items-center gap-1.5 text-[13px] text-heading">
                                            <input type="checkbox" checked={columnasVisibles.has(c.key)} onChange={() => handleToggleColumna(c.key)} />
                                            {t(`calculoPlanilla.col_${c.key}`)}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ))}
                        <div className="flex items-center gap-2 pt-2 border-t border-border/40">
                            <input
                                type="text"
                                value={nombreNuevaVista}
                                onChange={(e) => setNombreNuevaVista(e.target.value)}
                                placeholder={t('calculoPlanilla.field_nombre_vista_placeholder')}
                                className="rounded-md border border-border bg-white px-3 py-1.5 text-[13px] flex-1"
                            />
                            <Button type="button" onClick={handleGuardarVista} className="text-[13px] py-1.5">{t('calculoPlanilla.action_guardar_vista')}</Button>
                        </div>
                    </div>
                )}

                {isLoading ? (
                    <PageLoader label={t('common.loading')} />
                ) : registrosFiltrados.length === 0 ? (
                    <p className="text-caption text-text-secondary italic">{t('calculoPlanilla.listado_empty')}</p>
                ) : (
                    <div className="hidden sm:block overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="text-[10px] font-bold uppercase tracking-widest text-text-secondary border-b border-border/50">
                                    <th className="py-2 pr-2">{t('vacaciones.col_empleado')}</th>
                                    {columnasOrdenadas.map((c) => (
                                        <th key={c.key} className="py-2 px-2 text-right">{t(`calculoPlanilla.col_${c.key}`)}</th>
                                    ))}
                                    <th className="py-2 px-2 w-8" />
                                    <th className="py-2 pl-2 text-right">{t('calculoPlanilla.col_neto')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {registrosFiltrados.map((r) => {
                                    const alertasEmpleado = getClavesAlertaEmpleado(r).map((k) => t(`calculoPlanilla.${k}`));
                                    return (
                                    // Defecto real IMPL-176 (UAT) — sin esto, el motor de paginación de
                                    // impresión corta filas en cualquier punto arbitrario al exportar a
                                    // PDF (window.print()), partiendo el nombre del empleado a la mitad.
                                    <tr key={r.id} className="border-b border-border/30 last:border-b-0 print:break-inside-avoid">
                                        <td className="py-2 pr-2 font-medium text-heading">
                                            {empleadoPorId.get(r.empleado_id)?.nombre_completo ?? r.empleado_id}
                                            {alertasEmpleado.length > 0 && (
                                                <span title={alertasEmpleado.join(' / ')}>
                                                    <AlertTriangle size={12} className="inline ml-1.5 text-amber-500" />
                                                </span>
                                            )}
                                        </td>
                                        {columnasOrdenadas.map((c) => (
                                            <td key={c.key} className={`py-2 px-2 text-right ${c.grupo === 'deducciones' ? 'text-error' : ''}`}>
                                                {c.key === 'departamento'
                                                    ? (empleadoPorId.get(r.empleado_id)?.departamento ?? '—')
                                                    : (COLUMNA_ES_MONEDA[c.key] ? fmt(Number(VALOR_COLUMNA[c.key](r))) : String(VALOR_COLUMNA[c.key](r)))}
                                            </td>
                                        ))}
                                        <td className="py-2 px-2">
                                            <button
                                                type="button"
                                                onClick={() => setDetalleTarget(r)}
                                                title={t('calculoPlanilla.action_ver_detalle_descuentos')}
                                                className="p-1 rounded-lg text-text-secondary hover:text-primary hover:bg-primary-light transition-colors"
                                            >
                                                <ListChecks size={15} />
                                            </button>
                                        </td>
                                        <td className="py-2 pl-2 text-right font-bold text-heading">
                                            {/* Bugfix (auditoría): un neto negativo es alcanzable (descuentos "fijo" se aplican
                                                sin tope) y antes no tenía ninguna advertencia dedicada — alerta_neto_bajo_minimo
                                                está desactivada mientras salario_minimo_inembargable siga en NULL. */}
                                            {r.neto_a_pagar < 0 ? (
                                                <span className="inline-flex items-center gap-1 text-error" title={t('calculoPlanilla.alerta_neto_negativo')}>
                                                    <AlertTriangle size={12} /> {fmt(r.neto_a_pagar)}
                                                </span>
                                            ) : fmt(r.neto_a_pagar)}
                                        </td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-border font-bold text-heading">
                                    <td className="py-2 pr-2">
                                        {t('calculoPlanilla.fila_totales')}
                                        {/* Bugfix (auditoría, hallazgo menor): esta fila sumaba las columnas SOLO sobre
                                            registrosFiltrados, pero la celda de Neto seguía usando totales.totalNeto (sin
                                            filtrar) — dos números en la misma fila que no cuadraban entre sí cuando había
                                            una búsqueda activa. Ahora toda la fila usa la misma fuente (filtrada) y se
                                            aclara con el sufijo cuando el filtro está activo, para no leerse como el total
                                            de toda la quincena (ese vive en las tarjetas de resumen y en el destacado de
                                            abajo, que sí son intencionalmente quincena completa). */}
                                        {filtroBusqueda.trim() !== '' && (
                                            <span className="ml-1 font-normal normal-case text-text-secondary">({t('calculoPlanilla.fila_totales_filtro_sufijo')})</span>
                                        )}
                                    </td>
                                    {columnasOrdenadas.map((c) => (
                                        <td key={c.key} className="py-2 px-2 text-right">
                                            {c.key === 'departamento' ? '' : fmt(registrosFiltrados.reduce((s, r) => s + Number(VALOR_COLUMNA[c.key](r)), 0))}
                                        </td>
                                    ))}
                                    <td className="py-2 px-2" />
                                    <td className="py-2 pl-2 text-right">{fmt(registrosFiltrados.reduce((s, r) => s + r.neto_a_pagar, 0))}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </section>

            {/* Cards mobile (fidelidad al DEMO) — el listado desktop usa tabla con scroll
                horizontal; en mobile eso es difícil de leer, así que se agrega una vista de
                tarjetas por empleado, respetando las columnas configuradas por el usuario en
                vez de fijar un subconjunto propio. */}
            {!isLoading && registrosFiltrados.length > 0 && (
                <div className="flex flex-col gap-sm sm:hidden">
                    {registrosFiltrados.map((r) => {
                        const totalDescuentosCompleto = r.isss_empleado + r.afp_empleado + r.renta_isr + r.renta_bono10 + r.descuentos_no_obligatorios_aplicado;
                        const totalIngresos = r.total_ingresos_gravables + r.total_no_gravable;
                        const empleado = empleadoPorId.get(r.empleado_id);
                        const alertasEmpleado = getClavesAlertaEmpleado(r).map((k) => t(`calculoPlanilla.${k}`));
                        return (
                            <div key={r.id} className="bg-white rounded-xl border border-border shadow-cards p-md flex flex-col gap-sm">
                                <div className="flex items-center justify-between gap-sm">
                                    <div className="min-w-0">
                                        <p className="text-body font-bold text-heading flex items-center gap-1">
                                            {empleado?.nombre_completo ?? r.empleado_id}
                                            {alertasEmpleado.length > 0 && (
                                                <span title={alertasEmpleado.join(' / ')}>
                                                    <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                                                </span>
                                            )}
                                        </p>
                                        <p className="text-[11px] text-text-secondary">{empleado?.departamento ?? ''} · {empleado ? getCodigoEmpleado(empleado) : ''}</p>
                                    </div>
                                    <div className="flex items-center gap-sm shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => setDetalleTarget(r)}
                                            title={t('calculoPlanilla.action_ver_detalle_descuentos')}
                                            className="p-1.5 rounded-lg text-text-secondary hover:text-primary hover:bg-primary-light transition-colors border border-border"
                                        >
                                            <ListChecks size={15} />
                                        </button>
                                        <div className="text-right">
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">{t('calculoPlanilla.mobile_card_neto')}</p>
                                            <p className={`text-[1.1rem] font-bold flex items-center gap-1 justify-end ${r.neto_a_pagar < 0 ? 'text-error' : 'text-primary'}`} title={r.neto_a_pagar < 0 ? t('calculoPlanilla.alerta_neto_negativo') : undefined}>
                                                {r.neto_a_pagar < 0 && <AlertTriangle size={13} />}
                                                {fmt(r.neto_a_pagar)}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-sm">
                                    <div className="bg-surface rounded-lg p-sm">
                                        <p className="text-[9px] font-bold uppercase tracking-widest text-text-secondary">{t('calculoPlanilla.mobile_card_total_ingresos')}</p>
                                        <p className="text-[13px] font-bold text-heading">{fmt(totalIngresos)}</p>
                                    </div>
                                    <div className="bg-error/10 rounded-lg p-sm">
                                        <p className="text-[9px] font-bold uppercase tracking-widest text-error">{t('calculoPlanilla.mobile_card_total_descuentos')}</p>
                                        <p className="text-[13px] font-bold text-error">{fmt(totalDescuentosCompleto)}</p>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {columnasOrdenadas.filter((c) => COLUMNA_ES_MONEDA[c.key] && Number(VALOR_COLUMNA[c.key](r)) > 0).map((c) => (
                                        <span key={c.key} className="text-[10px] px-sm py-0.5 rounded-full bg-surface border border-border text-text-secondary">
                                            {t(`calculoPlanilla.col_${c.key}`)}: {fmt(Number(VALOR_COLUMNA[c.key](r)))}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Acciones: exportar + resumen destacado (fidelidad al DEMO — antes vivían como
                iconos chicos en la toolbar y una línea de texto al pie de la tabla). */}
            <section className="flex flex-col gap-3">
                <div className="print:hidden bg-white rounded-lg shadow-cards border border-border p-md flex flex-col sm:flex-row sm:items-center gap-md justify-between">
                    <div className="flex flex-col gap-xs">
                        <Button type="button" variant="secondary" onClick={handleExportarExcel} className="flex items-center gap-1.5 self-start">
                            <FileSpreadsheet size={16} /> {t('calculoPlanilla.action_exportar_excel')}
                        </Button>
                        <p className="text-[10px] text-text-secondary">
                            {t('calculoPlanilla.export_excel_nota', { count: columnasOrdenadas.length + 2, vista: vistaActivaLabel })}
                        </p>
                    </div>
                    <Button type="button" variant="ghost" onClick={handleExportarPDF} className="flex items-center gap-1.5 self-start sm:self-auto">
                        <FileText size={16} /> {t('calculoPlanilla.action_exportar_pdf')}
                    </Button>
                </div>

                <div className="flex items-center justify-between px-lg py-md bg-primary-light/30 rounded-lg border border-primary/20">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-primary">{t('calculoPlanilla.stat_neto_total')}</p>
                        <p className="text-[1.75rem] font-bold text-primary leading-tight">{fmt(totales.totalNeto)}</p>
                        {/* Bugfix (auditoría, hallazgo menor): este destacado (y las tarjetas de resumen de
                            arriba) muestran intencionalmente el total de TODA la quincena — no cambian con
                            filtroBusqueda, a diferencia de la fila "Totales" de la tabla. Sin esta aclaración,
                            buscar un empleado deja dos números de "Neto Total" en pantalla que no cuadran entre
                            sí y parecen contradecirse. */}
                        {filtroBusqueda.trim() !== '' && (
                            <p className="text-[9px] text-primary/60 normal-case font-normal mt-0.5">{t('calculoPlanilla.nota_totales_quincena_completa')}</p>
                        )}
                    </div>
                    <div className="text-right">
                        <p className="text-[11px] text-primary/70">{t('calculoPlanilla.footer_num_empleados', { count: totales.numEmpleados })}</p>
                        <p className="text-[11px] text-primary font-semibold">{t('calculoPlanilla.footer_promedio', { monto: totales.promedioNeto.toFixed(2) })}</p>
                    </div>
                </div>
            </section>

            {detalleTarget && (
                <DetalleDescuentosModal
                    empleadoNombre={empleadoPorId.get(detalleTarget.empleado_id)?.nombre_completo ?? detalleTarget.empleado_id}
                    items={getDescuentosDetalleItems(detalleTarget, tipoPorCategoriaNombre)}
                    alertas={getClavesAlertaEmpleado(detalleTarget).map((k) => t(`calculoPlanilla.${k}`))}
                    onClose={() => setDetalleTarget(null)}
                />
            )}
            {mostrarRecalculoModal && (
                <RecalculoRentaModal
                    totalEmpleados={registros.length}
                    onEjecutar={handleRecalcularRenta}
                    onClose={() => setMostrarRecalculoModal(false)}
                />
            )}
        </div>
    );
};
