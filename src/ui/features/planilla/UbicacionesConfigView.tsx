import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Pencil, Plus } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { useUbicacionesStore } from '../../../store/ubicacionesStore';
import { ubicacionesService, type ModalidadCaptura, type Ubicacion } from '../../../services/ubicacionesService';
import { InputField } from '../../components/InputField';
import { PageLoader } from '../../components/PageLoader';
import { ConfigToggle } from './components/ConfigToggle';
import { ConfigCrudModal } from './components/ConfigCrudModal';
import { Logger } from '../../../utils/logger';
import { useToast } from '../../../context/ToastContext';

const MODALIDADES: { value: ModalidadCaptura; labelKey: 'horasExtras.modalidad_reloj_marcador' | 'horasExtras.modalidad_manual'; icon: typeof Clock }[] = [
    { value: 'reloj_marcador', labelKey: 'horasExtras.modalidad_reloj_marcador', icon: Clock },
    { value: 'manual', labelKey: 'horasExtras.modalidad_manual', icon: Pencil },
];

function SegmentoModalidad({ valor, onPick, disabled }: { valor: ModalidadCaptura; onPick: (m: ModalidadCaptura) => void; disabled?: boolean }) {
    const { t } = useTranslation();
    return (
        <div className="inline-flex bg-surface border border-border rounded-lg p-0.5 gap-0.5 shrink-0">
            {MODALIDADES.map(({ value, labelKey, icon: Icon }) => (
                <button
                    key={value}
                    type="button"
                    disabled={disabled}
                    onClick={() => onPick(value)}
                    className={`flex items-center gap-1.5 px-sm py-xs rounded-md text-[12px] font-semibold transition-colors disabled:opacity-50 ${valor === value ? 'bg-white text-primary shadow-sm border border-border/50' : 'text-text-secondary hover:text-heading'}`}
                >
                    <Icon size={12} /> {t(labelKey)}
                </button>
            ))}
        </div>
    );
}

/**
 * Configuración > Ubicaciones (US-HEX-00 CA1/CA2/CA4). Fidelidad al DEMO: tabla desktop +
 * cards mobile, alta vía modal, contador y orden activos-primero. La modalidad de captura
 * se mantiene como control inline (segmentado) en la fila en vez de un campo del modal —
 * es un ajuste rápido de uso frecuente, no una propiedad de alta.
 */
