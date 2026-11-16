import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2, RotateCcw, Plus } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { otrosIngresosConceptosService, type OtroIngresoConcepto, type Gravabilidad } from '../../../services/otrosIngresosConceptosService';
import { InputField } from '../../components/InputField';
import { PageLoader } from '../../components/PageLoader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { ConfigCrudModal } from './components/ConfigCrudModal';
import { Logger } from '../../../utils/logger';
import { useToast } from '../../../context/ToastContext';

const GRAVABILIDAD_LABEL_KEY: Record<Gravabilidad, 'otrosIngresos.gravabilidad_gravable' | 'otrosIngresos.gravabilidad_no_gravable' | 'otrosIngresos.gravabilidad_bono_10'> = {
    gravable: 'otrosIngresos.gravabilidad_gravable',
    no_gravable: 'otrosIngresos.gravabilidad_no_gravable',
    bono_10: 'otrosIngresos.gravabilidad_bono_10',
};

const FORM_VACIO = { nombre: '', gravabilidad: 'gravable' as Gravabilidad };

/**
 * Configuración > Conceptos de Otros Ingresos (US-OTR-00 / IMPL-77). Fidelidad al DEMO: tabla
 * desktop + cards mobile, alta/edición vía modal, contador y orden activos-primero.
 *
 * Editar/eliminar (defecto UAT): el CA1 pide administrar cada registro — se agregó edición
 * (nombre + gravabilidad por defecto, modal reutilizado) y "eliminar" como desactivación con
 * ConfirmModal de advertencia previa (decisión del usuario): sin DELETE físico, porque un
 * concepto puede estar referenciado por otros_ingresos ya registrados; el UPDATE de
 * activo=false queda auditado por `tr_audit_planilla_otros_ingresos_conceptos`. Los conceptos
 * inactivos pueden reactivarse desde la misma tabla.
 */
