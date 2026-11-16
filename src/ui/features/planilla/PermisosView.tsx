import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, CalendarOff, X } from 'lucide-react';

import { useToast } from '../../../context/ToastContext';
import { usePlanillaContext } from './PlanillaLayout';
import { planillaEmpleadosService, type Empleado } from '../../../services/planillaEmpleadosService';
import { permisosService, type Permiso } from '../../../services/permisosService';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/ConfirmModal';
import { PermisoModal } from './components/PermisoModal';
import { Logger } from '../../../utils/logger';
import { getCodigoEmpleado } from '../../../utils/empleadoCodigoUtils';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual'>;

const PermisoCard: React.FC<{
    registro: Permiso;
    nombreEmpleado: string;
    codigoEmpleado: string;
    quincenaCerrada: boolean;
    onEditar: () => void;
    onEliminar: () => void;
}> = ({ registro: r, nombreEmpleado, codigoEmpleado, quincenaCerrada, onEditar, onEliminar }) => {
    const { t } = useTranslation();
    const esConGoce = r.tipo === 'con_goce';
    const descripcionGranularidad = r.granularidad === 'dia_completo'
        ? t('permisos.granularidad_dia_completo')
        : r.granularidad === 'medio_dia'
        ? t('permisos.descripcion_medio_dia', { turno: r.turno === 'manana' ? t('permisos.turno_manana') : t('permisos.turno_tarde') })
        : t('permisos.descripcion_horas', { horas: r.horas });

    return (
        <div className="bg-white rounded-xl border border-border shadow-cards overflow-hidden">
            <div className="flex">
                <div className={`w-1.5 shrink-0 ${esConGoce ? 'bg-primary' : 'bg-amber-400'}`} />
                <div className="flex-1 p-md flex flex-col gap-sm">
                    <div className="flex flex-wrap items-start justify-between gap-sm">
                        <div className="min-w-0">
                            <p className="text-body font-bold text-heading truncate">{nombreEmpleado}</p>
                            <p className="text-[11px] text-text-secondary font-mono mt-0.5">{codigoEmpleado}</p>
                        </div>
                        <div className="flex flex-wrap gap-xs shrink-0 items-center">
                            <span className={`inline-flex items-center gap-xs px-sm py-0.5 rounded-full text-[10px] font-bold border ${esConGoce ? 'bg-primary-light text-primary border-primary/20' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                                {t(`permisos.tipo_${r.tipo}`)}
                            </span>
                            {!quincenaCerrada && (
                                <>
                                    <button type="button" onClick={onEditar} className="p-1 text-text-secondary hover:text-primary transition-colors"><Pencil size={13} /></button>
                                    <button type="button" onClick={onEliminar} className="p-1 text-text-secondary hover:text-error transition-colors"><Trash2 size={13} /></button>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-lg flex-wrap text-[12px] text-text-secondary">
                        <span>{r.fecha}</span>
                        <span className="text-heading font-semibold">{descripcionGranularidad}</span>
                    </div>

                    <p className="text-[12px] text-text-secondary">{r.motivo}</p>
                </div>
            </div>
        </div>
    );
};

/**
 * Panel de Indicadores y Listado (US-PER-00) + Registrar Permiso (US-PER-01). Opera SIEMPRE
 * sobre la quincena explícitamente seleccionada (`quincenaId` del contexto compartido), nunca
 * inferida — mismo principio que IMPL-156.
 */
export const PermisosView: React.FC = () => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const { quincenaId, quincena, quincenaCerrada } = usePlanillaContext();

    const [empleados, setEmpleados] = useState<EmpleadoActivo[]>([]);
    const [registros, setRegistros] = useState<Permiso[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [showModal, setShowModal] = useState(false);
    const [editTarget, setEditTarget] = useState<Permiso | null>(null);
    const [eliminarObjetivo, setEliminarObjetivo] = useState<Permiso | null>(null);
    const [isEliminando, setIsEliminando] = useState(false);

    const [filtroBusqueda, setFiltroBusqueda] = useState('');

    useEffect(() => {
        if (!quincenaId) return;
        setIsLoading(true);
        Promise.all([
            planillaEmpleadosService.getEmpleadosActivos(),
            permisosService.getPorQuincena(quincenaId),
        ])
            .then(([emps, regs]) => { setEmpleados(emps); setRegistros(regs); })
            .catch((err: unknown) => {
                Logger.error('Error al cargar permisos', { quincenaId }, err);
                setError(t('permisos.error_cargar'));
            })
            .finally(() => setIsLoading(false));
    }, [quincenaId, t]);

    const nombreEmpleado = (empleadoId: string): string => empleados.find((e) => e.id === empleadoId)?.nombre_completo ?? empleadoId;
    const codigoEmpleado = (empleadoId: string): string => {
        const emp = empleados.find((e) => e.id === empleadoId);
        return emp ? getCodigoEmpleado(emp) : '';
    };

    const indicadores = useMemo(() => ({
        total: registros.length,
        conGoce: registros.filter((r) => r.tipo === 'con_goce').length,
        sinGoce: registros.filter((r) => r.tipo === 'sin_goce').length,
    }), [registros]);

    const registrosFiltrados = useMemo(() => {
        const termino = filtroBusqueda.trim().toLowerCase();
        if (!termino) return registros;
        return registros.filter((r) => {
            const emp = empleados.find((e) => e.id === r.empleado_id);
            return emp?.nombre_completo.toLowerCase().includes(termino) || (!!emp && getCodigoEmpleado(emp).toLowerCase().includes(termino));
        });
    }, [registros, empleados, filtroBusqueda]);

    const handleEditar = (registro: Permiso) => {
        setEditTarget(registro);
        setShowModal(true);
    };

    const handleSaved = (guardados: Permiso[]) => {
        setRegistros((prev) => {
            const idsGuardados = new Set(guardados.map((r) => r.id));
            const sinLosGuardados = prev.filter((r) => !idsGuardados.has(r.id));
            return [...guardados, ...sinLosGuardados];
        });
        showToast(editTarget ? t('permisos.toast_actualizado') : t('permisos.toast_guardado'), 'success');
        setEditTarget(null);
    };

    const handleConfirmarEliminar = async () => {
        if (!eliminarObjetivo) return;
        setIsEliminando(true);
        try {
            await permisosService.eliminar(eliminarObjetivo.id);
            setRegistros((prev) => prev.filter((r) => r.id !== eliminarObjetivo.id));
            setEliminarObjetivo(null);
        } catch (err: unknown) {
            Logger.error('Error al eliminar permiso', { id: eliminarObjetivo.id }, err);
            showToast(err instanceof Error ? err.message : t('permisos.error_eliminar'), 'error');
        } finally {
            setIsEliminando(false);
        }
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            {isLoading ? (
                <div className="h-32 bg-surface rounded-lg animate-pulse" />
            ) : (
                <>
                    <div className="grid grid-cols-3 gap-md">
                        {[
                            { label: t('permisos.stat_total'), value: indicadores.total, color: 'text-heading' },
                            { label: t('permisos.stat_con_goce'), value: indicadores.conGoce, color: 'text-primary' },
                            { label: t('permisos.stat_sin_goce'), value: indicadores.sinGoce, color: 'text-amber-600' },
                        ].map((s) => (
                            <div key={s.label} className="bg-white rounded-lg shadow-cards border border-border p-md">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{s.label}</p>
                                <p className={`text-[1.75rem] font-bold mt-xs ${s.color}`}>{s.value}</p>
                            </div>
                        ))}
                    </div>

                    {registros.length === 0 ? (
                        <div className="bg-white rounded-xl border border-border shadow-cards p-xl flex flex-col items-center gap-md text-center">
                            <div className="w-14 h-14 rounded-full bg-surface flex items-center justify-center">
                                <CalendarOff size={24} className="text-text-secondary" />
                            </div>
                            <div>
                                <p className="text-body font-bold text-heading">{t('permisos.listado_empty_title')}</p>
                                <p className="text-[12px] text-text-secondary mt-xs">{t('permisos.listado_empty')}</p>
                            </div>
                            {!quincenaCerrada && (
                                <button
                                    type="button"
                                    onClick={() => setShowModal(true)}
                                    className="flex items-center gap-xs px-lg py-sm bg-primary text-white rounded-xl font-semibold text-body hover:bg-primary-dark transition-colors"
                                >
                                    <Plus size={15} /> {t('permisos.action_registrar_primero')}
                                </button>
                            )}
                        </div>
                    ) : (
                        <section className="flex flex-col gap-3">
                            <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                                <div className="flex flex-col sm:flex-row gap-2 flex-1">
                                    <input
                                        type="text"
                                        value={filtroBusqueda}
                                        onChange={(e) => setFiltroBusqueda(e.target.value)}
                                        placeholder={t('permisos.filtro_busqueda_placeholder')}
                                        className="flex-1 rounded-md border border-border bg-white px-3 py-2 text-sm"
                                    />
                                    {filtroBusqueda.trim() !== '' && (
                                        <button
                                            type="button"
                                            onClick={() => setFiltroBusqueda('')}
                                            className="flex items-center gap-xs px-md py-2 text-sm font-semibold text-text-secondary hover:text-heading transition-colors shrink-0"
                                        >
                                            <X size={14} /> {t('permisos.action_limpiar_filtros')}
                                        </button>
                                    )}
                                </div>
                                {!quincenaCerrada && (
                                    <Button type="button" onClick={() => setShowModal(true)} className="flex items-center gap-1.5 shrink-0">
                                        <Plus size={16} /> {t('permisos.action_registrar')}
                                    </Button>
                                )}
                            </div>

                            {registrosFiltrados.length === 0 ? (
                                <p className="text-caption text-text-secondary italic">{t('permisos.listado_sin_resultados')}</p>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {registrosFiltrados.map((r) => (
                                        <PermisoCard
                                            key={r.id}
                                            registro={r}
                                            nombreEmpleado={nombreEmpleado(r.empleado_id)}
                                            codigoEmpleado={codigoEmpleado(r.empleado_id)}
                                            quincenaCerrada={quincenaCerrada}
                                            onEditar={() => handleEditar(r)}
                                            onEliminar={() => setEliminarObjetivo(r)}
                                        />
                                    ))}
                                </div>
                            )}
                        </section>
                    )}
                    {error && <p className="text-caption text-error">{error}</p>}
                </>
            )}

            {showModal && (
                <PermisoModal
                    empleados={empleados}
                    quincenaId={quincenaId}
                    quincenaFechaInicio={quincena?.fecha_inicio}
                    quincenaFechaFin={quincena?.fecha_fin}
                    registroExistente={editTarget}
                    onClose={() => { setShowModal(false); setEditTarget(null); }}
                    onSaved={handleSaved}
                />
            )}

            <ConfirmModal
                isOpen={eliminarObjetivo !== null}
                onClose={() => setEliminarObjetivo(null)}
                onConfirm={handleConfirmarEliminar}
                title={t('permisos.eliminar_confirm_title')}
                message={eliminarObjetivo ? t('permisos.eliminar_confirm_message', { empleado: nombreEmpleado(eliminarObjetivo.empleado_id), fecha: eliminarObjetivo.fecha }) : ''}
                confirmLabel={t('permisos.eliminar_confirm_action')}
                cancelLabel={t('permisos.action_cancelar')}
                variant="danger"
                Icon={Trash2}
                isLoading={isEliminando}
            />
        </div>
    );
};