export const UbicacionesConfigView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const { ubicaciones, isLoading, fetchUbicaciones, upsertUbicacion } = useUbicacionesStore();

    const [mostrarModal, setMostrarModal] = useState(false);
    const [editTarget, setEditTarget] = useState<Ubicacion | null>(null);
    const [nombre, setNombre] = useState('');
    const [modalidadNueva, setModalidadNueva] = useState<ModalidadCaptura>('manual');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [actualizandoId, setActualizandoId] = useState<string | null>(null);

    useEffect(() => { fetchUbicaciones(); }, [fetchUbicaciones]);

    const activas = ubicaciones.filter((u) => u.estado === 'activo');
    const ordenadas: Ubicacion[] = [...activas, ...ubicaciones.filter((u) => u.estado !== 'activo')];

    const cerrarModal = () => { setMostrarModal(false); setEditTarget(null); setNombre(''); setModalidadNueva('manual'); setError(null); };

    const abrirAlta = () => { setEditTarget(null); setNombre(''); setModalidadNueva('manual'); setError(null); setMostrarModal(true); };

    const abrirEdicion = (ubicacion: Ubicacion) => {
        setEditTarget(ubicacion);
        setNombre(ubicacion.nombre);
        setModalidadNueva(ubicacion.modalidad_captura);
        setError(null);
        setMostrarModal(true);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.tenant_id) return;
        if (!nombre.trim()) { setError(t('horasExtras.error_nombre_required')); return; }
        setError(null);
        setIsSubmitting(true);
        try {
            if (editTarget) {
                const actualizada = await ubicacionesService.updateUbicacion(editTarget.id, { nombre: nombre.trim(), modalidad_captura: modalidadNueva });
                upsertUbicacion(actualizada);
            } else {
                const nueva = await ubicacionesService.createUbicacion(profile.tenant_id, nombre.trim(), modalidadNueva);
                upsertUbicacion(nueva);
            }
            cerrarModal();
        } catch (err: unknown) {
            Logger.error('Error al guardar ubicación', { editandoId: editTarget?.id }, err);
            // Bugfix (auditoría, minor #1): antes se mostraba siempre el mensaje genérico —
            // un duplicado de nombre (UNIQUE tenant_id+nombre) no decía qué había pasado.
            const code = (err as { code?: string } | null)?.code;
            setError(code === '23505' ? t('horasExtras.error_ubicacion_duplicada') : t('horasExtras.error_crear_ubicacion'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCambiarModalidad = async (id: string, modalidad_captura: ModalidadCaptura) => {
        setActualizandoId(id);
        try {
            const actualizada = await ubicacionesService.updateUbicacion(id, { modalidad_captura });
            upsertUbicacion(actualizada);
        } catch (err: unknown) {
            Logger.error('Error al cambiar modalidad de ubicación', { id }, err);
            showToast(t('horasExtras.error_cambiar_modalidad_ubicacion'), 'error');
        } finally {
            setActualizandoId(null);
        }
    };

    const handleToggleEstado = async (id: string, estadoActual: 'activo' | 'inactivo') => {
        setActualizandoId(id);
        try {
            const actualizada = await ubicacionesService.updateUbicacion(id, { estado: estadoActual === 'activo' ? 'inactivo' : 'activo' });
            upsertUbicacion(actualizada);
        } catch (err: unknown) {
            Logger.error('Error al cambiar estado de ubicación', { id }, err);
            showToast(t('horasExtras.error_cambiar_estado_ubicacion'), 'error');
        } finally {
            setActualizandoId(null);
        }
    };

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
                        <Plus size={15} /> {t('horasExtras.action_agregar_ubicacion')}
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
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('horasExtras.field_nombre_ubicacion')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">Modalidad</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-center">{t('configuracion.col_estado')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-right">{t('horasExtras.col_acciones')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ordenadas.map((u) => (
                                        <tr key={u.id} className={`border-b border-border last:border-0 transition-colors ${u.estado === 'activo' ? 'hover:bg-surface/60' : 'opacity-50 bg-surface/30'}`}>
                                            <td className="px-lg py-sm font-semibold text-heading text-[13px]">{u.nombre}</td>
                                            <td className="px-lg py-sm">
                                                <SegmentoModalidad valor={u.modalidad_captura} onPick={(m) => handleCambiarModalidad(u.id, m)} disabled={actualizandoId === u.id} />
                                            </td>
                                            <td className="px-lg py-sm text-center">
                                                <ConfigToggle checked={u.estado === 'activo'} onChange={() => handleToggleEstado(u.id, u.estado)} disabled={actualizandoId === u.id} size="sm" />
                                            </td>
                                            <td className="px-lg py-sm text-right">
                                                <button type="button" onClick={() => abrirEdicion(u)} title={t('horasExtras.action_editar_ubicacion')} className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg hover:bg-primary/10">
                                                    <Pencil size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {ordenadas.length === 0 && (
                                        <tr><td colSpan={4} className="px-lg py-xl text-center text-text-secondary">{t('configuracion.sin_registros_agregar_primero')}</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile cards */}
                        <div className="sm:hidden flex flex-col divide-y divide-border">
                            {ordenadas.map((u) => (
                                <div key={u.id} className={`flex flex-col gap-2 px-md py-sm ${u.estado === 'activo' ? '' : 'opacity-50 bg-surface/30'}`}>
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="font-semibold text-heading text-[13px] truncate">{u.nombre}</p>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button type="button" onClick={() => abrirEdicion(u)} title={t('horasExtras.action_editar_ubicacion')} className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg">
                                                <Pencil size={14} />
                                            </button>
                                            <ConfigToggle checked={u.estado === 'activo'} onChange={() => handleToggleEstado(u.id, u.estado)} disabled={actualizandoId === u.id} size="sm" />
                                        </div>
                                    </div>
                                    <SegmentoModalidad valor={u.modalidad_captura} onPick={(m) => handleCambiarModalidad(u.id, m)} disabled={actualizandoId === u.id} />
                                </div>
                            ))}
                            {ordenadas.length === 0 && <p className="px-md py-xl text-center text-text-secondary">{t('configuracion.sin_registros')}</p>}
                        </div>
                    </div>
                )}
            </section>

            {mostrarModal && (
                <ConfigCrudModal title={editTarget ? t('horasExtras.form_title_editar_ubicacion') : t('horasExtras.action_agregar_ubicacion')} onClose={cerrarModal} onSave={handleSave} saving={isSubmitting}>
                    <InputField
                        label={t('horasExtras.field_nombre_ubicacion')}
                        placeholder={t('horasExtras.field_nombre_ubicacion_placeholder')}
                        value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                    />
                    <SegmentoModalidad valor={modalidadNueva} onPick={setModalidadNueva} />
                    {error && <p className="text-caption text-error">{error}</p>}
                </ConfigCrudModal>
            )}
        </div>
    );
};