export const OtrosIngresosConceptosConfigView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();

    const [conceptos, setConceptos] = useState<OtroIngresoConcepto[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const [mostrarModal, setMostrarModal] = useState(false);
    const [editTarget, setEditTarget] = useState<OtroIngresoConcepto | null>(null);
    const [form, setForm] = useState(FORM_VACIO);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [cambiandoId, setCambiandoId] = useState<string | null>(null);
    const [eliminarObjetivo, setEliminarObjetivo] = useState<OtroIngresoConcepto | null>(null);
    const [isEliminando, setIsEliminando] = useState(false);

    const cargar = async () => {
        setIsLoading(true);
        try {
            const data = await otrosIngresosConceptosService.getTodos();
            setConceptos(data);
        } catch (err: unknown) {
            Logger.error('Error al cargar conceptos de otros ingresos', {}, err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { cargar(); }, []);

    const activos = conceptos.filter((c) => c.activo);
    const ordenados: OtroIngresoConcepto[] = [...activos, ...conceptos.filter((c) => !c.activo)];

    const cerrarModal = () => { setMostrarModal(false); setEditTarget(null); setForm(FORM_VACIO); setError(null); };

    const abrirAlta = () => { setEditTarget(null); setForm(FORM_VACIO); setError(null); setMostrarModal(true); };

    const abrirEdicion = (concepto: OtroIngresoConcepto) => {
        setEditTarget(concepto);
        setForm({ nombre: concepto.nombre, gravabilidad: concepto.gravabilidad_default });
        setError(null);
        setMostrarModal(true);
    };

    /** Alta y edición comparten el mismo modal (mismo patrón de formulario unificado del resto
     * de la épica). Un duplicado de nombre (UNIQUE tenant_id+nombre) muestra el mensaje claro
     * en vez del genérico. */
    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.tenant_id) return;
        if (!form.nombre.trim()) { setError(t('otrosIngresos.error_campos_requeridos')); return; }
        setError(null);
        setIsSubmitting(true);
        try {
            if (editTarget) {
                const actualizado = await otrosIngresosConceptosService.actualizar(editTarget.id, form.nombre.trim(), form.gravabilidad);
                setConceptos((prev) => prev.map((c) => (c.id === editTarget.id ? actualizado : c)).sort((a, b) => a.nombre.localeCompare(b.nombre)));
                showToast(t('otrosIngresos.toast_concepto_actualizado'), 'success');
            } else {
                const nuevo = await otrosIngresosConceptosService.crear(profile.tenant_id, form.nombre.trim(), form.gravabilidad);
                setConceptos((prev) => [...prev, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)));
                showToast(t('otrosIngresos.toast_concepto_guardado'), 'success');
            }
            cerrarModal();
        } catch (err: unknown) {
            Logger.error('Error al guardar concepto de otro ingreso', { editandoId: editTarget?.id }, err);
            const code = (err as { code?: string } | null)?.code;
            setError(code === '23505' ? t('otrosIngresos.error_concepto_duplicado') : t('otrosIngresos.error_guardar'));
        } finally {
            setIsSubmitting(false);
        }
    };

    /** US-OTR-00 CA1 (defecto UAT) — "eliminar" desactiva el concepto (sin DELETE físico) tras
     * la advertencia del ConfirmModal. El UPDATE queda auditado por el trigger de la tabla. */
    const handleConfirmarEliminar = async () => {
        if (!eliminarObjetivo) return;
        setIsEliminando(true);
        try {
            const actualizado = await otrosIngresosConceptosService.cambiarActivo(eliminarObjetivo.id, false);
            setConceptos((prev) => prev.map((c) => (c.id === eliminarObjetivo.id ? actualizado : c)));
            showToast(t('otrosIngresos.toast_concepto_eliminado'), 'success');
            setEliminarObjetivo(null);
        } catch (err: unknown) {
            Logger.error('Error al desactivar concepto', { id: eliminarObjetivo.id }, err);
            showToast(t('otrosIngresos.error_cambiar_estado'), 'error');
        } finally {
            setIsEliminando(false);
        }
    };

    const handleReactivar = async (concepto: OtroIngresoConcepto) => {
        setCambiandoId(concepto.id);
        try {
            const actualizado = await otrosIngresosConceptosService.cambiarActivo(concepto.id, true);
            setConceptos((prev) => prev.map((c) => (c.id === concepto.id ? actualizado : c)));
            showToast(t('otrosIngresos.toast_concepto_reactivado'), 'success');
        } catch (err: unknown) {
            Logger.error('Error al reactivar concepto', { id: concepto.id }, err);
            showToast(t('otrosIngresos.error_cambiar_estado'), 'error');
        } finally {
            setCambiandoId(null);
        }
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300">
            <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">
                <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                        {t('configuracion.contador_activos', { count: activos.length })}
                    </p>
                    <button
                        type="button"
                        onClick={abrirAlta}
                        className="flex items-center gap-1.5 px-md py-sm bg-primary text-white rounded-xl font-semibold text-[13px] hover:bg-primary-dark transition-colors shadow-cards"
                    >
                        <Plus size={15} /> {t('otrosIngresos.action_agregar')}
                    </button>
                </div>

                {isLoading ? (
                    <PageLoader label={t('common.loading')} />
                ) : conceptos.length === 0 ? (
                    <p className="text-caption text-text-secondary italic">{t('otrosIngresos.conceptos_config_empty')}</p>
                ) : (
                    <div className="bg-white rounded-xl border border-border overflow-hidden">
                        <div className="hidden sm:block overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-surface border-b border-border">
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('otrosIngresos.field_nombre_concepto')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('otrosIngresos.field_gravabilidad_default')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-right">{t('otrosIngresos.col_acciones')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ordenados.map((c) => (
                                        <tr key={c.id} className={`border-b border-border last:border-0 transition-colors ${c.activo ? 'hover:bg-surface/60' : 'opacity-50 bg-surface/30'}`}>
                                            <td className="px-lg py-sm font-semibold text-heading text-[13px]">{c.nombre}</td>
                                            <td className="px-lg py-sm text-[13px] text-text-secondary">{t(GRAVABILIDAD_LABEL_KEY[c.gravabilidad_default])}</td>
                                            <td className="px-lg py-sm">
                                                <div className="flex items-center justify-end gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => abrirEdicion(c)}
                                                        title={t('otrosIngresos.action_editar')}
                                                        className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg hover:bg-primary/10"
                                                    >
                                                        <Pencil size={14} />
                                                    </button>
                                                    {c.activo ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => setEliminarObjetivo(c)}
                                                            title={t('otrosIngresos.action_eliminar')}
                                                            className="p-1.5 text-text-secondary hover:text-error transition-colors rounded-lg hover:bg-error/10"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleReactivar(c)}
                                                            disabled={cambiandoId === c.id}
                                                            title={t('otrosIngresos.action_reactivar')}
                                                            className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg hover:bg-primary/10 disabled:opacity-50"
                                                        >
                                                            <RotateCcw size={14} />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="sm:hidden flex flex-col divide-y divide-border">
                            {ordenados.map((c) => (
                                <div key={c.id} className={`flex items-center justify-between gap-2 px-md py-sm ${c.activo ? '' : 'opacity-50 bg-surface/30'}`}>
                                    <div className="min-w-0">
                                        <p className="font-semibold text-heading text-[13px] truncate">{c.nombre}</p>
                                        <p className="text-[11px] text-text-secondary">{t(GRAVABILIDAD_LABEL_KEY[c.gravabilidad_default])}</p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button type="button" onClick={() => abrirEdicion(c)} title={t('otrosIngresos.action_editar')} className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg">
                                            <Pencil size={14} />
                                        </button>
                                        {c.activo ? (
                                            <button type="button" onClick={() => setEliminarObjetivo(c)} title={t('otrosIngresos.action_eliminar')} className="p-1.5 text-text-secondary hover:text-error transition-colors rounded-lg">
                                                <Trash2 size={14} />
                                            </button>
                                        ) : (
                                            <button type="button" onClick={() => handleReactivar(c)} disabled={cambiandoId === c.id} title={t('otrosIngresos.action_reactivar')} className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg disabled:opacity-50">
                                                <RotateCcw size={14} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </section>

            {mostrarModal && (
                <ConfigCrudModal
                    title={editTarget ? t('otrosIngresos.form_title_editar_concepto') : t('otrosIngresos.action_agregar')}
                    onClose={cerrarModal}
                    onSave={handleSave}
                    saving={isSubmitting}
                >
                    <InputField
                        label={t('otrosIngresos.field_nombre_concepto')}
                        value={form.nombre}
                        onChange={(e) => setForm((prev) => ({ ...prev, nombre: e.target.value }))}
                    />
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('otrosIngresos.field_gravabilidad_default')}</label>
                        <select
                            value={form.gravabilidad}
                            onChange={(e) => setForm((prev) => ({ ...prev, gravabilidad: e.target.value as Gravabilidad }))}
                            className="rounded-md border border-border bg-white px-3 py-2 text-sm"
                        >
                            <option value="gravable">{t('otrosIngresos.gravabilidad_gravable')}</option>
                            <option value="no_gravable">{t('otrosIngresos.gravabilidad_no_gravable')}</option>
                            <option value="bono_10">{t('otrosIngresos.gravabilidad_bono_10')}</option>
                        </select>
                    </div>
                    {error && <p className="text-caption text-error">{error}</p>}
                </ConfigCrudModal>
            )}

            <ConfirmModal
                isOpen={!!eliminarObjetivo}
                onClose={() => setEliminarObjetivo(null)}
                onConfirm={handleConfirmarEliminar}
                isLoading={isEliminando}
                title={t('otrosIngresos.confirm_eliminar_title')}
                message={t('otrosIngresos.confirm_eliminar_message', { nombre: eliminarObjetivo?.nombre ?? '' })}
                confirmLabel={t('otrosIngresos.confirm_eliminar_action')}
                cancelLabel={t('configuracion.modal_cancelar')}
                variant="warning"
            />
        </div>
    );
};
