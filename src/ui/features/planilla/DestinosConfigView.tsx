import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { useDestinosStore } from '../../../store/destinosStore';
import { destinosService, type Destino } from '../../../services/destinosService';
import { InputField } from '../../components/InputField';
import { PageLoader } from '../../components/PageLoader';
import { ConfigToggle } from './components/ConfigToggle';
import { ConfigCrudModal } from './components/ConfigCrudModal';
import { Logger } from '../../../utils/logger';
import { useToast } from '../../../context/ToastContext';

/**
 * Configuración > Destinos (IMPL-170 CA4). Mismo patrón que BancosConfigView, con un campo
 * adicional de monto fijo: al importar un lote de Viáticos, un Destino que coincida con este
 * catálogo precarga automáticamente su monto, aunque el documento no traiga uno legible.
 */
export const DestinosConfigView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const { destinos, isLoading, fetchDestinos, upsertDestino } = useDestinosStore();

    const [mostrarModal, setMostrarModal] = useState(false);
    const [editTarget, setEditTarget] = useState<Destino | null>(null);
    const [nombre, setNombre] = useState('');
    const [monto, setMonto] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [actualizandoId, setActualizandoId] = useState<string | null>(null);

    useEffect(() => { fetchDestinos(); }, [fetchDestinos]);

    const activos = destinos.filter((d) => d.estado === 'activo');
    const ordenados: Destino[] = [...activos, ...destinos.filter((d) => d.estado !== 'activo')];

    const cerrarModal = () => { setMostrarModal(false); setEditTarget(null); setNombre(''); setMonto(''); setError(null); };

    const abrirAlta = () => { setEditTarget(null); setNombre(''); setMonto(''); setError(null); setMostrarModal(true); };

    const abrirEdicion = (destino: Destino) => { setEditTarget(destino); setNombre(destino.nombre); setMonto(String(destino.monto)); setError(null); setMostrarModal(true); };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.tenant_id) return;
        if (!nombre.trim()) { setError(t('viaticos.error_nombre_destino_required')); return; }
        const montoNumerico = Number(monto);
        if (!monto || Number.isNaN(montoNumerico) || montoNumerico < 0) { setError(t('viaticos.error_monto_destino_invalido')); return; }
        setError(null);
        setIsSubmitting(true);
        try {
            if (editTarget) {
                const actualizado = await destinosService.updateDestino(editTarget.id, { nombre: nombre.trim(), monto: montoNumerico });
                upsertDestino(actualizado);
            } else {
                const nuevo = await destinosService.createDestino(profile.tenant_id, nombre.trim(), montoNumerico);
                upsertDestino(nuevo);
            }
            cerrarModal();
        } catch (err: unknown) {
            Logger.error('Error al guardar destino', { editandoId: editTarget?.id }, err);
            const code = (err as { code?: string } | null)?.code;
            setError(code === '23505' ? t('viaticos.error_destino_duplicado') : t('viaticos.error_crear_destino'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleToggleEstado = async (id: string, estadoActual: 'activo' | 'inactivo') => {
        setActualizandoId(id);
        try {
            const actualizado = await destinosService.updateDestino(id, { estado: estadoActual === 'activo' ? 'inactivo' : 'activo' });
            upsertDestino(actualizado);
        } catch (err: unknown) {
            Logger.error('Error al cambiar estado de destino', { id }, err);
            showToast(t('viaticos.error_cambiar_estado_destino'), 'error');
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
                        <Plus size={15} /> {t('viaticos.action_agregar_destino')}
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
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('viaticos.field_nombre_destino')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-right">{t('viaticos.field_monto_destino')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-center">{t('configuracion.col_estado')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-right">{t('empleados.col_acciones')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ordenados.map((d) => (
                                        <tr key={d.id} className={`border-b border-border last:border-0 transition-colors ${d.estado === 'activo' ? 'hover:bg-surface/60' : 'opacity-50 bg-surface/30'}`}>
                                            <td className="px-lg py-sm font-semibold text-heading text-[13px]">{d.nombre}</td>
                                            <td className="px-lg py-sm text-right text-[13px] text-heading">${d.monto.toFixed(2)}</td>
                                            <td className="px-lg py-sm text-center">
                                                <ConfigToggle checked={d.estado === 'activo'} onChange={() => handleToggleEstado(d.id, d.estado)} disabled={actualizandoId === d.id} size="sm" />
                                            </td>
                                            <td className="px-lg py-sm text-right">
                                                <button type="button" onClick={() => abrirEdicion(d)} title={t('viaticos.action_editar_destino')} className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg hover:bg-primary/10">
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
                        <div className="sm:hidden flex flex-col divide-y divide-border">
                            {ordenados.map((d) => (
                                <div key={d.id} className={`flex items-center justify-between gap-2 px-md py-sm ${d.estado === 'activo' ? '' : 'opacity-50 bg-surface/30'}`}>
                                    <div className="min-w-0">
                                        <p className="font-semibold text-heading text-[13px] truncate">{d.nombre}</p>
                                        <p className="text-[11px] text-text-secondary">${d.monto.toFixed(2)}</p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button type="button" onClick={() => abrirEdicion(d)} title={t('viaticos.action_editar_destino')} className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg">
                                            <Pencil size={14} />
                                        </button>
                                        <ConfigToggle checked={d.estado === 'activo'} onChange={() => handleToggleEstado(d.id, d.estado)} disabled={actualizandoId === d.id} size="sm" />
                                    </div>
                                </div>
                            ))}
                            {ordenados.length === 0 && <p className="px-md py-xl text-center text-text-secondary">{t('configuracion.sin_registros')}</p>}
                        </div>
                    </div>
                )}
            </section>

            {mostrarModal && (
                <ConfigCrudModal title={editTarget ? t('viaticos.form_title_editar_destino') : t('viaticos.action_agregar_destino')} onClose={cerrarModal} onSave={handleSave} saving={isSubmitting}>
                    <InputField
                        label={t('viaticos.field_nombre_destino')}
                        value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                    />
                    <InputField
                        label={t('viaticos.field_monto_destino')}
                        type="number"
                        min={0}
                        step="0.01"
                        value={monto}
                        onChange={(e) => setMonto(e.target.value)}
                    />
                    {error && <p className="text-caption text-error">{error}</p>}
                </ConfigCrudModal>
            )}
        </div>
    );
};
