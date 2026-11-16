import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, Plus, Pencil, AlertTriangle } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { useCargosStore } from '../../../store/cargosStore';
import { cargosService } from '../../../services/cargosService';
import { tarifasKmService, type TarifaKmCargo } from '../../../services/tarifasKmService';
import { InputField } from '../../components/InputField';
import { PageLoader } from '../../components/PageLoader';
import { ConfigCrudModal } from './components/ConfigCrudModal';
import { CatalogSelectQuickAdd } from './components/CatalogSelectQuickAdd';
import { Logger } from '../../../utils/logger';
import { useToast } from '../../../context/ToastContext';

/**
 * Configuración > Tarifas por KM según Cargo (US-VIA-06 CA2). Fidelidad al DEMO: tabla
 * desktop + cards mobile, alta vía modal, contador. Sin concepto de activo/inactivo — solo
 * alta y baja, así que el contador muestra el total configurado.
 */
export const TarifasKmConfigView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const { cargos, fetchCargos, upsertCargo } = useCargosStore();

    const [tarifas, setTarifas] = useState<TarifaKmCargo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [eliminandoId, setEliminandoId] = useState<string | null>(null);

    const [mostrarModal, setMostrarModal] = useState(false);
    const [editTarget, setEditTarget] = useState<TarifaKmCargo | null>(null);
    const [cargo, setCargo] = useState('');
    const [tarifaKm, setTarifaKm] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const cargar = async () => {
        setIsLoading(true);
        try {
            const data = await tarifasKmService.getTarifas();
            setTarifas(data);
        } catch (err: unknown) {
            Logger.error('Error al cargar tarifas por KM', {}, err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { cargar(); }, []);
    useEffect(() => { fetchCargos(); }, [fetchCargos]);

    const cerrarModal = () => { setMostrarModal(false); setEditTarget(null); setCargo(''); setTarifaKm(''); setError(null); };

    const abrirAlta = () => { setEditTarget(null); setCargo(''); setTarifaKm(''); setError(null); setMostrarModal(true); };

    const abrirEdicion = (tarifa: TarifaKmCargo) => {
        setEditTarget(tarifa);
        setCargo(tarifa.cargo);
        setTarifaKm(String(tarifa.tarifa_km));
        setError(null);
        setMostrarModal(true);
    };

    // Bugfix (auditoría, minor #2): una tarifa de $0/km se aceptaba sin aviso — plausible
    // typo (ej. "0.25" tecleado como "0") que dejaría el reembolso de kilometraje en cero
    // para quien se le asigne ese cargo. Advertencia liviana, NO bloqueante (mismo criterio
    // que fechaFueraDeOrden en IndemnizacionesSection: informa, no impide guardar).
    const tarifaEsCero = tarifaKm !== '' && Number(tarifaKm) === 0;

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.tenant_id) return;
        if (!cargo.trim() || !tarifaKm) { setError(t('viaticos.error_campos_requeridos')); return; }
        setError(null);
        setIsSubmitting(true);
        try {
            if (editTarget) {
                const actualizada = await tarifasKmService.actualizarTarifa(editTarget.id, { cargo: cargo.trim(), tarifa_km: Number(tarifaKm) });
                setTarifas((prev) => prev.map((tk) => (tk.id === editTarget.id ? actualizada : tk)).sort((a, b) => a.cargo.localeCompare(b.cargo)));
            } else {
                const nueva = await tarifasKmService.crearTarifa(profile.tenant_id, cargo.trim(), Number(tarifaKm));
                setTarifas((prev) => [...prev, nueva].sort((a, b) => a.cargo.localeCompare(b.cargo)));
            }
            cerrarModal();
        } catch (err: unknown) {
            Logger.error('Error al guardar tarifa por KM', { editandoId: editTarget?.id }, err);
            // Bugfix (auditoría, minor #1): antes se mostraba siempre el mensaje genérico —
            // un duplicado de cargo (UNIQUE tenant_id+cargo) no decía qué había pasado.
            const code = (err as { code?: string } | null)?.code;
            setError(code === '23505' ? t('viaticos.error_tarifa_duplicada') : t('viaticos.error_guardar'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        setEliminandoId(id);
        try {
            await tarifasKmService.eliminarTarifa(id);
            setTarifas((prev) => prev.filter((tk) => tk.id !== id));
        } catch (err: unknown) {
            Logger.error('Error al eliminar tarifa por KM', { id }, err);
            showToast(t('viaticos.error_eliminar_tarifa'), 'error');
        } finally {
            setEliminandoId(null);
        }
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300">
            <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">
                <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                        {t('configuracion.contador_registros', { count: tarifas.length })}
                    </p>
                    <button
                        type="button"
                        onClick={abrirAlta}
                        className="flex items-center gap-1.5 px-md py-sm bg-primary text-white rounded-xl font-semibold text-[13px] hover:bg-primary-dark transition-colors shadow-cards"
                    >
                        <Plus size={15} /> {t('viaticos.action_agregar')}
                    </button>
                </div>

                {isLoading ? (
                    <PageLoader label={t('common.loading')} />
                ) : tarifas.length === 0 ? (
                    <p className="text-caption text-text-secondary italic">{t('viaticos.tarifas_km_empty')}</p>
                ) : (
                    <div className="bg-white rounded-xl border border-border overflow-hidden">
                        <div className="hidden sm:block overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-surface border-b border-border">
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('viaticos.field_cargo')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('viaticos.field_tarifa_km')}</th>
                                        <th className="w-20 px-lg py-sm" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {tarifas.map((tk) => (
                                        <tr key={tk.id} className="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                                            <td className="px-lg py-sm font-semibold text-heading text-[13px]">{tk.cargo}</td>
                                            <td className="px-lg py-sm text-[13px] text-text-secondary">${tk.tarifa_km.toFixed(2)}/km</td>
                                            <td className="px-lg py-sm">
                                                <div className="flex items-center justify-end gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => abrirEdicion(tk)}
                                                        title={t('viaticos.action_editar_tarifa')}
                                                        className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg hover:bg-primary/10"
                                                    >
                                                        <Pencil size={14} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDelete(tk.id)}
                                                        disabled={eliminandoId === tk.id}
                                                        className="p-1.5 text-text-secondary hover:text-error transition-colors rounded-lg hover:bg-error/10 disabled:opacity-50"
                                                    >
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
                            {tarifas.map((tk) => (
                                <div key={tk.id} className="flex items-center justify-between gap-md px-md py-sm">
                                    <p className="font-semibold text-heading text-[13px]">{tk.cargo} <span className="font-normal text-text-secondary">— ${tk.tarifa_km.toFixed(2)}/km</span></p>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => abrirEdicion(tk)}
                                            title={t('viaticos.action_editar_tarifa')}
                                            className="p-1.5 text-text-secondary hover:text-primary rounded-lg"
                                        >
                                            <Pencil size={14} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(tk.id)}
                                            disabled={eliminandoId === tk.id}
                                            className="p-1.5 text-text-secondary hover:text-error rounded-lg disabled:opacity-50"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </section>

            {mostrarModal && (
                <ConfigCrudModal title={editTarget ? t('viaticos.form_title_editar_tarifa') : t('viaticos.action_agregar')} onClose={cerrarModal} onSave={handleSave} saving={isSubmitting}>
                    <CatalogSelectQuickAdd
                        label={t('viaticos.field_cargo')}
                        value={cargo}
                        onChange={setCargo}
                        items={cargos}
                        onCrear={(nombre) => {
                            if (!profile?.tenant_id) return Promise.reject(new Error('Sin tenant'));
                            return cargosService.createCargo(profile.tenant_id, nombre).then((c) => { upsertCargo(c); return c; });
                        }}
                        emptyOptionLabel={t('empleados.cargo_seleccionar')}
                        required
                        quickAddTitle={t('empleados.action_agregar_cargo')}
                        quickAddFieldLabel={t('empleados.field_nombre_cargo')}
                        duplicadoErrorMessage={t('empleados.error_cargo_duplicado')}
                        genericErrorMessage={t('empleados.error_crear_cargo')}
                    />
                    <InputField
                        label={t('viaticos.field_tarifa_km')}
                        type="number"
                        min={0}
                        step="0.01"
                        value={tarifaKm}
                        onChange={(e) => setTarifaKm(e.target.value)}
                    />
                    {tarifaEsCero && (
                        <p className="flex items-center gap-1.5 text-caption text-amber-700">
                            <AlertTriangle size={12} className="shrink-0" /> {t('viaticos.warning_tarifa_cero')}
                        </p>
                    )}
                    {error && <p className="text-caption text-error">{error}</p>}
                </ConfigCrudModal>
            )}
        </div>
    );
};
