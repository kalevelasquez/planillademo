import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2, RotateCcw, Plus } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { descuentoCategoriasService, type DescuentoCategoria } from '../../../services/descuentoCategoriasService';
import type { TipoDescuento } from '../../../utils/descuentosUtils';
import { InputField } from '../../components/InputField';
import { PageLoader } from '../../components/PageLoader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { ConfigCrudModal } from './components/ConfigCrudModal';
import { Logger } from '../../../utils/logger';
import { useToast } from '../../../context/ToastContext';

const TIPO_LABEL_KEY: Record<TipoDescuento, 'descuentoCategorias.tipo_fijo' | 'descuentoCategorias.tipo_variable'> = {
    fijo: 'descuentoCategorias.tipo_fijo',
    variable: 'descuentoCategorias.tipo_variable',
};

const FORM_VACIO = { nombre: '', tipo: 'fijo' as TipoDescuento };

/**
 * Configuración > Categorías de Descuentos (US-DESC-01 CA3 / IMPL-56). Defecto UAT: el CA3 pide
 * explícitamente un catálogo configurable (mismo patrón que Bonificaciones/Otros Ingresos), pero
 * `planilla_descuento_categorias` no tenía pantalla de administración — se sembraba solo vía
 * migración. Se construye con el mismo patrón que `OtrosIngresosConceptosConfigView`: tabla
 * desktop + cards mobile, alta/edición vía modal, contador y orden activos-primero.
 *
 * Editar/eliminar: sin DELETE físico (una categoría puede estar referenciada por
 * planilla_descuentos ya registrados) — "eliminar" desactiva con ConfirmModal de advertencia
 * previa y el UPDATE queda auditado por `tr_audit_planilla_descuento_categorias`. Los descuentos
 * existentes conservan su categoría (nombre/tipo se resuelven vía getTodos en las vistas); solo
 * los formularios de alta nueva ofrecen categorías activas. Las inactivas pueden reactivarse
 * desde la misma tabla.
 */
