import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Gift } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { bonificacionesService, type Bonificacion } from '../../../../services/bonificacionesService';
import type { BonificacionTipo } from '../../../../services/bonificacionTiposService';
import type { Gravabilidad } from '../../../../services/otrosIngresosConceptosService';
import type { Empleado } from '../../../../services/planillaEmpleadosService';
import { InputField } from '../../../components/InputField';
import { Button } from '../../../components/Button';
import { EmpleadoCombobox } from '../../../components/EmpleadoCombobox';
import { GravabilidadSelector } from '../../../components/GravabilidadSelector';
import { Logger } from '../../../../utils/logger';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'codigo' | 'codigo_empleado_manual'>;

interface BonificacionModalProps {
    empleados: EmpleadoActivo[];
    tipos: BonificacionTipo[];
    quincenaId: string;
    nombreEmpleado: (empleadoId: string) => string;
    editando: Bonificacion | null;
    onClose: () => void;
    onSaved: (registros: Bonificacion[], esNuevo: boolean) => void;
}

/** Modal/bottom-sheet para Registrar/Editar Bonificación manual (US-BON-03/04) — fidelidad
 * DEMO (US-UX-02): mismo chrome de overlay que VacacionModal/IncapacidadModal. Un bono
 * automático (por tabla de incentivo) solo permite corregir el monto al editar (US-BON-04 CA1). */
export const BonificacionModal: React.FC<BonificacionModalProps> = ({ empleados, tipos, quincenaId, nombreEmpleado, editando, onClose, onSaved }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();

    const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState<EmpleadoActivo | null>(null);
    const [todosEmpleados, setTodosEmpleados] = useState(false);
    const [tipoId, setTipoId] = useState(editando?.tipo_id ?? '');
    const [monto, setMonto] = useState(editando ? String(editando.monto) : '');
    const [gravabilidad, setGravabilidad] = useState<Gravabilidad>(editando?.gravabilidad ?? 'gravable');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const totalNominaPreview = todosEmpleados && monto ? Number(monto) * empleados.length : null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.id || !quincenaId) return;

        if (editando) {
            if (editando.origen === 'manual' && !tipoId) {
                setError(t('bonificaciones.error_campos_requeridos_manual'));
                return;
            }
            if (!monto || Number(monto) <= 0) {
                setError(t('bonificaciones.error_campos_requeridos_manual'));
                return;
            }
            setError(null);
            setIsSubmitting(true);
            try {
                const actualizado = await bonificacionesService.actualizar(
                    editando.id,
                    editando.origen === 'manual' ? tipoId : null,
                    Number(monto),
                    editando.origen === 'manual' ? gravabilidad : 'gravable'
                );
                onSaved([actualizado], false);
                onClose();
            } catch (err: unknown) {
                Logger.error('Error al actualizar bonificación', { id: editando.id }, err);
                setError(err instanceof Error ? err.message : t('bonificaciones.error_registrar_manual'));
            } finally {
                setIsSubmitting(false);
            }
            return;
        }

        if ((!todosEmpleados && !empleadoSeleccionado) || !tipoId || !monto || Number(monto) <= 0) {
            setError(t('bonificaciones.error_campos_requeridos_manual'));
            return;
        }
        setError(null);
        setIsSubmitting(true);
        try {
            const creados = await bonificacionesService.crearManual({
                quincenaId,
                empleadoId: todosEmpleados ? null : empleadoSeleccionado!.id,
                todosEmpleados,
                tipoId,
                monto: Number(monto),
                gravabilidad,
                userId: profile.id,
            });
            onSaved(creados, true);
            onClose();
        } catch (err: unknown) {
            Logger.error('Error al registrar bonificación manual', {}, err);
            setError(t('bonificaciones.error_registrar_manual'));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-heading/40 backdrop-blur-xs" onClick={onClose} />

            <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-lg pointer-events-none">
                <form
                    onSubmit={handleSubmit}
                    className="pointer-events-auto w-full sm:max-w-[520px] bg-white rounded-t-2xl sm:rounded-2xl shadow-modals flex flex-col max-h-[92dvh] overflow-hidden animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-300"
                >
                    <div className="sm:hidden flex justify-center pt-sm pb-0 shrink-0">
                        <div className="w-10 h-1 rounded-full bg-border" />
                    </div>

                    <div className="flex items-center justify-between px-lg py-md border-b border-border shrink-0">
                        <div className="flex items-center gap-sm">
                            <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                                <Gift size={16} className="text-primary" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{editando ? t('bonificaciones.form_editar_title') : t('bonificaciones.form_manual_title')}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="overflow-y-auto p-lg flex flex-col gap-md">
                        {editando && (
                            <p className="text-caption text-text-secondary">
                                {nombreEmpleado(editando.empleado_id)}
                                {editando.origen === 'automatico' && ` — ${t('bonificaciones.editar_automatico_nota')}`}
                            </p>
                        )}

                        {!editando && (
                            <label className="flex items-center gap-2 text-caption text-heading">
                                <input type="checkbox" checked={todosEmpleados} onChange={(e) => { setTodosEmpleados(e.target.checked); setEmpleadoSeleccionado(null); }} />
                                {t('bonificaciones.field_todos_empleados')}
                            </label>
                        )}

                        {!editando && !todosEmpleados && (
                            <div className="flex flex-col gap-1 relative">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('vacaciones.field_empleado')} <span className="text-error">*</span></label>
                                <EmpleadoCombobox
                                    empleados={empleados}
                                    value={empleadoSeleccionado}
                                    onChange={setEmpleadoSeleccionado}
                                    placeholder={t('vacaciones.field_empleado_buscar_placeholder')}
                                    noResultsLabel={t('vacaciones.field_empleado_sin_resultados')}
                                />
                            </div>
                        )}

                        {(!editando || editando.origen === 'manual') && (
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('bonificaciones.field_tipo')} <span className="text-error">*</span></label>
                                <select value={tipoId} onChange={(e) => setTipoId(e.target.value)} className="rounded-md border border-border bg-white px-3 py-2 text-sm">
                                    <option value="">{t('bonificaciones.field_tipo_placeholder')}</option>
                                    {tipos.map((tp) => <option key={tp.id} value={tp.id}>{tp.nombre}</option>)}
                                </select>
                            </div>
                        )}

                        <InputField label={t('otrosIngresos.field_monto')} type="number" min={0} step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} required />

                        {totalNominaPreview !== null && (
                            <p className="text-caption text-heading bg-primary-light/20 border border-primary/20 rounded-lg p-md">
                                {t('bonificaciones.total_nomina_preview', { monto: Number(monto).toFixed(2), count: empleados.length, total: totalNominaPreview.toFixed(2) })}
                            </p>
                        )}

                        {(!editando || editando.origen === 'manual') && (
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('otrosIngresos.field_gravabilidad')}</label>
                                <GravabilidadSelector value={gravabilidad} onChange={setGravabilidad} />
                            </div>
                        )}

                        {error && <p className="text-caption text-error">{error}</p>}
                    </div>

                    <div className="px-lg py-md border-t border-border flex gap-sm shrink-0">
                        <Button type="submit" isLoading={isSubmitting} className="flex-1">
                            {editando ? t('bonificaciones.action_guardar_cambios') : t('bonificaciones.action_guardar_manual')}
                        </Button>
                        <button type="button" onClick={onClose} className="px-lg py-sm border border-border rounded-xl text-body text-text-secondary hover:bg-surface transition-colors">
                            {t('vacaciones.action_cancelar')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
