import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { useCargosStore } from '../../../store/cargosStore';
import { cargosService, type Cargo } from '../../../services/cargosService';
import { InputField } from '../../components/InputField';
import { PageLoader } from '../../components/PageLoader';
import { ConfigToggle } from './components/ConfigToggle';
import { ConfigCrudModal } from './components/ConfigCrudModal';
import { Logger } from '../../../utils/logger';
import { useToast } from '../../../context/ToastContext';

/**
 * Configuración > Cargos (IMPL-133, Observación General UAT) — mismo patrón que
 * DepartamentosConfigView (tabla desktop + cards mobile, alta vía modal, contador y orden
 * activos-primero), sin color de badge porque Cargo no se muestra como badge en ningún lado.
 */
export const CargosConfigView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const { cargos, isLoading, fetchCargos, upsertCargo } = useCargosStore();

    const [mostrarModal, setMostrarModal] = useState(false);
    const [editTarget, setEditTarget] = useState<Cargo | null>(null);
    const [nombre, setNombre] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [actualizandoId, setActualizandoId] = useState<string | null>(null);

    useEffect(() => { fetchCargos(); }, [fetchCargos]);

    const activos = cargos.filter((c) => c.estado === 'activo');
    const ordenados: Cargo[] = [...activos, ...cargos.filter((c) => c.estado !== 'activo')];

    const cerrarModal = () => { setMostrarModal(false); setEditTarget(null); setNombre(''); setError(null); };

    const abrirAlta = () => { setEditTarget(null); setNombre(''); setError(null); setMostrarModal(true); };

    const abrirEdicion = (cargo: Cargo) => { setEditTarget(cargo); setNombre(cargo.nombre); setError(null); setMostrarModal(true); };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.tenant_id) return;
        if (!nombre.trim()) { setError(t('empleados.error_nombre_cargo_required')); return; }
        setError(null);
        setIsSubmitting(true);
        try {
            if (editTarget) {
                const actualizado = await cargosService.updateCargo(editTarget.id, { nombre: nombre.trim() });
                upsertCargo(actualizado);
            } else {
                const nuevo = await cargosService.createCargo(profile.tenant_id, nombre.trim());
                upsertCargo(nuevo);
            }
            cerrarModal();
        } catch (err: unknown) {
            Logger.error('Error al guardar cargo', { editandoId: editTarget?.id }, err);
            const code = (err as { code?: string } | null)?.code;
            setError(code === '23505' ? t('empleados.error_cargo_duplicado') : t('empleados.error_crear_cargo'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleToggleEstado = async (id: string, estadoActual: 'activo' | 'inactivo') => {
        setActualizandoId(id);
        try {
            const actualizado = await cargosService.updateCargo(id, { estado: estadoActual === 'activo' ? 'inactivo' : 'activo' });
            upsertCargo(actualizado);
        } catch (err: unknown) {
            Logger.error('Error al cambiar estado de cargo', { id }, err);
            showToast(t('empleados.error_cambiar_estado_cargo'), 'error');
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
                        <Plus size={15} /> {t('empleados.action_agregar_cargo')}
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
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('empleados.field_nombre_cargo')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-center">{t('configuracion.col_estado')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-right">{t('empleados.col_acciones')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ordenados.map((c) => (
                                        <tr key={c.id} className={`border-b border-border last:border-0 transition-colors ${c.estado === 'activo' ? 'hover:bg-surface/60' : 'opacity-50 bg-surface/30'}`}>
                                            <td className="px-lg py-sm text-[13px] font-semibold text-heading">{c.nombre}</td>
                                            <td className="px-lg py-sm text-center">
                                                <ConfigToggle checked={c.estado === 'activo'} onChange={() => handleToggleEstado(c.id, c.estado)} disabled={actualizandoId === c.id} size="sm" />
                                            </td>
                                            <td className="px-lg py-sm text-right">
                                                <button type="button" onClick={() => abrirEdicion(c)} title={t('empleados.action_editar_cargo')} className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg hover:bg-primary/10">
                                                    <Pencil size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {ordenados.length === 0 && (
                                        <tr><td colSpan={3} className="px-lg py-xl text-center text-text-secondary">{t('configuracion.sin_registros_agregar_primero')}</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile cards */}
                        <div className="sm:hidden flex flex-col divide-y divide-border">
                            {ordenados.map((c) => (
                                <div key={c.id} className={`flex items-center justify-between gap-2 px-md py-sm ${c.estado === 'activo' ? '' : 'opacity-50 bg-surface/30'}`}>
                                    <span className="text-[13px] font-semibold text-heading">{c.nombre}</span>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button type="button" onClick={() => abrirEdicion(c)} title={t('empleados.action_editar_cargo')} className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg">
                                            <Pencil size={14} />
                                        </button>
                                        <ConfigToggle checked={c.estado === 'activo'} onChange={() => handleToggleEstado(c.id, c.estado)} disabled={actualizandoId === c.id} size="sm" />
                                    </div>
                                </div>
                            ))}
                            {ordenados.length === 0 && <p className="px-md py-xl text-center text-text-secondary">{t('configuracion.sin_registros')}</p>}
                        </div>
                    </div>
                )}
            </section>

            {mostrarModal && (
                <ConfigCrudModal title={editTarget ? t('empleados.form_title_editar_cargo') : t('empleados.action_agregar_cargo')} onClose={cerrarModal} onSave={handleSave} saving={isSubmitting}>
                    <InputField
                        label={t('empleados.field_nombre_cargo')}
                        placeholder={t('empleados.field_nombre_cargo_placeholder')}
                        value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                    />
                    {error && <p className="text-caption text-error">{error}</p>}
                </ConfigCrudModal>
            )}
        </div>
    );
};