export const DescuentoCategoriasConfigView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();

    const [categorias, setCategorias] = useState<DescuentoCategoria[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const [mostrarModal, setMostrarModal] = useState(false);
    const [editTarget, setEditTarget] = useState<DescuentoCategoria | null>(null);
    const [form, setForm] = useState(FORM_VACIO);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [cambiandoId, setCambiandoId] = useState<string | null>(null);
    const [eliminarObjetivo, setEliminarObjetivo] = useState<DescuentoCategoria | null>(null);
    const [isEliminando, setIsEliminando] = useState(false);

    const cargar = async () => {
        setIsLoading(true);
        try {
            const data = await descuentoCategoriasService.getTodos();
            setCategorias(data);
        } catch (err: unknown) {
            Logger.error('Error al cargar categorías de descuentos', {}, err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { cargar(); }, []);

    const activos = categorias.filter((c) => c.activo);
    const ordenados: DescuentoCategoria[] = [...activos, ...categorias.filter((c) => !c.activo)];

    const cerrarModal = () => { setMostrarModal(false); setEditTarget(null); setForm(FORM_VACIO); setError(null); };

    const abrirAlta = () => { setEditTarget(null); setForm(FORM_VACIO); setError(null); setMostrarModal(true); };

    const abrirEdicion = (categoria: DescuentoCategoria) => {
        setEditTarget(categoria);
        setForm({ nombre: categoria.nombre, tipo: categoria.tipo });
        setError(null);
        setMostrarModal(true);
    };

    /** Alta y edición comparten el mismo modal. Un duplicado de nombre (UNIQUE tenant_id+nombre)
     * muestra el mensaje claro en vez del genérico. */
    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.tenant_id) return;
        if (!form.nombre.trim()) { setError(t('descuentoCategorias.error_campos_requeridos')); return; }
        setError(null);
        setIsSubmitting(true);
        try {
            if (editTarget) {
                const actualizado = await descuentoCategoriasService.actualizar(editTarget.id, form.nombre.trim(), form.tipo);
                setCategorias((prev) => prev.map((c) => (c.id === editTarget.id ? actualizado : c)).sort((a, b) => a.nombre.localeCompare(b.nombre)));
                showToast(t('descuentoCategorias.toast_categoria_actualizado'), 'success');
            } else {
                const nueva = await descuentoCategoriasService.crear(profile.tenant_id, form.nombre.trim(), form.tipo);
                setCategorias((prev) => [...prev, nueva].sort((a, b) => a.nombre.localeCompare(b.nombre)));
                showToast(t('descuentoCategorias.toast_categoria_guardado'), 'success');
            }
            cerrarModal();
        } catch (err: unknown) {
            Logger.error('Error al guardar categoría de descuento', { editandoId: editTarget?.id }, err);
            const code = (err as { code?: string } | null)?.code;
            setError(code === '23505' ? t('descuentoCategorias.error_categoria_duplicado') : t('descuentoCategorias.error_guardar'));
        } finally {
            setIsSubmitting(false);
        }
    };

    /** US-DESC-01 CA3 (defecto UAT) — "eliminar" desactiva la categoría (sin DELETE físico) tras
     * la advertencia del ConfirmModal. El UPDATE queda auditado por el trigger de la tabla. */
    const handleConfirmarEliminar = async () => {
        if (!eliminarObjetivo) return;
        setIsEliminando(true);
        try {
            const actualizada = await descuentoCategoriasService.cambiarActivo(eliminarObjetivo.id, false);
            setCategorias((prev) => prev.map((c) => (c.id === eliminarObjetivo.id ? actualizada : c)));
            showToast(t('descuentoCategorias.toast_categoria_eliminado'), 'success');
            setEliminarObjetivo(null);
        } catch (err: unknown) {
            Logger.error('Error al desactivar categoría', { id: eliminarObjetivo.id }, err);
            showToast(t('descuentoCategorias.error_cambiar_estado'), 'error');
        } finally {
            setIsEliminando(false);
        }
    };

    const handleReactivar = async (categoria: DescuentoCategoria) => {
        setCambiandoId(categoria.id);
        try {
            const actualizada = await descuentoCategoriasService.cambiarActivo(categoria.id, true);
            setCategorias((prev) => prev.map((c) => (c.id === categoria.id ? actualizada : c)));
            showToast(t('descuentoCategorias.toast_categoria_reactivado'), 'success');
        } catch (err: unknown) {
            Logger.error('Error al reactivar categoría', { id: categoria.id }, err);
            showToast(t('descuentoCategorias.error_cambiar_estado'), 'error');
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
                        <Plus size={15} /> {t('descuentoCategorias.action_agregar')}
                    </button>
                </div>

                {isLoading ? (
                    <PageLoader label={t('common.loading')} />
                ) : categorias.length === 0 ? (
                    <p className="text-caption text-text-secondary italic">{t('descuentoCategorias.categorias_config_empty')}</p>
                ) : (
                    <div className="bg-white rounded-xl border border-border overflow-hidden">
                        <div className="hidden sm:block overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-surface border-b border-border">
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('descuentoCategorias.field_nombre_categoria')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('descuentoCategorias.field_tipo')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-right">{t('descuentoCategorias.col_acciones')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ordenados.map((c) => (
                                        <tr key={c.id} className={`border-b border-border last:border-0 transition-colors ${c.activo ? 'hover:bg-surface/60' : 'opacity-50 bg-surface/30'}`}>
                                            <td className="px-lg py-sm font-semibold text-heading text-[13px]">{c.nombre}</td>
                                            <td className="px-lg py-sm text-[13px] text-text-secondary">{t(TIPO_LABEL_KEY[c.tipo])}</td>
                                            <td className="px-lg py-sm">
                                                <div className="flex items-center justify-end gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => abrirEdicion(c)}
                                                        title={t('descuentoCategorias.action_editar')}
                                                        className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg hover:bg-primary/10"
                                                    >
                                                        <Pencil size={14} />
                                                    </button>
                                                    {c.activo ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => setEliminarObjetivo(c)}
                                                            title={t('descuentoCategorias.action_eliminar')}
                                                            className="p-1.5 text-text-secondary hover:text-error transition-colors rounded-lg hover:bg-error/10"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleReactivar(c)}
                                                            disabled={cambiandoId === c.id}
                                                            title={t('descuentoCategorias.action_reactivar')}
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
                                        <p className="text-[11px] text-text-secondary">{t(TIPO_LABEL_KEY[c.tipo])}</p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button type="button" onClick={() => abrirEdicion(c)} title={t('descuentoCategorias.action_editar')} className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg">
                                            <Pencil size={14} />
                                        </button>
                                        {c.activo ? (
                                            <button type="button" onClick={() => setEliminarObjetivo(c)} title={t('descuentoCategorias.action_eliminar')} className="p-1.5 text-text-secondary hover:text-error transition-colors rounded-lg">
                                                <Trash2 size={14} />
                                            </button>
                                        ) : (
                                            <button type="button" onClick={() => handleReactivar(c)} disabled={cambiandoId === c.id} title={t('descuentoCategorias.action_reactivar')} className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg disabled:opacity-50">
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
                    title={editTarget ? t('descuentoCategorias.form_title_editar_categoria') : t('descuentoCategorias.action_agregar')}
                    onClose={cerrarModal}
                    onSave={handleSave}
                    saving={isSubmitting}
                >
                    <InputField
                        label={t('descuentoCategorias.field_nombre_categoria')}
                        value={form.nombre}
                        onChange={(e) => setForm((prev) => ({ ...prev, nombre: e.target.value }))}
                    />
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('descuentoCategorias.field_tipo')}</label>
                        <select
                            value={form.tipo}
                            onChange={(e) => setForm((prev) => ({ ...prev, tipo: e.target.value as TipoDescuento }))}
                            className="rounded-md border border-border bg-white px-3 py-2 text-sm"
                        >
                            <option value="fijo">{t('descuentoCategorias.tipo_fijo')}</option>
                            <option value="variable">{t('descuentoCategorias.tipo_variable')}</option>
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
                title={t('descuentoCategorias.confirm_eliminar_title')}
                message={t('descuentoCategorias.confirm_eliminar_message', { nombre: eliminarObjetivo?.nombre ?? '' })}
                confirmLabel={t('descuentoCategorias.confirm_eliminar_action')}
                cancelLabel={t('configuracion.modal_cancelar')}
                variant="warning"
            />
        </div>
    );
};
