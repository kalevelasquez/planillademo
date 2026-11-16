import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Pencil } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { tablasIncentivosService, type TablaIncentivoConRangos, type NuevoRango } from '../../../services/tablasIncentivosService';
import { planillaEmpleadosService, type Empleado } from '../../../services/planillaEmpleadosService';
import { InputField } from '../../components/InputField';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/ConfirmModal';
import { PageLoader } from '../../components/PageLoader';
import { ConfigToggle } from './components/ConfigToggle';
import { ConfigCrudModal } from './components/ConfigCrudModal';
import { Logger } from '../../../utils/logger';
import { getCodigoEmpleado } from '../../../utils/empleadoCodigoUtils';
import { useToast } from '../../../context/ToastContext';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'codigo' | 'codigo_empleado_manual'>;

const RANGO_VACIO: NuevoRango = { desde: 0, hasta: null, bono: 0 };

/**
 * Configuración > Tablas de Incentivos (US-BON-01 / IMPL-73). CA1: asignada a un empleado O a un
 * grupo (nunca ambos). CA2: rangos de utilidad neta (desde/hasta) con su bono. CA3 se satisface
 * en US-BON-02 (IMPL-74). Fidelidad al DEMO: tabla desktop + cards mobile, alta vía modal
 * bottom-sheet (antes formulario inline), contador y orden activos-primero, switch en vez de
 * pill de texto.
 */
