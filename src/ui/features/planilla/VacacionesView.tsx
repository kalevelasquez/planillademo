import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, ChevronLeft, ChevronRight, Trash2, Pencil, CheckCircle2, AlertCircle, Palmtree, CalendarDays, Search, X, Gift, Undo2 } from 'lucide-react';

import { useToast } from '../../../context/ToastContext';
import { usePlanillaContext } from './PlanillaLayout';
import { useAuthStore } from '../../../store/authStore';
import { planillaEmpleadosService, type Empleado } from '../../../services/planillaEmpleadosService';
import { vacacionesService, type Vacacion, type AdelantoRecargoVacacion } from '../../../services/vacacionesService';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/ConfirmModal';
import { VacacionModal } from './components/VacacionModal';
import { Logger } from '../../../utils/logger';
import { getCodigoEmpleado } from '../../../utils/empleadoCodigoUtils';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual' | 'sueldo_mensual' | 'fecha_ingreso'>;

const COLORES = [
    { bg: 'bg-primary-light', text: 'text-primary', dot: 'bg-primary', border: 'border-primary/20' },
    { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500', border: 'border-purple-200' },
    { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500', border: 'border-amber-200' },
    { bg: 'bg-pink-50', text: 'text-pink-700', dot: 'bg-pink-500', border: 'border-pink-200' },
    { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500', border: 'border-blue-200' },
];

const MESES_LABEL = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function iniciales(nombre: string): string {
    return nombre.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function fechaISO(y: number, m: number, d: number): string {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function fmtPeriodo(iso: string): string {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

// Art. 177 CT, confirmado por Imporfrut (IMPL-7) — mismo valor que DIAS_ACUMULADOS_POR_ANIO en
// VacacionesResumenSection.tsx. El adelanto se calcula sobre el paquete completo de 15 días,
// confirmado con el usuario (2026-10-05), no sobre un proporcional.
const DIAS_LEGALES_ANUALES = 15;

function calcularRecargoAdelanto(sueldoMensual: number | null): number {
    if (!sueldoMensual) return 0;
    const sueldoDiario = Math.round((sueldoMensual / 30) * 100) / 100;
    return Math.round(sueldoDiario * DIAS_LEGALES_ANUALES * 0.3 * 100) / 100;
}

/**
 * Observación de reunión (2026-10-05) — detecta si la fecha de ingreso de un empleado cae en
 * aniversario (1, 2, 3... años cumplidos) DENTRO del rango de la quincena seleccionada. Se
 * proyecta el mes/día de `fechaIngreso` a cada año que la quincena atraviesa (normalmente uno
 * solo, salvo una quincena de fin de diciembre) y se descarta el propio año de ingreso (todavía
 * no cumplió nada ese año). Devuelve `null` si no cae ningún aniversario en el rango.
 */
function aniversarioEnQuincena(fechaIngreso: string, quincenaInicio: string, quincenaFin: string): { fecha: string; anios: number } | null {
    const ingreso = new Date(`${fechaIngreso}T00:00:00`);
    const anioIngreso = ingreso.getFullYear();
    const anioDesde = new Date(`${quincenaInicio}T00:00:00`).getFullYear();
    const anioHasta = new Date(`${quincenaFin}T00:00:00`).getFullYear();
    for (let anio = anioDesde; anio <= anioHasta; anio++) {
        if (anio <= anioIngreso) continue;
        const aniversario = fechaISO(anio, ingreso.getMonth(), ingreso.getDate());
        if (aniversario >= quincenaInicio && aniversario <= quincenaFin) {
            return { fecha: aniversario, anios: anio - anioIngreso };
        }
    }
    return null;
}

interface VacacionCardProps {
    r: Vacacion;
    nombreEmpleado: string;
    codigoEmpleado: string;
    colorIdx: number;
    isConciliando: boolean;
    quincenaCerrada: boolean;
    onToggleConciliado: () => void;
    onEditar: () => void;
    onEliminar: () => void;
}

const VacacionCard: React.FC<VacacionCardProps> = ({ r, nombreEmpleado, codigoEmpleado, colorIdx, isConciliando, quincenaCerrada, onToggleConciliado, onEditar, onEliminar }) => {
    const { t } = useTranslation();
    const color = COLORES[colorIdx % COLORES.length];

    return (
        <div className="bg-white rounded-xl border border-border shadow-cards overflow-hidden">
            <div className="flex">
                <div className={`w-1.5 shrink-0 ${color.dot}`} />
                <div className="flex-1 p-md flex flex-col gap-sm">
                    <div className="flex flex-wrap items-start justify-between gap-sm">
                        <div className="flex items-center gap-sm min-w-0">
                            <div className={`w-9 h-9 rounded-full ${color.bg} flex items-center justify-center shrink-0`}>
                                <span className={`text-[11px] font-bold ${color.text}`}>{iniciales(nombreEmpleado)}</span>
                            </div>
                            <div className="min-w-0">
                                <p className="text-body font-bold text-heading truncate">{nombreEmpleado} <span className="text-[11px] font-mono font-normal text-text-secondary">{codigoEmpleado}</span></p>
                                <div className="flex items-center gap-1.5 text-[11px] text-text-secondary mt-0.5">
                                    <CalendarDays size={12} className="shrink-0" />
                                    <span>{fmtPeriodo(r.fecha_inicio)} → {fmtPeriodo(r.fecha_fin)}</span>
                                    <span className="text-border">·</span>
                                    <span className="font-semibold text-heading">{t('vacaciones.col_dias')} {r.dias}</span>
                                    {r.no_gozada && (
                                        <>
                                            <span className="text-border">·</span>
                                            <span className="font-semibold text-primary">{t('vacaciones.badge_no_gozada')}</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            {r.conciliado ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary-light text-primary border border-primary/20">
                                    <CheckCircle2 size={10} /> {t('vacaciones.estado_conciliado')}
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                    <AlertCircle size={10} /> {t('vacaciones.estado_pendiente')}
                                </span>
                            )}
                            {!quincenaCerrada && (
                                <>
                                    <button type="button" onClick={onEditar} className="p-1 text-text-secondary hover:text-primary transition-colors rounded">
                                        <Pencil size={13} />
                                    </button>
                                    <button type="button" onClick={onEliminar} className="p-1 text-text-secondary hover:text-error transition-colors rounded">
                                        <Trash2 size={13} />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="h-px bg-border" />

                    <div className="flex flex-wrap items-center gap-sm text-[12px]">
                        <div className="flex flex-col items-center gap-0.5">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-text-secondary">{t('vacaciones.calculo_col_base')}</span>
                            <span className="font-bold text-heading">${r.monto_base.toFixed(2)}</span>
                        </div>
                        <span className="text-text-secondary font-bold text-[16px]">+</span>
                        <div className="flex flex-col items-center gap-0.5">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-text-secondary">{t('vacaciones.calculo_col_recargo')}</span>
                            <span className="font-bold text-amber-600">${r.recargo_30.toFixed(2)}</span>
                        </div>
                        <span className="text-text-secondary font-bold text-[16px]">=</span>
                        <div className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg ${color.bg}`}>
                            <span className="text-[9px] font-bold uppercase tracking-widest text-text-secondary">{t('vacaciones.calculo_col_total')}</span>
                            <span className={`font-bold text-[15px] ${color.text}`}>${r.monto_total.toFixed(2)}</span>
                        </div>
                    </div>

                    <button
                        type="button"
                        disabled={isConciliando}
                        onClick={onToggleConciliado}
                        className={`flex items-center justify-center gap-1.5 px-md py-1.5 rounded-lg text-[12px] font-semibold border transition-colors disabled:opacity-50 ${
                            r.conciliado ? 'bg-surface border-border text-text-secondary hover:bg-surface-hover' : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                        }`}
                    >
                        <CheckCircle2 size={13} /> {r.conciliado ? t('vacaciones.action_marcar_pendiente') : t('vacaciones.action_marcar_conciliado')}
                    </button>
                </div>
            </div>
        </div>
    );
};

/**
 * Panel de Indicadores y Calendario (US-VAC-00 / IMPL-64) + Registrar/Editar Vacaciones
 * (US-VAC-01/02 / IMPL-65/66). El calendario (CA2) es navegable mes a mes y es independiente
 * de la quincena seleccionada para el formulario — por eso el dataset base es `getTodas()`,
 * no `getPorQuincena`. El selector de quincena solo importa al momento de REGISTRAR (define en
 * qué quincena se incluyen los días como laborados, US-VAC-01 CA4).
 */
export const VacacionesView: React.FC = () => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const { quincenaId, quincena, quincenaCerrada } = usePlanillaContext();
    const { profile } = useAuthStore();

    const [empleados, setEmpleados] = useState<EmpleadoActivo[]>([]);
    const [registros, setRegistros] = useState<Vacacion[]>([]);
    const [adelantosActivos, setAdelantosActivos] = useState<AdelantoRecargoVacacion[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [mesActual, setMesActual] = useState(() => { const d = new Date(); return { anio: d.getFullYear(), mes: d.getMonth() }; });

    // IMPL-143 (hallazgo UAT) + IMPL-154 (defecto UAT) — el calendario debe abrir en el mes de
    // la quincena seleccionada, no en el mes real del sistema. Antes se sincronizaba una sola
    // vez con un ref-guard ("no en cada cambio posterior"), así que cambiar el selector después
    // del primer render no movía nada — el usuario podía elegir cualquier otra quincena y seguía
    // viendo siempre la misma. Ahora se resincroniza cada vez que cambia la quincena elegida; la
    // navegación manual del calendario (mes siguiente/anterior) sigue libre después de eso, ya
    // que el efecto solo depende de `quincena?.id`, no de `mesActual`.
    useEffect(() => {
        if (!quincena) return;
        const inicio = new Date(`${quincena.fecha_inicio}T00:00:00`);
        setMesActual({ anio: inicio.getFullYear(), mes: inicio.getMonth() });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [quincena?.id]);

    const [showModal, setShowModal] = useState(false);
    const [editTarget, setEditTarget] = useState<Vacacion | null>(null);
    const [filtroBusqueda, setFiltroBusqueda] = useState('');

    const cargarDatos = () => {
        setIsLoading(true);
        Promise.all([
            planillaEmpleadosService.getEmpleadosActivos(),
            vacacionesService.getTodas(),
            vacacionesService.getAdelantosActivos(),
        ])
            .then(([emps, regs, adelantos]) => { setEmpleados(emps); setRegistros(regs); setAdelantosActivos(adelantos); })
            .catch((err: unknown) => {
                Logger.error('Error al cargar vacaciones', {}, err);
            })
            .finally(() => setIsLoading(false));
    };

    useEffect(() => {
        cargarDatos();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const empleadoPorId = useMemo(() => new Map(empleados.map((e) => [e.id, e])), [empleados]);
    const nombreEmpleado = (empleadoId: string): string => empleadoPorId.get(empleadoId)?.nombre_completo ?? empleadoId;

    /** IMPL-132 (Observación General UAT) — código de empleado junto al nombre en la lista. */
    const codigoEmpleado = (empleadoId: string): string => {
        const emp = empleadoPorId.get(empleadoId);
        return emp ? getCodigoEmpleado(emp) : '';
    };

    /** Color estable por empleado a través de toda la sesión (no se recalcula al navegar de
     * mes ni al buscar), asignado por orden alfabético de nombre. */
    const colorIdxPorEmpleado = useMemo(() => {
        const idsOrdenados = [...new Set(registros.map((r) => r.empleado_id))]
            .sort((a, b) => nombreEmpleado(a).localeCompare(nombreEmpleado(b)));
        return new Map(idsOrdenados.map((id, i) => [id, i]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [registros, empleados]);

    const primerDiaMes = new Date(mesActual.anio, mesActual.mes, 1);
    const diasEnMes = new Date(mesActual.anio, mesActual.mes + 1, 0).getDate();
    const inicioMesISO = fechaISO(mesActual.anio, mesActual.mes, 1);
    const finMesISO = fechaISO(mesActual.anio, mesActual.mes, diasEnMes);
    const hoyISO = fechaISO(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

    /** CA2 — "el período" del CALENDARIO es el mes visible en la grilla, independiente de la
     * quincena seleccionada (decisión de IMPL-64, sigue vigente: es un calendario navegable, no
     * tendría sentido cortarlo a mitad de mes). */
    const vacacionesDelMes = useMemo(
        () => registros.filter((r) => r.fecha_inicio <= finMesISO && r.fecha_fin >= inicioMesISO),
        [registros, inicioMesISO, finMesISO]
    );

    /** IMPL-154 (defecto UAT, reabierto) — los INDICADORES y la LISTA de tarjetas sí deben
     * acotarse a la quincena específica seleccionada arriba, no al mes completo. Antes ambos
     * compartían `vacacionesDelMes`: con la 2da Quincena de Julio elegida, seguían mostrando
     * registros de la 1ra Quincena de Julio (mismo mes, quincena distinta) — el fix de IMPL-154
     * original solo había corregido la granularidad de MES (dejó de mostrar el mes equivocado),
     * nunca la de quincena dentro del mes. El calendario (`vacacionesDelMes` arriba) NO se toca
     * — sigue siendo mensual a propósito. */
    const vacacionesDeQuincena = useMemo(() => {
        if (!quincena) return registros;
        return registros.filter((r) => r.fecha_inicio <= quincena.fecha_fin && r.fecha_fin >= quincena.fecha_inicio);
    }, [registros, quincena]);

    const indicadores = useMemo(() => ({
        empleados: new Set(vacacionesDeQuincena.map((r) => r.empleado_id)).size,
        totalDias: vacacionesDeQuincena.reduce((sum, r) => sum + r.dias, 0),
        conciliados: vacacionesDeQuincena.filter((r) => r.conciliado).length,
        pendientes: vacacionesDeQuincena.filter((r) => !r.conciliado).length,
        montoTotal: vacacionesDeQuincena.reduce((sum, r) => sum + r.monto_total, 0),
    }), [vacacionesDeQuincena]);

    const filtrarPorBusqueda = (lista: Vacacion[]): Vacacion[] => {
        const termino = filtroBusqueda.trim().toLowerCase();
        if (!termino) return lista;
        return lista.filter((r) => {
            const emp = empleadoPorId.get(r.empleado_id);
            return emp?.nombre_completo.toLowerCase().includes(termino) || (!!emp && getCodigoEmpleado(emp).toLowerCase().includes(termino));
        });
    };

    const registrosFiltrados = useMemo(
        () => filtrarPorBusqueda(vacacionesDeQuincena),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [vacacionesDeQuincena, empleadoPorId, filtroBusqueda]
    );

    /** El calendario y su leyenda siguen alimentándose del dataset MENSUAL (no del de la
     * quincena) — solo se le aplica la misma búsqueda, para que buscar un empleado acote el
     * calendario igual que antes (fidelidad DEMO), sin heredar el recorte de quincena. */
    const vacacionesDelMesFiltrado = useMemo(
        () => filtrarPorBusqueda(vacacionesDelMes),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [vacacionesDelMes, empleadoPorId, filtroBusqueda]
    );

    /** CA2 — celdas del grid mensual, con hasta 3 puntos de color por día. */
    const celdasCalendario = useMemo(() => {
        const primerDiaSemana = primerDiaMes.getDay();
        const celdas: { dia: number | null; iso: string | null; vacs: Vacacion[] }[] = [];
        for (let i = 0; i < primerDiaSemana; i++) celdas.push({ dia: null, iso: null, vacs: [] });
        for (let dia = 1; dia <= diasEnMes; dia++) {
            const iso = fechaISO(mesActual.anio, mesActual.mes, dia);
            const vacs = vacacionesDelMesFiltrado.filter((r) => r.fecha_inicio <= iso && r.fecha_fin >= iso);
            celdas.push({ dia, iso, vacs });
        }
        return celdas;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vacacionesDelMesFiltrado, mesActual]);

    /** Leyenda acotada a los empleados visibles en el mes+búsqueda actual (no a todo el
     * histórico), aunque el color asignado a cada uno es estable de por vida. */
    const empleadosEnLeyenda = useMemo(
        () => [...new Set(vacacionesDelMesFiltrado.map((r) => r.empleado_id))]
            .sort((a, b) => nombreEmpleado(a).localeCompare(nombreEmpleado(b))),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [vacacionesDelMesFiltrado]
    );

    const [conciliandoId, setConciliandoId] = useState<string | null>(null);
    const [eliminarObjetivo, setEliminarObjetivo] = useState<Vacacion | null>(null);
    const [isEliminando, setIsEliminando] = useState(false);

    /** US-VAC-04 (IMPL-68) — auditado automáticamente vía el trigger genérico ya definido
     * en la migración de IMPL-65/66, mismo criterio que Anticipos/Descuentos. */
    const handleConfirmarEliminar = async () => {
        if (!eliminarObjetivo) return;
        setIsEliminando(true);
        try {
            await vacacionesService.eliminar(eliminarObjetivo.id);
            setRegistros((prev) => prev.filter((r) => r.id !== eliminarObjetivo.id));
            showToast(t('vacaciones.toast_eliminado'), 'success');
            setEliminarObjetivo(null);
        } catch (err: unknown) {
            Logger.error('Error al eliminar vacación', { id: eliminarObjetivo.id }, err);
            showToast(err instanceof Error ? err.message : t('vacaciones.error_eliminar'), 'error');
        } finally {
            setIsEliminando(false);
        }
    };

    /** US-VAC-03 (IMPL-67) CA1 — toggle directo desde la tarjeta, sin abrir el formulario. */
    const handleToggleConciliado = async (registro: Vacacion) => {
        setConciliandoId(registro.id);
        try {
            const actualizado = await vacacionesService.cambiarConciliado(registro.id, !registro.conciliado);
            setRegistros((prev) => prev.map((r) => (r.id === registro.id ? actualizado : r)));
        } catch (err: unknown) {
            Logger.error('Error al cambiar conciliado', { id: registro.id }, err);
            showToast(err instanceof Error ? err.message : t('vacaciones.error_conciliar'), 'error');
        } finally {
            setConciliandoId(null);
        }
    };

    /** Observación de reunión (2026-10-05) — lista de empleados que cumplen aniversario de
     * ingreso DENTRO de esta quincena específica (no los demás), para que el Preparador pueda
     * avisarles y decidir si corresponde pagarles el 30% de recargo por adelantado (US pendiente
     * de diseño, ver conversación). Puramente informativo — sin ninguna acción desde acá. */
    const empleadosConAniversario = useMemo(() => {
        if (!quincena) return [];
        return empleados
            .map((e) => {
                if (!e.fecha_ingreso) return null;
                const aniversario = aniversarioEnQuincena(e.fecha_ingreso, quincena.fecha_inicio, quincena.fecha_fin);
                return aniversario ? { empleado: e, ...aniversario } : null;
            })
            .filter((v): v is { empleado: EmpleadoActivo; fecha: string; anios: number } => v !== null)
            .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.empleado.nombre_completo.localeCompare(b.empleado.nombre_completo));
    }, [empleados, quincena]);

    const adelantoPorEmpleado = useMemo(
        () => new Map(adelantosActivos.map((a) => [a.empleado_id, a])),
        [adelantosActivos],
    );

    const [confirmarAdelanto, setConfirmarAdelanto] = useState<{ empleado: EmpleadoActivo; anios: number } | null>(null);
    const [procesandoAdelanto, setProcesandoAdelanto] = useState(false);
    const [deshaciendoAdelantoId, setDeshaciendoAdelantoId] = useState<string | null>(null);

    const handlePagarAdelanto = async () => {
        if (!confirmarAdelanto || !quincenaId || !profile || !confirmarAdelanto.empleado.sueldo_mensual) return;
        setProcesandoAdelanto(true);
        try {
            const nuevo = await vacacionesService.crearAdelantoRecargo({
                empleadoId: confirmarAdelanto.empleado.id,
                quincenaId,
                anioAniversario: confirmarAdelanto.anios,
                sueldoMensual: confirmarAdelanto.empleado.sueldo_mensual,
                userId: profile.id,
            });
            setAdelantosActivos((prev) => [...prev, nuevo]);
            showToast(t('vacaciones.toast_adelanto_pagado'), 'success');
            setConfirmarAdelanto(null);
        } catch (err: unknown) {
            Logger.error('Error al pagar adelanto de recargo', { empleadoId: confirmarAdelanto.empleado.id }, err);
            showToast(err instanceof Error ? err.message : t('vacaciones.error_adelanto'), 'error');
        } finally {
            setProcesandoAdelanto(false);
        }
    };

    const handleDeshacerAdelanto = async (adelanto: AdelantoRecargoVacacion) => {
        setDeshaciendoAdelantoId(adelanto.id);
        try {
            await vacacionesService.eliminarAdelantoRecargo(adelanto.id);
            setAdelantosActivos((prev) => prev.filter((a) => a.id !== adelanto.id));
            showToast(t('vacaciones.toast_adelanto_deshecho'), 'success');
        } catch (err: unknown) {
            Logger.error('Error al deshacer adelanto de recargo', { id: adelanto.id }, err);
            showToast(err instanceof Error ? err.message : t('vacaciones.error_adelanto'), 'error');
        } finally {
            setDeshaciendoAdelantoId(null);
        }
    };

    const hayFiltrosActivos = filtroBusqueda.trim() !== '';
    const handleLimpiarFiltros = () => setFiltroBusqueda('');

    const handleGuardado = (registro: Vacacion, esNuevo: boolean) => {
        setRegistros((prev) => (esNuevo ? [registro, ...prev] : prev.map((r) => (r.id === registro.id ? registro : r))));
        showToast(esNuevo ? t('vacaciones.toast_guardado') : t('vacaciones.toast_actualizado'), 'success');
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            {isLoading ? (
                <div className="h-32 bg-surface rounded-lg animate-pulse" />
            ) : (
                <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-md">
                        {[
                            { label: t('vacaciones.stat_empleados'), value: indicadores.empleados },
                            { label: t('vacaciones.stat_total_dias'), value: indicadores.totalDias },
                            { label: t('vacaciones.stat_conciliados'), value: indicadores.conciliados },
                            { label: t('vacaciones.stat_pendientes'), value: indicadores.pendientes },
                        ].map((s) => (
                            <div key={s.label} className="bg-white rounded-lg shadow-cards border border-border p-md">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{s.label}</p>
                                <p className="text-[1.75rem] font-bold mt-xs text-heading">{s.value}</p>
                            </div>
                        ))}
                    </div>

                    {empleadosConAniversario.length > 0 && (
                        <section className="flex flex-col gap-2 bg-white rounded-lg shadow-cards border border-border p-lg">
                            <div className="flex items-center gap-2">
                                <Gift size={16} className="text-primary" />
                                <p className="text-body font-bold text-heading">{t('vacaciones.aniversarios_title', { count: empleadosConAniversario.length })}</p>
                            </div>
                            <p className="text-[12px] text-text-secondary">{t('vacaciones.aniversarios_subtitulo')}</p>
                            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">{t('vacaciones.aniversarios_advertencia_motor')}</p>
                            <ul className="flex flex-col gap-1 mt-1">
                                {empleadosConAniversario.map(({ empleado, fecha, anios }) => {
                                    const adelanto = adelantoPorEmpleado.get(empleado.id);
                                    return (
                                        <li key={empleado.id} className="flex flex-wrap items-center justify-between gap-sm text-[13px] border-b border-border/40 last:border-b-0 py-1.5">
                                            <span className="font-semibold text-heading">{empleado.nombre_completo} <span className="text-[11px] font-mono font-normal text-text-secondary">{getCodigoEmpleado(empleado)}</span></span>
                                            <div className="flex items-center gap-sm shrink-0">
                                                <span className="text-text-secondary">{fmtPeriodo(fecha)} · {t('vacaciones.aniversarios_anios', { count: anios })}</span>
                                                {adelanto ? (
                                                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary">
                                                        <CheckCircle2 size={12} /> {t('vacaciones.adelanto_pagado', { monto: adelanto.recargo_monto.toFixed(2) })}
                                                        {!quincenaCerrada && (
                                                            <button
                                                                type="button"
                                                                disabled={deshaciendoAdelantoId === adelanto.id}
                                                                onClick={() => handleDeshacerAdelanto(adelanto)}
                                                                className="p-0.5 text-text-secondary hover:text-error transition-colors rounded disabled:opacity-50"
                                                                title={t('vacaciones.adelanto_deshacer') ?? undefined}
                                                            >
                                                                <Undo2 size={12} />
                                                            </button>
                                                        )}
                                                    </span>
                                                ) : !quincenaCerrada && empleado.sueldo_mensual && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setConfirmarAdelanto({ empleado, anios })}
                                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-primary-light text-primary border border-primary/20 hover:bg-primary/10 transition-colors"
                                                    >
                                                        <Gift size={11} /> {t('vacaciones.adelanto_boton')}
                                                    </button>
                                                )}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    )}

                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                        <div className="flex flex-col sm:flex-row gap-2 flex-1">
                            <div className="relative flex-1">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
                                <input
                                    type="text"
                                    value={filtroBusqueda}
                                    onChange={(e) => setFiltroBusqueda(e.target.value)}
                                    placeholder={t('vacaciones.filtro_busqueda_placeholder')}
                                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-white text-sm shadow-cards focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-colors"
                                />
                                {filtroBusqueda && (
                                    <button type="button" onClick={() => setFiltroBusqueda('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-heading transition-colors">
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                            {hayFiltrosActivos && (
                                <button
                                    type="button"
                                    onClick={handleLimpiarFiltros}
                                    className="flex items-center gap-xs px-md py-2 text-[13px] font-semibold text-text-secondary hover:text-heading transition-colors shrink-0"
                                >
                                    <X size={14} /> {t('vacaciones.action_limpiar_filtros')}
                                </button>
                            )}
                        </div>
                        {!quincenaCerrada && (
                            <Button type="button" onClick={() => { setEditTarget(null); setShowModal(true); }} className="flex items-center gap-1.5 shrink-0">
                                <Plus size={16} /> {t('vacaciones.action_registrar')}
                            </Button>
                        )}
                    </div>

                    {/* CA2 — calendario mensual navegable */}
                    <section className="flex flex-col gap-3 bg-white rounded-lg shadow-cards border border-border p-lg">
                        <div className="flex items-center justify-between">
                            <button type="button" onClick={() => setMesActual((m) => (m.mes === 0 ? { anio: m.anio - 1, mes: 11 } : { anio: m.anio, mes: m.mes - 1 }))} className="p-1.5 rounded-md hover:bg-surface text-text-secondary">
                                <ChevronLeft size={18} />
                            </button>
                            <div className="text-center">
                                <p className="text-body font-semibold text-heading">{MESES_LABEL[mesActual.mes]} {mesActual.anio}</p>
                                <p className="text-[11px] text-text-secondary">{t('vacaciones.calendario_empleados_mes', { count: empleadosEnLeyenda.length })}</p>
                            </div>
                            <button type="button" onClick={() => setMesActual((m) => (m.mes === 11 ? { anio: m.anio + 1, mes: 0 } : { anio: m.anio, mes: m.mes + 1 }))} className="p-1.5 rounded-md hover:bg-surface text-text-secondary">
                                <ChevronRight size={18} />
                            </button>
                        </div>

                        {empleadosEnLeyenda.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {empleadosEnLeyenda.map((empleadoId) => {
                                    const color = COLORES[(colorIdxPorEmpleado.get(empleadoId) ?? 0) % COLORES.length];
                                    return (
                                        <div key={empleadoId} className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${color.bg} ${color.text} ${color.border}`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
                                            {iniciales(nombreEmpleado(empleadoId))} — {nombreEmpleado(empleadoId).split(' ')[0]}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <div className="grid grid-cols-7 gap-1 text-center">
                            {['D', 'L', 'M', 'M', 'J', 'V', 'S'].map((d, i) => (
                                <p key={i} className="text-[10px] font-bold uppercase text-text-secondary">{d}</p>
                            ))}
                            {celdasCalendario.map((c, i) => (
                                <div
                                    key={i}
                                    className={`min-h-[3rem] rounded-md p-1 flex flex-col items-center transition-colors ${
                                        c.vacs.length > 0 ? 'bg-primary-light' : c.dia ? 'bg-surface/50 hover:bg-surface' : ''
                                    } ${c.iso === hoyISO && c.vacs.length === 0 ? 'ring-1 ring-primary' : ''}`}
                                >
                                    {c.dia && (
                                        <>
                                            <p className={`text-[11px] ${c.vacs.length > 0 ? 'text-primary font-semibold' : 'text-text-secondary'}`}>{c.dia}</p>
                                            <div className="flex flex-wrap gap-0.5 justify-center mt-0.5">
                                                {c.vacs.slice(0, 3).map((v) => (
                                                    <span key={v.id} className={`w-1.5 h-1.5 rounded-full ${COLORES[(colorIdxPorEmpleado.get(v.empleado_id) ?? 0) % COLORES.length].dot}`} title={nombreEmpleado(v.empleado_id)} />
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>

                    <div className="flex flex-col gap-sm">
                        <div className="flex items-center justify-between">
                            <p className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">
                                {t('vacaciones.listado_contador', { count: registrosFiltrados.length })}
                            </p>
                            <p className="text-[12px] font-bold text-heading">{t('vacaciones.footer_monto_total', { monto: indicadores.montoTotal.toFixed(2) })}</p>
                        </div>

                        {registrosFiltrados.length === 0 ? (
                            <div className="bg-white rounded-xl border border-border shadow-cards p-xl flex flex-col items-center gap-md text-center">
                                <div className="w-14 h-14 rounded-full bg-surface flex items-center justify-center">
                                    <Palmtree size={24} className="text-text-secondary" />
                                </div>
                                <div>
                                    <p className="text-body font-bold text-heading">
                                        {filtroBusqueda ? t('vacaciones.listado_sin_resultados_title') : t('vacaciones.listado_empty_title')}
                                    </p>
                                    <p className="text-[12px] text-text-secondary mt-xs">
                                        {filtroBusqueda ? t('vacaciones.listado_sin_resultados', { busqueda: filtroBusqueda }) : t('vacaciones.listado_empty')}
                                    </p>
                                </div>
                                {!filtroBusqueda && !quincenaCerrada && (
                                    <button
                                        type="button"
                                        onClick={() => { setEditTarget(null); setShowModal(true); }}
                                        className="flex items-center gap-1.5 px-md py-2 bg-primary text-white rounded-xl text-body font-semibold hover:bg-primary-dark transition-colors"
                                    >
                                        <Plus size={14} /> {t('vacaciones.action_registrar_primera')}
                                    </button>
                                )}
                            </div>
                        ) : (
                            registrosFiltrados.map((r) => (
                                <VacacionCard
                                    key={r.id}
                                    r={r}
                                    nombreEmpleado={nombreEmpleado(r.empleado_id)}
                                    codigoEmpleado={codigoEmpleado(r.empleado_id)}
                                    colorIdx={colorIdxPorEmpleado.get(r.empleado_id) ?? 0}
                                    isConciliando={conciliandoId === r.id}
                                    quincenaCerrada={quincenaCerrada}
                                    onToggleConciliado={() => handleToggleConciliado(r)}
                                    onEditar={() => { setEditTarget(r); setShowModal(true); }}
                                    onEliminar={() => setEliminarObjetivo(r)}
                                />
                            ))
                        )}
                    </div>
                </>
            )}

            <ConfirmModal
                isOpen={eliminarObjetivo !== null}
                onClose={() => setEliminarObjetivo(null)}
                onConfirm={handleConfirmarEliminar}
                title={t('vacaciones.eliminar_confirm_title')}
                message={eliminarObjetivo ? t('vacaciones.eliminar_confirm_message', { empleado: nombreEmpleado(eliminarObjetivo.empleado_id), rango: `${eliminarObjetivo.fecha_inicio} — ${eliminarObjetivo.fecha_fin}` }) : ''}
                confirmLabel={t('vacaciones.eliminar_confirm_action')}
                cancelLabel={t('vacaciones.action_cancelar')}
                variant="danger"
                Icon={Trash2}
                isLoading={isEliminando}
            />

            <ConfirmModal
                isOpen={confirmarAdelanto !== null}
                onClose={() => setConfirmarAdelanto(null)}
                onConfirm={handlePagarAdelanto}
                title={t('vacaciones.adelanto_confirm_title')}
                message={confirmarAdelanto ? t('vacaciones.adelanto_confirm_message', {
                    empleado: confirmarAdelanto.empleado.nombre_completo,
                    monto: calcularRecargoAdelanto(confirmarAdelanto.empleado.sueldo_mensual).toFixed(2),
                }) : ''}
                confirmLabel={t('vacaciones.adelanto_confirm_action')}
                cancelLabel={t('vacaciones.action_cancelar')}
                variant="warning"
                Icon={Gift}
                isLoading={procesandoAdelanto}
            />

            {showModal && (
                <VacacionModal
                    empleados={empleados}
                    quincenaId={quincenaId}
                    quincenaFechaInicio={quincena?.fecha_inicio}
                    quincenaFechaFin={quincena?.fecha_fin}
                    registroExistente={editTarget}
                    onClose={() => { setShowModal(false); setEditTarget(null); }}
                    onSaved={handleGuardado}
                />
            )}
        </div>
    );
};
