import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { useBancosStore } from '../../../store/bancosStore';
import { bancosService, type Banco } from '../../../services/bancosService';
import { InputField } from '../../components/InputField';
import { PageLoader } from '../../components/PageLoader';
import { ConfigToggle } from './components/ConfigToggle';
import { ConfigCrudModal } from './components/ConfigCrudModal';
import { Logger } from '../../../utils/logger';
import { useToast } from '../../../context/ToastContext';

/**
 * Configuración > Bancos (IMPL-122). Fidelidad al DEMO: tabla desktop + cards mobile, alta
 * vía modal, contador y orden activos-primero. Sin selector de color: a diferencia de
 * Departamento, ningún listado del sistema pinta el banco como badge.
 */
export const BancosConfigView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const { bancos, isLoading, fetchBancos, upsertBanco } = useBancosStore();

    const [mostrarModal, setMostrarModal] = useState(false);
    const [editTarget, setEditTarget] = useState<Banco | null>(null);
    const [nombre, setNombre] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [actualizandoId, setActualizandoId] = useState<string | null>(null);

    useEffect(() => { fetchBancos(); }, [fetchBancos]);

    const activos = bancos.filter((b) => b.estado === 'activo');
    const ordenados: Banco[] = [...activos, ...bancos.filter((b) => b.estado !== 'activo')];

    const cerrarModal = () => { setMostrarModal(false); setEditTarget(null); setNombre(''); setError(null); };

    const abrirAlta = () => { setEditTarget(null); setNombre(''); setError(null); setMostrarModal(true); };

    const abrirEdicion = (banco: Banco) => { setEditTarget(banco); setNombre(banco.nombre); setError(null); setMostrarModal(true); };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.tenant_id) return;
        if (!nombre.trim()) { setError(t('empleados.error_nombre_banco_required')); return; }
        setError(null);
        setIsSubmitting(true);
        try {
            if (editTarget) {
                const actualizado = await bancosService.updateBanco(editTarget.id, { nombre: nombre.trim() });
                upsertBanco(actualizado);
            } else {
                const nuevo = await bancosService.createBanco(profile.tenant_id, nombre.trim());
                upsertBanco(nuevo);
            }
            cerrarModal();
        } catch (err: unknown) {
            Logger.error('Error al guardar banco', { editandoId: editTarget?.id }, err);
            // Bugfix (auditoría, minor #1): antes se mostraba siempre el mensaje genérico —
            // un duplicado de nombre (UNIQUE tenant_id+nombre) no decía qué había pasado.
            const code = (err as { code?: string } | null)?.code;
            setError(code === '23505' ? t('empleados.error_banco_duplicado') : t('empleados.error_crear_banco'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleToggleEstado = async (id: string, estadoActual: 'activo' | 'inactivo') => {
        setActualizandoId(id);
        try {
            const actualizado = await bancosService.updateBanco(id, { estado: estadoActual === 'activo' ? 'inactivo' : 'activo' });
            upsertBanco(actualizado);
        } catch (err: unknown) {
            Logger.error('Error al cambiar estado de banco', { id }, err);
            showToast(t('empleados.error_cambiar_estado_banco'), 'error');
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
                        <Plus size={15} /> {t('empleados.action_agregar_banco')}
                    </button>
                </div>

                {isLoading ? (
                    <PageLoader label={t('common.loading')} />
                ) : (
                    <div className="bg-white rounded-xl border border-border overflow-hidden">
                        <div className="hidden sm:block overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-surface border-b border-border">
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('empleados.field_nombre_banco')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-center">{t('configuracion.col_estado')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-right">{t('empleados.col_acciones')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ordenados.map((b) => (
                                        <tr key={b.id} className={`border-b border-border last:border-0 transition-colors ${b.estado === 'activo' ? 'hover:bg-surface/60' : 'opacity-50 bg-surface/30'}`}>
                                            <td className="px-lg py-sm font-semibold text-heading text-[13px]">{b.nombre}</td>
                                            <td className="px-lg py-sm text-center">
                                                <ConfigToggle checked={b.estado === 'activo'} onChange={() => handleToggleEstado(b.id, b.estado)} disabled={actualizandoId === b.id} size="sm" />
                                            </td>
                                            <td className="px-lg py-sm text-right">
                                                <button type="button" onClick={() => abrirEdicion(b)} title={t('empleados.action_editar_banco')} className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg hover:bg-primary/10">
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
                        <div className="sm:hidden flex flex-col divide-y divide-border">
                            {ordenados.map((b) => (
                                <div key={b.id} className={`flex items-center justify-between gap-2 px-md py-sm ${b.estado === 'activo' ? '' : 'opacity-50 bg-surface/30'}`}>
                                    <p className="font-semibold text-heading text-[13px] truncate">{b.nombre}</p>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button type="button" onClick={() => abrirEdicion(b)} title={t('empleados.action_editar_banco')} className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg">
                                            <Pencil size={14} />
                                        </button>
                                        <ConfigToggle checked={b.estado === 'activo'} onChange={() => handleToggleEstado(b.id, b.estado)} disabled={actualizandoId === b.id} size="sm" />
                                    </div>
                                </div>
                            ))}
                            {ordenados.length === 0 && <p className="px-md py-xl text-center text-text-secondary">{t('configuracion.sin_registros')}</p>}
                        </div>
                    </div>
                )}
            </section>

            {mostrarModal && (
                <ConfigCrudModal title={editTarget ? t('empleados.form_title_editar_banco') : t('empleados.action_agregar_banco')} onClose={cerrarModal} onSave={handleSave} saving={isSubmitting}>
                    <InputField
                        label={t('empleados.field_nombre_banco')}
                        placeholder={t('empleados.field_nombre_banco_placeholder')}
                        value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                    />
                    {error && <p className="text-caption text-error">{error}</p>}
                </ConfigCrudModal>
            )}
        </div>
    );
};
