import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calculator, Plus, Pencil, Trash2, Search, X, Users, Wand2, Zap, Shield, ChevronDown, ChevronUp } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { useToast } from '../../../context/ToastContext';
import { usePlanillaContext } from './PlanillaLayout';
import { detectarRangoQuincenal } from '../../../utils/quincenaUtils';
import { planillaEmpleadosService, type Empleado } from '../../../services/planillaEmpleadosService';
import { bonificacionesService, type Bonificacion } from '../../../services/bonificacionesService';
import { bonificacionTiposService, type BonificacionTipo } from '../../../services/bonificacionTiposService';
import { tablasIncentivosService, type TablaIncentivoConRangos } from '../../../services/tablasIncentivosService';
import type { Gravabilidad } from '../../../services/otrosIngresosConceptosService';
import { InputField } from '../../components/InputField';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/ConfirmModal';
import { BonificacionModal } from './components/BonificacionModal';
import { Logger } from '../../../utils/logger';
import { getCodigoEmpleado } from '../../../utils/empleadoCodigoUtils';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'codigo' | 'codigo_empleado_manual'>;

const GRAVABILIDAD_BADGE: Record<Gravabilidad, string> = {
    gravable: 'bg-primary-light text-primary border border-primary/20',
    no_gravable: 'bg-surface text-text-secondary border border-border',
    bono_10: 'bg-amber-50 text-amber-700 border border-amber-200',
};

const GRAVABILIDAD_ICON: Record<Gravabilidad, typeof Zap> = {
    gravable: Zap,
    no_gravable: Shield,
    bono_10: Zap,
};

