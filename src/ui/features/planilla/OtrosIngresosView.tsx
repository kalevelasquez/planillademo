import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Search, X, Zap, Shield, Gift } from 'lucide-react';

import { useToast } from '../../../context/ToastContext';
import { usePlanillaContext } from './PlanillaLayout';
import { planillaEmpleadosService, type Empleado } from '../../../services/planillaEmpleadosService';
import { otrosIngresosService, type OtroIngreso } from '../../../services/otrosIngresosService';
import { otrosIngresosConceptosService, type OtroIngresoConcepto, type Gravabilidad } from '../../../services/otrosIngresosConceptosService';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/ConfirmModal';
import { OtroIngresoModal } from './components/OtroIngresoModal';
import { Logger } from '../../../utils/logger';
import { getCodigoEmpleado } from '../../../utils/empleadoCodigoUtils';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual'>;

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

interface OtroIngresoCardProps {
    r: OtroIngreso;
    nombreEmpleado: string;
    nombreConcepto: string;
    quincenaCerrada: boolean;
    onEditar: () => void;
    onEliminar: () => void;
}

const OtroIngresoCard: React.FC<OtroIngresoCardProps> = ({ r, nombreEmpleado, nombreConcepto, quincenaCerrada, onEditar, onEliminar }) => {
    const { t } = useTranslation();
    const IconoGrav = GRAVABILIDAD_ICON[r.gravabilidad];

    return (
        <div className="bg-white rounded-xl border border-border shadow-cards overflow-hidden">
            <div className="p-md flex flex-col gap-sm">
                <div className="flex items-start justify-between gap-sm">
                    <div className="flex items-center gap-sm min-w-0">
                        <div className="w-9 h-9 rounded-full bg-surface flex items-center justify-center shrink-0">
                            <span className="text-[11px] font-bold text-heading">{nombreEmpleado.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                        </div>
                        <div className="min-w-0">
                            <p className="text-body font-semibold text-heading truncate">{nombreEmpleado}</p>
                            <p className="text-[11px] text-text-secondary truncate">{nombreConcepto}</p>
                        </div>
                    </div>
                    {!quincenaCerrada && (
                        <div className="flex items-center gap-1 shrink-0">
                            <button type="button" onClick={onEditar} className="p-1 text-text-secondary hover:text-primary transition-colors rounded">
                                <Pencil size={13} />
                            </button>
                            <button type="button" onClick={onEliminar} className="p-1 text-text-secondary hover:text-error transition-colors rounded">
                                <Trash2 size={13} />
                            </button>
                        </div>
                    )}
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

/**
 * Registrar (US-OTR-01/IMPL-78) y Editar/Eliminar (US-OTR-02/IMPL-79) Otro Ingreso. Tabla simple
 * con quincena_id directo (sin cabecera+eventos, esta épica no tiene cuotas). Indicadores del
 * período (US-UX-02) extienden el mismo estilo ya usado en Bonificaciones — antes esta vista no
 * tenía ningún panel de estadísticas.
 */
export const OtrosIngresosView: React.FC = () => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const { quincenaId, quincenaCerrada } = usePlanillaContext();

    const [empleados, setEmpleados] = useState<EmpleadoActivo[]>([]);
    const [conceptos, setConceptos] = useState<OtroIngresoConcepto[]>([]);
    const [registros, setRegistros] = useState<OtroIngreso[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const [showModal, setShowModal] = useState(false);
    const [filtroBusqueda, setFiltroBusqueda] = useState('');
    const [editando, setEditando] = useState<OtroIngreso | null>(null);
    const [eliminarObjetivo, setEliminarObjetivo] = useState<OtroIngreso | null>(null);
    const [isEliminando, setIsEliminando] = useState(false);

    useEffect(() => {
        Promise.all([planillaEmpleadosService.getEmpleadosActivos(), otrosIngresosConceptosService.getActivos()])
            .then(([emps, cons]) => { setEmpleados(emps); setConceptos(cons); })
            .catch((err: unknown) => Logger.error('Error al cargar base de otros ingresos', {}, err));
    }, []);

    useEffect(() => {
        if (!quincenaId) return;
        setIsLoading(true);
        otrosIngresosService.getPorQuincena(quincenaId)
            .then(setRegistros)
            .catch((err: unknown) => Logger.error('Error al cargar otros ingresos', { quincenaId }, err))
            .finally(() => setIsLoading(false));
    }, [quincenaId]);

    const empleadoPorId = useMemo(() => new Map(empleados.map((e) => [e.id, e])), [empleados]);
    const conceptoPorId = useMemo(() => new Map(conceptos.map((c) => [c.id, c])), [conceptos]);
    const nombreEmpleado = (empleadoId: string): string => empleadoPorId.get(empleadoId)?.nombre_completo ?? empleadoId;

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

    const registrosFiltrados = useMemo(() => {
        const termino = filtroBusqueda.trim().toLowerCase();
        if (!termino) return registros;
        return registros.filter((r) => {
            const emp = empleadoPorId.get(r.empleado_id);
            return emp?.nombre_completo.toLowerCase().includes(termino) || (!!emp && getCodigoEmpleado(emp).toLowerCase().includes(termino));
        });
    }, [registros, empleadoPorId, filtroBusqueda]);

    const handleConfirmarEliminar = async () => {
        if (!eliminarObjetivo) return;
        setIsEliminando(true);
        try {
            await otrosIngresosService.eliminar(eliminarObjetivo.id);
            setRegistros((prev) => prev.filter((r) => r.id !== eliminarObjetivo.id));
            setEliminarObjetivo(null);
        } catch (err: unknown) {
            Logger.error('Error al eliminar otro ingreso', { id: eliminarObjetivo.id }, err);
            showToast(err instanceof Error ? err.message : t('otrosIngresos.error_eliminar_registro'), 'error');
        } finally {
            setIsEliminando(false);
        }
    };

    const hayFiltrosActivos = filtroBusqueda.trim() !== '';
    const handleLimpiarFiltros = () => setFiltroBusqueda('');

    const handleGuardado = (registro: OtroIngreso, esNuevo: boolean) => {
        setRegistros((prev) => (esNuevo ? [registro, ...prev] : prev.map((r) => (r.id === registro.id ? registro : r))));
        showToast(esNuevo ? t('otrosIngresos.toast_guardado') : t('otrosIngresos.toast_actualizado'), 'success');
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-md">
                <div className="bg-white rounded-lg shadow-cards border border-border p-md">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('otrosIngresos.stat_total')}</p>
                    <p className="text-[1.75rem] font-bold mt-xs text-heading">${indicadores.total.toFixed(2)}</p>
                </div>
                <div className="bg-white rounded-lg shadow-cards border border-border p-md">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('otrosIngresos.stat_registros')}</p>
                    <p className="text-[1.75rem] font-bold mt-xs text-heading">{indicadores.numRegistros}</p>
                </div>
                <div className="bg-white rounded-lg shadow-cards border border-border p-md col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('otrosIngresos.stat_split_gravabilidad')}</p>
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
                            placeholder={t('otrosIngresos.filtro_busqueda_placeholder')}
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
                            <X size={14} /> {t('otrosIngresos.action_limpiar_filtros')}
                        </button>
                    )}
                </div>
                {!quincenaCerrada && (
                    <Button type="button" onClick={() => { setEditando(null); setShowModal(true); }} className="flex items-center gap-1.5 shrink-0">
                        <Plus size={16} /> {t('otrosIngresos.action_registrar')}
                    </Button>
                )}
            </div>

            {isLoading ? (
                <div className="h-32 bg-surface rounded-lg animate-pulse" />
            ) : (
                <div className="flex flex-col gap-sm">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">
                        {t('otrosIngresos.listado_contador', { count: registrosFiltrados.length })}
                    </p>
                    {registrosFiltrados.length === 0 ? (
                        <div className="bg-white rounded-xl border border-border shadow-cards p-xl flex flex-col items-center gap-md text-center">
                            <div className="w-14 h-14 rounded-full bg-surface flex items-center justify-center">
                                {filtroBusqueda ? <Search size={24} className="text-text-secondary" /> : <Gift size={24} className="text-text-secondary" />}
                            </div>
                            <div>
                                <p className="text-body font-bold text-heading">
                                    {filtroBusqueda ? t('otrosIngresos.listado_sin_resultados_title') : t('otrosIngresos.listado_empty_title')}
                                </p>
                                <p className="text-[12px] text-text-secondary mt-xs">
                                    {filtroBusqueda ? t('otrosIngresos.listado_sin_resultados') : t('otrosIngresos.listado_empty')}
                                </p>
                            </div>
                            {!filtroBusqueda && !quincenaCerrada && (
                                <button
                                    type="button"
                                    onClick={() => { setEditando(null); setShowModal(true); }}
                                    className="flex items-center gap-1.5 px-md py-2 bg-primary text-white rounded-xl text-body font-semibold hover:bg-primary-dark transition-colors"
                                >
                                    <Plus size={14} /> {t('otrosIngresos.action_registrar_primera')}
                                </button>
                            )}
                        </div>
                    ) : (
                        registrosFiltrados.map((r) => (
                            <OtroIngresoCard
                                key={r.id}
                                r={r}
                                nombreEmpleado={nombreEmpleado(r.empleado_id)}
                                nombreConcepto={conceptoPorId.get(r.concepto_id)?.nombre ?? '—'}
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
                title={t('otrosIngresos.eliminar_confirm_title')}
                message={eliminarObjetivo ? t('otrosIngresos.eliminar_confirm_message', { empleado: nombreEmpleado(eliminarObjetivo.empleado_id) }) : ''}
                confirmLabel={t('vacaciones.eliminar_confirm_action')}
                cancelLabel={t('vacaciones.action_cancelar')}
                variant="danger"
                Icon={Trash2}
                isLoading={isEliminando}
            />

            {showModal && (
                <OtroIngresoModal
                    empleados={empleados}
                    conceptos={conceptos}
                    conceptoPorId={conceptoPorId}
                    quincenaId={quincenaId}
                    registroExistente={editando}
                    onClose={() => { setShowModal(false); setEditando(null); }}
                    onSaved={handleGuardado}
                />
            )}
        </div>
    );
};