export const TablasIncentivosConfigView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();

    const [tablas, setTablas] = useState<TablaIncentivoConRangos[]>([]);
    const [grupos, setGrupos] = useState<string[]>([]);
    const [empleados, setEmpleados] = useState<EmpleadoActivo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [eliminarObjetivo, setEliminarObjetivo] = useState<TablaIncentivoConRangos | null>(null);
    const [isEliminando, setIsEliminando] = useState(false);
    const [cambiandoId, setCambiandoId] = useState<string | null>(null);

    const [mostrarModal, setMostrarModal] = useState(false);
    const [editTarget, setEditTarget] = useState<TablaIncentivoConRangos | null>(null);
    const [nombre, setNombre] = useState('');
    const [tipoAsignacion, setTipoAsignacion] = useState<'empleado' | 'grupo'>('grupo');
    const [empleadoId, setEmpleadoId] = useState('');
    const [grupo, setGrupo] = useState('');
    const [rangos, setRangos] = useState<NuevoRango[]>([{ ...RANGO_VACIO }]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const cargar = async () => {
        setIsLoading(true);
        try {
            const [tablasData, deptData, empleadosData] = await Promise.all([
                tablasIncentivosService.getTodas(),
                planillaEmpleadosService.getEmpleadosPorDepartamento(),
                planillaEmpleadosService.getEmpleadosActivos(),
            ]);
            setTablas(tablasData);
            setGrupos(deptData.map((d) => d.departamento).filter((d): d is string => !!d));
            setEmpleados(empleadosData);
        } catch (err: unknown) {
            Logger.error('Error al cargar tablas de incentivos', {}, err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { cargar(); }, []);

    const empleadoPorId = useMemo(() => new Map(empleados.map((e) => [e.id, e])), [empleados]);

    const activas = tablas.filter((tb) => tb.activo);
    const ordenadas: TablaIncentivoConRangos[] = [...activas, ...tablas.filter((tb) => !tb.activo)];

    const cerrarModal = () => {
        setMostrarModal(false);
        setEditTarget(null);
        setNombre('');
        setTipoAsignacion('grupo');
        setEmpleadoId('');
        setGrupo('');
        setRangos([{ ...RANGO_VACIO }]);
        setError(null);
    };

    const abrirAlta = () => {
        setEditTarget(null);
        setNombre('');
        setTipoAsignacion('grupo');
        setEmpleadoId('');
        setGrupo('');
        setRangos([{ ...RANGO_VACIO }]);
        setError(null);
        setMostrarModal(true);
    };

    const abrirEdicion = (tabla: TablaIncentivoConRangos) => {
        setEditTarget(tabla);
        setNombre(tabla.nombre);
        setTipoAsignacion(tabla.empleado_id ? 'empleado' : 'grupo');
        setEmpleadoId(tabla.empleado_id ?? '');
        setGrupo(tabla.grupo ?? '');
        setRangos(tabla.rangos.length > 0 ? tabla.rangos.map((r) => ({ desde: r.desde, hasta: r.hasta, bono: r.bono })) : [{ ...RANGO_VACIO }]);
        setError(null);
        setMostrarModal(true);
    };

    const handleAddRango = () => setRangos((prev) => [...prev, { ...RANGO_VACIO }]);
    const handleRemoveRango = (index: number) => setRangos((prev) => prev.filter((_, i) => i !== index));
    const handleRangoChange = (index: number, field: keyof NuevoRango, value: string) => {
        setRangos((prev) => prev.map((r, i) => {
            if (i !== index) return r;
            if (field === 'hasta') return { ...r, hasta: value === '' ? null : Number(value) };
            return { ...r, [field]: Number(value) };
        }));
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.id) return;
        const asignacionValida = tipoAsignacion === 'empleado' ? !!empleadoId : !!grupo;
        if (!nombre.trim() || !asignacionValida || rangos.length === 0) {
            setError(t('bonificaciones.error_campos_requeridos'));
            return;
        }

        // Bugfix (auditoría): el default de "Bono" es 0, que pasa el min={0} nativo pero viola
        // el CHECK de BD (bono > 0) — antes fallaba con el error genérico de siempre, sin decir
        // por qué. También faltaba validar hasta>desde y rangos no solapados (la propia
        // migración dejaba eso como "responsabilidad de la UI").
        for (const r of rangos) {
            if (r.bono <= 0) {
                setError(t('bonificaciones.error_bono_invalido'));
                return;
            }
            if (r.hasta !== null && r.hasta <= r.desde) {
                setError(t('bonificaciones.error_rango_invalido'));
                return;
            }
        }
        const rangosOrdenados = [...rangos].sort((a, b) => a.desde - b.desde);
        for (let i = 1; i < rangosOrdenados.length; i++) {
            const anterior = rangosOrdenados[i - 1];
            const actual = rangosOrdenados[i];
            if (anterior.hasta === null || anterior.hasta >= actual.desde) {
                setError(t('bonificaciones.error_rangos_solapados'));
                return;
            }
        }

        setError(null);
        setIsSubmitting(true);
        try {
            if (editTarget) {
                await tablasIncentivosService.actualizar(editTarget.id, {
                    nombre: nombre.trim(),
                    empleadoId: tipoAsignacion === 'empleado' ? empleadoId : null,
                    grupo: tipoAsignacion === 'grupo' ? grupo : null,
                    rangos,
                });
            } else {
                await tablasIncentivosService.crear({
                    nombre: nombre.trim(),
                    empleadoId: tipoAsignacion === 'empleado' ? empleadoId : null,
                    grupo: tipoAsignacion === 'grupo' ? grupo : null,
                    rangos,
                    userId: profile.id,
                });
            }
            await cargar();
            cerrarModal();
        } catch (err: unknown) {
            Logger.error('Error al guardar tabla de incentivo', { editandoId: editTarget?.id }, err);
            setError(t('bonificaciones.error_guardar'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleToggleActivo = async (tabla: TablaIncentivoConRangos) => {
        setCambiandoId(tabla.id);
        try {
            await tablasIncentivosService.cambiarActivo(tabla.id, !tabla.activo);
            setTablas((prev) => prev.map((tb) => (tb.id === tabla.id ? { ...tb, activo: !tabla.activo } : tb)));
        } catch (err: unknown) {
            Logger.error('Error al cambiar estado de tabla de incentivo', { id: tabla.id }, err);
            showToast(t('bonificaciones.error_cambiar_estado_tabla'), 'error');
        } finally {
            setCambiandoId(null);
        }
    };

    const handleConfirmarEliminar = async () => {
        if (!eliminarObjetivo) return;
        setIsEliminando(true);
        try {
            await tablasIncentivosService.eliminar(eliminarObjetivo.id);
            setTablas((prev) => prev.filter((tb) => tb.id !== eliminarObjetivo.id));
            setEliminarObjetivo(null);
        } catch (err: unknown) {
            Logger.error('Error al eliminar tabla de incentivo', { id: eliminarObjetivo.id }, err);
            // Bugfix (auditoría): antes esto fallaba en silencio (solo Logger.error) — sin
            // ON DELETE en la FK de planilla_bonificaciones.tabla_incentivo_id, borrar una
            // tabla ya usada en bonos calculados revienta con una violación de FK cruda.
            const code = (err as { code?: string } | null)?.code;
            showToast(code === '23503' ? t('bonificaciones.error_eliminar_tabla_en_uso') : t('bonificaciones.error_eliminar_tabla'), 'error');
        } finally {
            setIsEliminando(false);
        }
    };

    const asignacionLabel = (tb: TablaIncentivoConRangos) =>
        tb.empleado_id ? empleadoPorId.get(tb.empleado_id)?.nombre_completo ?? tb.empleado_id : `${t('bonificaciones.asignar_grupo')}: ${tb.grupo}`;

    const rangosChips = (tb: TablaIncentivoConRangos) => (
        <div className="flex flex-wrap gap-1.5">
            {tb.rangos.map((r) => (
                <span key={r.id} className="text-[11px] bg-surface border border-border rounded-full px-2 py-0.5 text-text-secondary">
                    ${r.desde.toFixed(2)} — {r.hasta !== null ? `$${r.hasta.toFixed(2)}` : t('bonificaciones.field_hasta_sin_limite')}: ${r.bono.toFixed(2)}
                </span>
            ))}
        </div>
    );

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300">
            <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">
                <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                        {t('configuracion.contador_activos', { count: activas.length })}
                    </p>
                    <button
                        type="button"
                        onClick={abrirAlta}
                        className="flex items-center gap-1.5 px-md py-sm bg-primary text-white rounded-xl font-semibold text-[13px] hover:bg-primary-dark transition-colors shadow-cards"
                    >
                        <Plus size={15} /> {t('bonificaciones.action_nueva_tabla')}
                    </button>
                </div>

                {isLoading ? (
                    <PageLoader label={t('common.loading')} />
                ) : tablas.length === 0 ? (
                    <p className="text-caption text-text-secondary italic">{t('bonificaciones.tablas_incentivos_empty')}</p>
                ) : (
                    <div className="bg-white rounded-xl border border-border overflow-hidden">
                        <div className="hidden sm:block overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-surface border-b border-border">
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('bonificaciones.field_nombre_tabla')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">Rangos</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-center">{t('configuracion.col_estado')}</th>
                                        <th className="w-20 px-lg py-sm" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {ordenadas.map((tb) => (
                                        <tr key={tb.id} className={`border-b border-border last:border-0 transition-colors ${tb.activo ? 'hover:bg-surface/60' : 'opacity-50 bg-surface/30'}`}>
                                            <td className="px-lg py-sm">
                                                <p className="font-semibold text-heading text-[13px]">{tb.nombre}</p>
                                                <p className="text-[11px] text-text-secondary">{asignacionLabel(tb)}</p>
                                            </td>
                                            <td className="px-lg py-sm">{rangosChips(tb)}</td>
                                            <td className="px-lg py-sm text-center">
                                                <ConfigToggle checked={tb.activo} onChange={() => handleToggleActivo(tb)} disabled={cambiandoId === tb.id} size="sm" />
                                            </td>
                                            <td className="px-lg py-sm">
                                                <div className="flex items-center justify-end gap-1">
                                                    <button type="button" onClick={() => abrirEdicion(tb)} title={t('bonificaciones.action_editar_tabla')} className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg hover:bg-primary/10">
                                                        <Pencil size={14} />
                                                    </button>
                                                    <button type="button" onClick={() => setEliminarObjetivo(tb)} className="p-1.5 text-text-secondary hover:text-error transition-colors rounded-lg hover:bg-error/10">
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="sm:hidden flex flex-col divide-y divide-border">
                            {ordenadas.map((tb) => (
                                <div key={tb.id} className={`flex flex-col gap-2 px-md py-sm ${tb.activo ? '' : 'opacity-50 bg-surface/30'}`}>
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="font-semibold text-heading text-[13px] truncate">{tb.nombre}</p>
                                            <p className="text-[11px] text-text-secondary">{asignacionLabel(tb)}</p>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <ConfigToggle checked={tb.activo} onChange={() => handleToggleActivo(tb)} disabled={cambiandoId === tb.id} size="sm" />
                                            <button type="button" onClick={() => abrirEdicion(tb)} title={t('bonificaciones.action_editar_tabla')} className="p-1.5 text-text-secondary hover:text-primary rounded-lg">
                                                <Pencil size={14} />
                                            </button>
                                            <button type="button" onClick={() => setEliminarObjetivo(tb)} className="p-1.5 text-text-secondary hover:text-error rounded-lg">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    {rangosChips(tb)}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </section>

            {mostrarModal && (
                <ConfigCrudModal title={editTarget ? t('bonificaciones.form_title_editar_tabla') : t('bonificaciones.action_nueva_tabla')} onClose={cerrarModal} onSave={handleSave} saving={isSubmitting}>
                    <InputField label={t('bonificaciones.field_nombre_tabla')} value={nombre} onChange={(e) => setNombre(e.target.value)} />

                    <div className="flex gap-2">
                        <button type="button" onClick={() => setTipoAsignacion('grupo')} className={`flex-1 px-3 py-2 text-sm font-semibold rounded-md border ${tipoAsignacion === 'grupo' ? 'bg-primary-light text-primary border-primary/30' : 'bg-surface text-text-secondary border-border'}`}>
                            {t('bonificaciones.asignar_grupo')}
                        </button>
                        <button type="button" onClick={() => setTipoAsignacion('empleado')} className={`flex-1 px-3 py-2 text-sm font-semibold rounded-md border ${tipoAsignacion === 'empleado' ? 'bg-primary-light text-primary border-primary/30' : 'bg-surface text-text-secondary border-border'}`}>
                            {t('bonificaciones.asignar_empleado')}
                        </button>
                    </div>

                    {tipoAsignacion === 'grupo' ? (
                        <select value={grupo} onChange={(e) => setGrupo(e.target.value)} className="rounded-md border border-border bg-white px-3 py-2 text-sm">
                            <option value="">{t('bonificaciones.field_grupo_placeholder')}</option>
                            {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                    ) : (
                        <select value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)} className="rounded-md border border-border bg-white px-3 py-2 text-sm">
                            <option value="">{t('bonificaciones.field_empleado_placeholder')}</option>
                            {empleados.map((emp) => <option key={emp.id} value={emp.id}>{emp.nombre_completo} ({getCodigoEmpleado(emp)})</option>)}
                        </select>
                    )}

                    <div className="flex flex-col gap-2 pt-2 border-t border-border/40">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('bonificaciones.field_rangos')}</p>
                        {rangos.map((r, i) => (
                            <div key={i} className="flex items-end gap-2">
                                <InputField label={t('bonificaciones.field_desde')} type="number" min={0} step="0.01" value={r.desde} onChange={(e) => handleRangoChange(i, 'desde', e.target.value)} className="flex-1" />
                                <InputField label={t('bonificaciones.field_hasta')} type="number" min={0} step="0.01" value={r.hasta ?? ''} onChange={(e) => handleRangoChange(i, 'hasta', e.target.value)} placeholder={t('bonificaciones.field_hasta_sin_limite')} className="flex-1" />
                                <InputField label={t('bonificaciones.field_bono')} type="number" min={0} step="0.01" value={r.bono} onChange={(e) => handleRangoChange(i, 'bono', e.target.value)} className="flex-1" />
                                {rangos.length > 1 && (
                                    <button type="button" onClick={() => handleRemoveRango(i)} className="p-2 text-text-secondary hover:text-error transition-colors mb-0.5">
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>
                        ))}
                        <Button type="button" variant="ghost" onClick={handleAddRango} className="flex items-center gap-1.5 self-start">
                            <Plus size={14} /> {t('bonificaciones.action_agregar_rango')}
                        </Button>
                    </div>
                    {error && <p className="text-caption text-error">{error}</p>}
                </ConfigCrudModal>
            )}

            <ConfirmModal
                isOpen={eliminarObjetivo !== null}
                onClose={() => setEliminarObjetivo(null)}
                onConfirm={handleConfirmarEliminar}
                title={t('bonificaciones.eliminar_tabla_confirm_title')}
                message={eliminarObjetivo ? t('bonificaciones.eliminar_tabla_confirm_message', { nombre: eliminarObjetivo.nombre }) : ''}
                confirmLabel={t('vacaciones.eliminar_confirm_action')}
                cancelLabel={t('vacaciones.action_cancelar')}
                variant="danger"
                Icon={Trash2}
                isLoading={isEliminando}
            />
        </div>
    );
};
