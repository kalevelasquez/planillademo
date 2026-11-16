import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { useDepartamentosStore } from '../../../store/departamentosStore';
import { departamentosService, type ColorKey, type Departamento } from '../../../services/departamentosService';
import { GRUPOS_COSTOS } from '../../../config/constants';
import { getColorClasses } from '../../../utils/departamentoColorUtils';
import { InputField } from '../../components/InputField';
import { PageLoader } from '../../components/PageLoader';
import { ConfigToggle } from './components/ConfigToggle';
import { ConfigCrudModal } from './components/ConfigCrudModal';
import { ColorSwatches } from './components/ColorSwatches';
import { Logger } from '../../../utils/logger';
import { useToast } from '../../../context/ToastContext';

/**
 * Configuración > Departamentos (revisión épica por épica, IMPL-2 gap #2). Fidelidad al DEMO:
 * tabla desktop + cards mobile, alta vía modal, contador y orden activos-primero. Los swatches
 * de color se mantienen como control inline en la fila (ajuste rápido), no como campo del modal.
 */
export const DepartamentosConfigView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const { departamentos, isLoading, fetchDepartamentos, upsertDepartamento } = useDepartamentosStore();

    const [mostrarModal, setMostrarModal] = useState(false);
    const [editTarget, setEditTarget] = useState<Departamento | null>(null);
    const [nombre, setNombre] = useState('');
    const [colorNuevo, setColorNuevo] = useState<ColorKey>('blue');
    const [grupoCostos, setGrupoCostos] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [actualizandoId, setActualizandoId] = useState<string | null>(null);

    useEffect(() => { fetchDepartamentos(); }, [fetchDepartamentos]);

    const activos = departamentos.filter((d) => d.estado === 'activo');
    const ordenados: Departamento[] = [...activos, ...departamentos.filter((d) => d.estado !== 'activo')];

    const cerrarModal = () => { setMostrarModal(false); setEditTarget(null); setNombre(''); setColorNuevo('blue'); setGrupoCostos(''); setError(null); };

    const abrirAlta = () => { setEditTarget(null); setNombre(''); setColorNuevo('blue'); setGrupoCostos(''); setError(null); setMostrarModal(true); };

    const abrirEdicion = (departamento: Departamento) => {
        setEditTarget(departamento);
        setNombre(departamento.nombre);
        setColorNuevo(departamento.color_key);
        setGrupoCostos(departamento.grupo_costos ?? '');
        setError(null);
        setMostrarModal(true);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.tenant_id) return;
        if (!nombre.trim()) { setError(t('empleados.error_nombre_departamento_required')); return; }
        setError(null);
        setIsSubmitting(true);
        try {
            if (editTarget) {
                const actualizado = await departamentosService.updateDepartamento(editTarget.id, { nombre: nombre.trim(), color_key: colorNuevo, grupo_costos: grupoCostos.trim() || null });
                upsertDepartamento(actualizado);
            } else {
                const nuevo = await departamentosService.createDepartamento(profile.tenant_id, nombre.trim(), colorNuevo);
                upsertDepartamento(nuevo);
            }
            cerrarModal();
        } catch (err: unknown) {
            Logger.error('Error al guardar departamento', { editandoId: editTarget?.id }, err);
            // Bugfix (auditoría, minor #1): antes se mostraba siempre el mensaje genérico —
            // un duplicado de nombre (UNIQUE tenant_id+nombre) no decía qué había pasado.
            const code = (err as { code?: string } | null)?.code;
            setError(code === '23505' ? t('empleados.error_departamento_duplicado') : t('empleados.error_crear_departamento'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCambiarColor = async (id: string, color_key: ColorKey) => {
        setActualizandoId(id);
        try {
            const actualizado = await departamentosService.updateDepartamento(id, { color_key });
            upsertDepartamento(actualizado);
        } catch (err: unknown) {
            Logger.error('Error al cambiar color de departamento', { id }, err);
            showToast(t('empleados.error_cambiar_color_departamento'), 'error');
        } finally {
            setActualizandoId(null);
        }
    };

    const handleToggleEstado = async (id: string, estadoActual: 'activo' | 'inactivo') => {
        setActualizandoId(id);
        try {
            const actualizado = await departamentosService.updateDepartamento(id, { estado: estadoActual === 'activo' ? 'inactivo' : 'activo' });
            upsertDepartamento(actualizado);
        } catch (err: unknown) {
            Logger.error('Error al cambiar estado de departamento', { id }, err);
            showToast(t('empleados.error_cambiar_estado_departamento'), 'error');
        } finally {
            setActualizandoId(null);
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
                        <Plus size={15} /> {t('empleados.action_agregar_departamento')}
                    </button>
                </div>

                {isLoading ? (
                    <PageLoader label={t('common.loading')} />
                ) : (
                    <div className="bg-white rounded-xl border border-border overflow-hidden">
                        {/* Desktop */}
                        <div className="hidden sm:block overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-surface border-b border-border">
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('empleados.field_nombre_departamento')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">Color</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-center">{t('configuracion.col_estado')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-right">{t('empleados.col_acciones')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ordenados.map((d) => (
                                        <tr key={d.id} className={`border-b border-border last:border-0 transition-colors ${d.estado === 'activo' ? 'hover:bg-surface/60' : 'opacity-50 bg-surface/30'}`}>
                                            <td className="px-lg py-sm">
                                                <span className={`text-[11px] font-bold px-sm py-1 rounded-full ${getColorClasses(d.color_key)}`}>{d.nombre}</span>
                                            </td>
                                            <td className="px-lg py-sm">
                                                <ColorSwatches valor={d.color_key} onPick={(c) => handleCambiarColor(d.id, c)} disabled={actualizandoId === d.id} />
                                            </td>
                                            <td className="px-lg py-sm text-center">
                                                <ConfigToggle checked={d.estado === 'activo'} onChange={() => handleToggleEstado(d.id, d.estado)} disabled={actualizandoId === d.id} size="sm" />
                                            </td>
                                            <td className="px-lg py-sm text-right">
                                                <button type="button" onClick={() => abrirEdicion(d)} title={t('empleados.action_editar_departamento')} className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg hover:bg-primary/10">
                                                    <Pencil size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {ordenados.length === 0 && (
                                        <tr><td colSpan={4} className="px-lg py-xl text-center text-text-secondary">{t('configuracion.sin_registros_agregar_primero')}</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile cards */}
                        <div className="sm:hidden flex flex-col divide-y divide-border">
                            {ordenados.map((d) => (
                                <div key={d.id} className={`flex flex-col gap-2 px-md py-sm ${d.estado === 'activo' ? '' : 'opacity-50 bg-surface/30'}`}>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className={`text-[11px] font-bold px-sm py-1 rounded-full ${getColorClasses(d.color_key)}`}>{d.nombre}</span>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button type="button" onClick={() => abrirEdicion(d)} title={t('empleados.action_editar_departamento')} className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg">
                                                <Pencil size={14} />
                                            </button>
                                            <ConfigToggle checked={d.estado === 'activo'} onChange={() => handleToggleEstado(d.id, d.estado)} disabled={actualizandoId === d.id} size="sm" />
                                        </div>
                                    </div>
                                    <ColorSwatches valor={d.color_key} onPick={(c) => handleCambiarColor(d.id, c)} disabled={actualizandoId === d.id} />
                                </div>
                            ))}
                            {ordenados.length === 0 && <p className="px-md py-xl text-center text-text-secondary">{t('configuracion.sin_registros')}</p>}
                        </div>
                    </div>
                )}
            </section>

            {mostrarModal && (
                <ConfigCrudModal title={editTarget ? t('empleados.form_title_editar_departamento') : t('empleados.action_agregar_departamento')} onClose={cerrarModal} onSave={handleSave} saving={isSubmitting}>
                    <InputField
                        label={t('empleados.field_nombre_departamento')}
                        placeholder={t('empleados.field_nombre_departamento_placeholder')}
                        value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                    />
                    <ColorSwatches valor={colorNuevo} onPick={setColorNuevo} />
                    {editTarget && (
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('empleados.field_grupo_costos')}</label>
                            <select
                                value={grupoCostos}
                                onChange={(e) => setGrupoCostos(e.target.value)}
                                className="rounded-md border border-border bg-white px-3 py-2 text-sm"
                            >
                                <option value="">{t('empleados.field_grupo_costos_placeholder')}</option>
                                {GRUPOS_COSTOS.map((g) => (
                                    <option key={g} value={g}>{g}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    {error && <p className="text-caption text-error">{error}</p>}
                </ConfigCrudModal>
            )}
        </div>
    );
};