const COLORES_TIPO = [
    { bg: 'bg-primary-light', text: 'text-primary', border: 'border-primary/20', dot: 'bg-primary' },
    { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
    { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
    { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500' },
    { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200', dot: 'bg-pink-500' },
];

interface BonificacionCardProps {
    r: Bonificacion;
    nombreEmpleado: string;
    codigoEmpleado: string;
    nombreTipo: string;
    colorIdxTipo: number;
    quincenaCerrada: boolean;
    onEditar: () => void;
    onEliminar: () => void;
}

const BonificacionCard: React.FC<BonificacionCardProps> = ({ r, nombreEmpleado, codigoEmpleado, nombreTipo, colorIdxTipo, quincenaCerrada, onEditar, onEliminar }) => {
    const { t } = useTranslation();
    const colorTipo = COLORES_TIPO[colorIdxTipo % COLORES_TIPO.length];
    const IconoGrav = GRAVABILIDAD_ICON[r.gravabilidad];

    return (
        <div className={`bg-white rounded-xl border shadow-cards overflow-hidden ${r.origen === 'automatico' ? 'border-purple-200' : 'border-border'}`}>
            <div className="p-md flex flex-col gap-sm">
                <div className="flex items-start justify-between gap-sm">
                    <div className="flex items-center gap-sm min-w-0">
                        <div className="w-9 h-9 rounded-full bg-surface flex items-center justify-center shrink-0">
                            <span className="text-[11px] font-bold text-heading">{nombreEmpleado.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                        </div>
                        <div className="min-w-0">
                            <p className="text-body font-semibold text-heading truncate">{nombreEmpleado}</p>
                            <p className="text-[11px] text-text-secondary font-mono">{codigoEmpleado}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                        {r.origen === 'automatico' ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-purple-50 text-purple-700 border-purple-200">
                                <Wand2 size={10} /> {t('bonificaciones.origen_automatico')}
                            </span>
                        ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-surface text-text-secondary border-border">
                                {t('bonificaciones.origen_manual')}
                            </span>
                        )}
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${colorTipo.bg} ${colorTipo.text} ${colorTipo.border}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${colorTipo.dot}`} /> {nombreTipo}
                        </span>
                        {r.origen === 'manual' && !quincenaCerrada && (
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
                <div className="flex items-center justify-between gap-sm pt-1 border-t border-border">
                    <p className="text-[1.25rem] font-bold text-heading">${r.monto.toFixed(2)}</p>
                    <span className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold rounded-lg ${GRAVABILIDAD_BADGE[r.gravabilidad]}`}>
                        <IconoGrav size={12} /> {t(`otrosIngresos.gravabilidad_${r.gravabilidad}`)}
                    </span>
                </div>
            </div>
        </div>
    );
};

interface IncentivosPanelProps {
    tablas: TablaIncentivoConRangos[];
    utilidadNeta: number;
    nombreEmpleado: (id: string) => string;
}

/** Panel colapsable de visibilidad para el Preparador (fidelidad DEMO): muestra las tablas de
 * incentivo REALES ya configuradas (`tablasIncentivosService`) y resalta el rango que se
 * activaría con la utilidad ingresada — no simula nada, el cálculo real sigue ocurriendo
 * server-side vía `calcular_bonos_incentivo_quincena` al tocar "Calcular bonos". */
const IncentivosPanel: React.FC<IncentivosPanelProps> = ({ tablas, utilidadNeta, nombreEmpleado }) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);

    return (
        <div className="bg-white rounded-xl border border-border shadow-cards overflow-hidden">
            <button type="button" className="w-full flex items-center justify-between px-md py-2.5 hover:bg-surface transition-colors" onClick={() => setOpen((o) => !o)}>
                <div className="flex items-center gap-sm">
                    <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
                        <Calculator size={16} className="text-purple-600" />
                    </div>
                    <div className="text-left">
                        <p className="text-body font-bold text-heading">{t('bonificaciones.panel_incentivos_title')}</p>
                        <p className="text-[11px] text-text-secondary">
                            {utilidadNeta > 0
                                ? t('bonificaciones.panel_incentivos_subtitulo_con_utilidad', { utilidad: utilidadNeta.toFixed(2) })
                                : t('bonificaciones.panel_incentivos_subtitulo_sin_utilidad', { count: tablas.length })}
                        </p>
                    </div>
                </div>
                {open ? <ChevronUp size={16} className="text-text-secondary shrink-0" /> : <ChevronDown size={16} className="text-text-secondary shrink-0" />}
            </button>

            {open && (
                <div className="px-md pb-md flex flex-col gap-sm border-t border-border pt-md">
                    {tablas.length === 0 ? (
                        <p className="text-[12px] text-text-secondary italic">{t('bonificaciones.panel_incentivos_sin_tablas')}</p>
                    ) : (
                        tablas.map((tabla) => {
                            const bonoActual = utilidadNeta > 0
                                ? tabla.rangos.find((r) => utilidadNeta >= r.desde && (r.hasta === null || utilidadNeta < r.hasta))
                                : undefined;
                            const asignacion = tabla.empleado_id
                                ? t('bonificaciones.panel_incentivos_asignado_empleado', { nombre: nombreEmpleado(tabla.empleado_id) })
                                : tabla.grupo
                                    ? t('bonificaciones.panel_incentivos_asignado_grupo', { grupo: tabla.grupo })
                                    : t('bonificaciones.panel_incentivos_asignado_todos');
                            return (
                                <div key={tabla.id} className={`rounded-xl border p-md flex flex-col gap-2 transition-colors ${bonoActual ? 'bg-purple-50 border-purple-200' : 'bg-surface border-border'}`}>
                                    <div className="flex items-center justify-between gap-sm">
                                        <div className="flex items-center gap-2">
                                            <Wand2 size={14} className={bonoActual ? 'text-purple-600' : 'text-text-secondary'} />
                                            <p className="text-body font-bold text-heading">{tabla.nombre}</p>
                                        </div>
                                        {bonoActual ? (
                                            <span className="text-[11px] font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full border border-purple-200">
                                                {t('bonificaciones.panel_incentivos_bono_activo', { monto: bonoActual.bono.toFixed(2) })}
                                            </span>
                                        ) : (
                                            <span className="text-[11px] text-text-secondary">{t('bonificaciones.panel_incentivos_sin_utilidad')}</span>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-3 gap-1">
                                        {tabla.rangos.map((r) => {
                                            const isActive = utilidadNeta > 0 && utilidadNeta >= r.desde && (r.hasta === null || utilidadNeta < r.hasta);
                                            return (
                                                <div key={r.id} className={`rounded-lg p-1.5 text-center border transition-colors ${isActive ? 'bg-purple-100 border-purple-300' : 'bg-white border-border'}`}>
                                                    <p className="text-[9px] text-text-secondary font-semibold">
                                                        ${r.desde.toFixed(0)} — {r.hasta !== null ? `$${r.hasta.toFixed(0)}` : '∞'}
                                                    </p>
                                                    <p className={`text-[12px] font-bold mt-0.5 ${isActive ? 'text-purple-700' : 'text-heading'}`}>${r.bono.toFixed(2)}</p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <p className="text-[10px] text-text-secondary">{asignacion}</p>
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * Bonificaciones (US-BON-00/IMPL-72 panel+listado, US-BON-02/IMPL-74 cálculo automático,
 * US-BON-03/IMPL-75 registro manual). CA1 de US-BON-00 describe el split como "Gravable/No
 * gravable" (binario) pero el modelo de datos ya tiene 3 estados desde US-OTR-01 — se extiende
 * el split a los 3 estados reales en vez de forzar el CA original, mismo criterio que toda esta
 * épica (Gravabilidad de 3 estados es transversal). CA3 menciona "Todos los empleados"/grupo en
 * el listado, pero como cada bono (automático o manual "todos") se persiste como una fila por
 * empleado, el listado siempre muestra el empleado individual — no hay agrupación visual.
 */
export const BonificacionesView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const { quincenaId, quincena: quincenaActual, quincenaCerrada } = usePlanillaContext();

    const [empleados, setEmpleados] = useState<EmpleadoActivo[]>([]);
    const [tipos, setTipos] = useState<BonificacionTipo[]>([]);
    const [tablasIncentivo, setTablasIncentivo] = useState<TablaIncentivoConRangos[]>([]);
    const [registros, setRegistros] = useState<Bonificacion[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [utilidadNeta, setUtilidadNeta] = useState('');
    const [isCalculando, setIsCalculando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [showModal, setShowModal] = useState(false);
    const [filtroBusqueda, setFiltroBusqueda] = useState('');
    const [editando, setEditando] = useState<Bonificacion | null>(null);
    const [eliminarObjetivo, setEliminarObjetivo] = useState<Bonificacion | null>(null);
    const [isEliminando, setIsEliminando] = useState(false);

    // IMPL-74 CA3 ("se paga en la 2ª quincena del mes") — mismo criterio de derivación que
    // quincenaUtils.generarEtiquetaEstandar al crear la quincena, no un campo propio en BD.
    const esSegundaQuincena = Boolean(
        quincenaActual
        && quincenaActual.tipo === 'normal'
        && detectarRangoQuincenal(quincenaActual.fecha_inicio, quincenaActual.fecha_fin)?.periodo === '2da'
    );

    useEffect(() => {
        Promise.all([
            planillaEmpleadosService.getEmpleadosActivos(),
            bonificacionTiposService.getActivos(),
            tablasIncentivosService.getTodas(),
        ])
            .then(([emps, tps, tablas]) => { setEmpleados(emps); setTipos(tps); setTablasIncentivo(tablas); })
            .catch((err: unknown) => Logger.error('Error al cargar base de bonificaciones', {}, err));
    }, []);

    useEffect(() => {
        if (!quincenaId) return;
        setIsLoading(true);
        bonificacionesService.getPorQuincena(quincenaId)
            .then(setRegistros)
            .catch((err: unknown) => Logger.error('Error al cargar bonificaciones', { quincenaId }, err))
            .finally(() => setIsLoading(false));
    }, [quincenaId]);

    const empleadoPorId = useMemo(() => new Map(empleados.map((e) => [e.id, e])), [empleados]);
    const tipoPorId = useMemo(() => new Map(tipos.map((tp) => [tp.id, tp])), [tipos]);
    const nombreEmpleado = (empleadoId: string): string => empleadoPorId.get(empleadoId)?.nombre_completo ?? empleadoId;
    const codigoEmpleado = (empleadoId: string): string => {
        const emp = empleadoPorId.get(empleadoId);
        return emp ? getCodigoEmpleado(emp) : '';
    };

    /** Color estable por tipo, asignado por orden alfabético de nombre — mismo criterio que
     * colorIdxPorEmpleado en Vacaciones. */
    const colorIdxPorTipo = useMemo(() => {
        const idsOrdenados = [...tipos].sort((a, b) => a.nombre.localeCompare(b.nombre)).map((tp) => tp.id);
        return new Map(idsOrdenados.map((id, i) => [id, i]));
    }, [tipos]);

    /** CA1 de US-BON-00 — indicadores del período (extendidos a los 3 estados reales). */
    const indicadores = useMemo(() => {
        const total = registros.reduce((sum, r) => sum + r.monto, 0);
        const porEstado = (g: Gravabilidad) => registros.filter((r) => r.gravabilidad === g).reduce((sum, r) => sum + r.monto, 0);
        const gravable = porEstado('gravable');
        const noGravable = porEstado('no_gravable');
        const bono10 = porEstado('bono_10');
        return {
            total,
            numRegistros: registros.length,
            gravable,
            noGravable,
            bono10,
            pctGravable: total > 0 ? (gravable / total) * 100 : 0,
            pctNoGravable: total > 0 ? (noGravable / total) * 100 : 0,
            pctBono10: total > 0 ? (bono10 / total) * 100 : 0,
        };
    }, [registros]);

    /** CA2 de US-BON-00 — búsqueda por nombre o código de empleado. */
    const registrosFiltrados = useMemo(() => {
        const termino = filtroBusqueda.trim().toLowerCase();
        if (!termino) return registros;
        return registros.filter((r) => {
            const emp = empleadoPorId.get(r.empleado_id);
            return emp?.nombre_completo.toLowerCase().includes(termino) || (!!emp && getCodigoEmpleado(emp).toLowerCase().includes(termino));
        });
    }, [registros, empleadoPorId, filtroBusqueda]);

    const handleCalcular = async () => {
        if (!esSegundaQuincena || !profile?.id || !quincenaId || !utilidadNeta || Number(utilidadNeta) < 0) {
            setError(t('bonificaciones.error_utilidad_neta_requerida'));
            return;
        }
        setError(null);
        setIsCalculando(true);
        try {
            const calculados = await bonificacionesService.calcularAutomaticos(quincenaId, Number(utilidadNeta), profile.id);
            const idsCalculados = new Set(calculados.map((b) => b.id));
            setRegistros((prev) => [...calculados, ...prev.filter((r) => !idsCalculados.has(r.id))]);
            showToast(t('bonificaciones.toast_calculado', { count: calculados.length }), 'success');
        } catch (err: unknown) {
            Logger.error('Error al calcular bonos por utilidad neta', { quincenaId, utilidadNeta }, err);
            setError(t('bonificaciones.error_calcular'));
        } finally {
            setIsCalculando(false);
        }
    };

    const handleConfirmarEliminar = async () => {
        if (!eliminarObjetivo) return;
        setIsEliminando(true);
        try {
            await bonificacionesService.eliminar(eliminarObjetivo.id);
            setRegistros((prev) => prev.filter((r) => r.id !== eliminarObjetivo.id));
            setEliminarObjetivo(null);
        } catch (err: unknown) {
            Logger.error('Error al eliminar bonificación', { id: eliminarObjetivo.id }, err);
            showToast(err instanceof Error ? err.message : t('bonificaciones.error_eliminar_registro'), 'error');
        } finally {
            setIsEliminando(false);
        }
    };

    const hayFiltrosActivos = filtroBusqueda.trim() !== '';
    const handleLimpiarFiltros = () => setFiltroBusqueda('');

    const handleGuardado = (creados: Bonificacion[], esNuevo: boolean) => {
        setRegistros((prev) => {
            if (esNuevo) return [...creados, ...prev];
            return prev.map((r) => creados.find((c) => c.id === r.id) ?? r);
        });
        showToast(esNuevo ? t('bonificaciones.toast_registrado', { count: creados.length }) : t('bonificaciones.toast_actualizado'), 'success');
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            {/* CA1 de US-BON-00 — indicadores del período */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-md">
                <div className="bg-white rounded-lg shadow-cards border border-border p-md">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('bonificaciones.stat_total')}</p>
                    <p className="text-[1.75rem] font-bold mt-xs text-heading">${indicadores.total.toFixed(2)}</p>
                </div>
                <div className="bg-white rounded-lg shadow-cards border border-border p-md">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('bonificaciones.stat_registros')}</p>
                    <p className="text-[1.75rem] font-bold mt-xs text-heading">{indicadores.numRegistros}</p>
                </div>
                <div className="bg-white rounded-lg shadow-cards border border-border p-md col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('bonificaciones.stat_split_gravabilidad')}</p>
                    <div className="flex h-2 rounded-full overflow-hidden mt-2 bg-surface">
                        <div className="bg-primary" style={{ width: `${indicadores.pctGravable}%` }} />
                        <div className="bg-amber-400" style={{ width: `${indicadores.pctBono10}%` }} />
                        <div className="bg-border" style={{ width: `${indicadores.pctNoGravable}%` }} />
                    </div>
                    <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-text-secondary">
                        <span>{t('otrosIngresos.gravabilidad_gravable')}: ${indicadores.gravable.toFixed(2)}</span>
                        <span>{t('otrosIngresos.gravabilidad_bono_10')}: ${indicadores.bono10.toFixed(2)}</span>
                        <span>{t('otrosIngresos.gravabilidad_no_gravable')}: ${indicadores.noGravable.toFixed(2)}</span>
                    </div>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                <div className="flex flex-col sm:flex-row gap-2 flex-1">
                    <div className="relative flex-1">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
                        <input
                            type="text"
                            value={filtroBusqueda}
                            onChange={(e) => setFiltroBusqueda(e.target.value)}
                            placeholder={t('bonificaciones.filtro_busqueda_placeholder')}
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
                            <X size={14} /> {t('bonificaciones.action_limpiar_filtros')}
                        </button>
                    )}
                </div>
                {!quincenaCerrada && (
                    <Button type="button" onClick={() => { setEditando(null); setShowModal(true); }} className="flex items-center gap-1.5 shrink-0">
                        <Plus size={16} /> {t('bonificaciones.action_registrar_manual')}
                    </Button>
                )}
            </div>

            <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">
                <p className="text-body font-semibold text-heading">{t('bonificaciones.calculo_automatico_title')}</p>
                <p className="text-caption text-text-secondary">{t('bonificaciones.calculo_automatico_desc')}</p>
                {!esSegundaQuincena && (
                    <p className="text-caption text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-md">
                        {t('bonificaciones.calculo_automatico_no_disponible')}
                    </p>
                )}
                <div className="flex flex-col sm:flex-row items-end gap-2">
                    <InputField
                        label={t('bonificaciones.field_utilidad_neta')}
                        type="number"
                        min={0}
                        step="0.01"
                        value={utilidadNeta}
                        onChange={(e) => setUtilidadNeta(e.target.value)}
                        className="max-w-[20rem] flex-1"
                        disabled={!esSegundaQuincena}
                        required
                    />
                    <Button type="button" onClick={handleCalcular} isLoading={isCalculando} disabled={!esSegundaQuincena} className="flex items-center gap-1.5">
                        <Calculator size={16} /> {t('bonificaciones.action_calcular')}
                    </Button>
                </div>
                {error && <p className="text-caption text-error">{error}</p>}
            </section>

            <IncentivosPanel tablas={tablasIncentivo} utilidadNeta={Number(utilidadNeta) || 0} nombreEmpleado={nombreEmpleado} />

            {isLoading ? (
                <div className="h-32 bg-surface rounded-lg animate-pulse" />
            ) : (
                <div className="flex flex-col gap-sm">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">
                        {t('bonificaciones.listado_contador', { count: registrosFiltrados.length })}
                    </p>
                    {registrosFiltrados.length === 0 ? (
                        <div className="bg-white rounded-xl border border-border shadow-cards p-xl flex flex-col items-center gap-md text-center">
                            <div className="w-14 h-14 rounded-full bg-surface flex items-center justify-center">
                                <Users size={24} className="text-text-secondary" />
                            </div>
                            <div>
                                <p className="text-body font-bold text-heading">
                                    {filtroBusqueda ? t('bonificaciones.listado_sin_resultados_title') : t('bonificaciones.listado_empty_title')}
                                </p>
                                <p className="text-[12px] text-text-secondary mt-xs">
                                    {filtroBusqueda ? t('bonificaciones.listado_sin_resultados') : t('bonificaciones.listado_empty')}
                                </p>
                            </div>
                            {!filtroBusqueda && !quincenaCerrada && (
                                <button
                                    type="button"
                                    onClick={() => { setEditando(null); setShowModal(true); }}
                                    className="flex items-center gap-1.5 px-md py-2 bg-primary text-white rounded-xl text-body font-semibold hover:bg-primary-dark transition-colors"
                                >
                                    <Plus size={14} /> {t('bonificaciones.action_registrar_primera')}
                                </button>
                            )}
                        </div>
                    ) : (
                        registrosFiltrados.map((r) => (
                            <BonificacionCard
                                key={r.id}
                                r={r}
                                nombreEmpleado={nombreEmpleado(r.empleado_id)}
                                codigoEmpleado={codigoEmpleado(r.empleado_id)}
                                nombreTipo={r.tipo_id ? tipoPorId.get(r.tipo_id)?.nombre ?? '—' : '—'}
                                colorIdxTipo={r.tipo_id ? colorIdxPorTipo.get(r.tipo_id) ?? 0 : 0}
                                quincenaCerrada={quincenaCerrada}
                                onEditar={() => { setEditando(r); setShowModal(true); }}
                                onEliminar={() => setEliminarObjetivo(r)}
                            />
                        ))
                    )}
                </div>
            )}

            <ConfirmModal
                isOpen={eliminarObjetivo !== null}
                onClose={() => setEliminarObjetivo(null)}
                onConfirm={handleConfirmarEliminar}
                title={t('bonificaciones.eliminar_confirm_title')}
                message={eliminarObjetivo ? t('bonificaciones.eliminar_confirm_message', { empleado: nombreEmpleado(eliminarObjetivo.empleado_id) }) : ''}
                confirmLabel={t('vacaciones.eliminar_confirm_action')}
                cancelLabel={t('vacaciones.action_cancelar')}
                variant="danger"
                Icon={Trash2}
                isLoading={isEliminando}
            />


            {showModal && (
                <BonificacionModal
                    empleados={empleados}
                    tipos={tipos}
                    quincenaId={quincenaId}
                    nombreEmpleado={nombreEmpleado}
                    editando={editando}
                    onClose={() => { setShowModal(false); setEditando(null); }}
                    onSaved={handleGuardado}
                />
            )}
        </div>
    );
};
