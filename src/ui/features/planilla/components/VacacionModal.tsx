import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Info, AlertTriangle, CalendarRange } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { vacacionesService, type Vacacion } from '../../../../services/vacacionesService';
import { calcularPagoVacacion } from '../../../../utils/vacacionesUtils';
import { fechaFueraDeQuincena } from '../../../../utils/quincenaUtils';
import type { Empleado } from '../../../../services/planillaEmpleadosService';
import { InputField } from '../../../components/InputField';
import { Button } from '../../../components/Button';
import { EmpleadoCombobox } from '../../../components/EmpleadoCombobox';
import { Logger } from '../../../../utils/logger';
import { extraerMensajeError } from '../../../../utils/supabaseErrorUtils';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual' | 'sueldo_mensual'>;

const FORM_VACIO = { fechaInicio: '', fechaFin: '', noGozada: false, conciliado: false };

interface ToggleProps {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
}

/** Interruptor visual (fidelidad DEMO) — reemplaza el checkbox plano para "conciliado". */
const Toggle: React.FC<ToggleProps> = ({ checked, onChange, label }) => (
    <div className="flex items-center justify-between gap-md">
        <span className="text-caption text-heading font-medium">{label}</span>
        <button
            type="button"
            onClick={() => onChange(!checked)}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 ${checked ? 'bg-primary' : 'bg-border'}`}
        >
            <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-cards transform transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
    </div>
);

interface VacacionModalProps {
    empleados: EmpleadoActivo[];
    quincenaId: string;
    quincenaFechaInicio?: string;
    quincenaFechaFin?: string;
    registroExistente: Vacacion | null;
    onClose: () => void;
    onSaved: (registro: Vacacion, esNuevo: boolean) => void;
}

/** Modal/bottom-sheet para Registrar/Editar Vacaciones (US-VAC-01/02) — fidelidad DEMO
 * (US-UX-02): mismo chrome de overlay que IncapacidadModal/AnticipoModal. */
export const VacacionModal: React.FC<VacacionModalProps> = ({ empleados, quincenaId, quincenaFechaInicio, quincenaFechaFin, registroExistente, onClose, onSaved }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();

    const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState<EmpleadoActivo | null>(
        registroExistente ? empleados.find((e) => e.id === registroExistente.empleado_id) ?? null : null
    );
    const [form, setForm] = useState(registroExistente ? {
        fechaInicio: registroExistente.fecha_inicio,
        fechaFin: registroExistente.fecha_fin,
        noGozada: registroExistente.no_gozada,
        conciliado: registroExistente.conciliado,
    } : FORM_VACIO);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const calculo = form.fechaInicio && form.fechaFin && form.fechaFin >= form.fechaInicio && empleadoSeleccionado?.sueldo_mensual
        ? calcularPagoVacacion(form.fechaInicio, form.fechaFin, empleadoSeleccionado.sueldo_mensual)
        : null;

    // IMPL-134 (Observación General UAT) — advertencia no bloqueante si la fecha de inicio cae
    // fuera del rango de la quincena que se está calculando.
    const fechaFueraRango = fechaFueraDeQuincena(form.fechaInicio, quincenaFechaInicio, quincenaFechaFin);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.id || !quincenaId) return;
        if (!empleadoSeleccionado || !form.fechaInicio || !form.fechaFin || form.fechaFin < form.fechaInicio) {
            setError(t('vacaciones.error_campos_requeridos'));
            return;
        }
        if (!empleadoSeleccionado.sueldo_mensual) {
            setError(t('vacaciones.error_sin_sueldo'));
            return;
        }

        setError(null);
        setIsSubmitting(true);
        try {
            const resultado = registroExistente
                ? await vacacionesService.actualizar(registroExistente.id, {
                    empleadoId: empleadoSeleccionado.id,
                    fechaInicio: form.fechaInicio,
                    fechaFin: form.fechaFin,
                    sueldoMensual: empleadoSeleccionado.sueldo_mensual,
                    noGozada: form.noGozada,
                    conciliado: form.conciliado,
                })
                : await vacacionesService.crear({
                    quincenaId,
                    empleadoId: empleadoSeleccionado.id,
                    fechaInicio: form.fechaInicio,
                    fechaFin: form.fechaFin,
                    sueldoMensual: empleadoSeleccionado.sueldo_mensual,
                    noGozada: form.noGozada,
                    userId: profile.id,
                    conciliado: form.conciliado,
                });
            onSaved(resultado, !registroExistente);
            onClose();
        } catch (err: unknown) {
            Logger.error('Error al guardar vacación', { editandoId: registroExistente?.id }, err);
            setError(extraerMensajeError(err, t('vacaciones.error_guardar')));
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
                                <CalendarRange size={16} className="text-primary" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{registroExistente ? t('vacaciones.form_title_editar') : t('vacaciones.form_title')}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="overflow-y-auto p-lg flex flex-col gap-md">
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

                        <div className="grid grid-cols-2 gap-md">
                            <InputField
                                label={t('vacaciones.field_fecha_inicio')}
                                type="date" mask="date"
                                value={form.fechaInicio}
                                onChange={(e) => setForm((prev) => ({ ...prev, fechaInicio: e.target.value }))}
                                required
                            />
                            <InputField
                                label={t('vacaciones.field_fecha_fin')}
                                type="date" mask="date"
                                value={form.fechaFin}
                                min={form.fechaInicio}
                                onChange={(e) => setForm((prev) => ({ ...prev, fechaFin: e.target.value }))}
                                required
                            />
                        </div>

                        {fechaFueraRango && (
                            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-md">
                                <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                                <p className="text-caption text-heading">{t('common.advertencia_fecha_fuera_quincena')}</p>
                            </div>
                        )}

                        {calculo && (
                            <div className="bg-surface rounded-xl border border-border p-md flex flex-col gap-2">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('vacaciones.calculo_dias', { dias: calculo.dias })}</p>
                                <div className="grid grid-cols-3 gap-2">
                                    <div className="bg-white rounded-lg p-2 text-center border border-border">
                                        <p className="text-[9px] font-bold uppercase tracking-widest text-text-secondary leading-tight">{t('vacaciones.calculo_col_base')}</p>
                                        <p className="text-[13px] font-bold mt-0.5 text-heading">${calculo.montoBase.toFixed(2)}</p>
                                    </div>
                                    <div className="bg-white rounded-lg p-2 text-center border border-border">
                                        <p className="text-[9px] font-bold uppercase tracking-widest text-text-secondary leading-tight">{t('vacaciones.calculo_col_recargo')}</p>
                                        <p className="text-[13px] font-bold mt-0.5 text-amber-600">${calculo.recargo30.toFixed(2)}</p>
                                    </div>
                                    <div className="bg-white rounded-lg p-2 text-center border border-border">
                                        <p className="text-[9px] font-bold uppercase tracking-widest text-text-secondary leading-tight">{t('vacaciones.calculo_col_total')}</p>
                                        <p className="text-[13px] font-bold mt-0.5 text-primary">${calculo.montoTotal.toFixed(2)}</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2 text-[11px] text-text-secondary pt-1">
                                    <Info size={12} className="shrink-0 mt-0.5" />
                                    <p>{t('vacaciones.calculo_recargo_informativo')}</p>
                                </div>
                            </div>
                        )}
                        {empleadoSeleccionado && !empleadoSeleccionado.sueldo_mensual && (
                            <p className="text-caption text-error">{t('vacaciones.error_sin_sueldo')}</p>
                        )}

                        <div className="flex flex-col gap-2 pt-2 border-t border-border/40">
                            <label className="flex items-center gap-2 text-caption text-heading">
                                <input
                                    type="checkbox"
                                    checked={form.noGozada}
                                    onChange={(e) => setForm((prev) => ({ ...prev, noGozada: e.target.checked }))}
                                />
                                {t('vacaciones.field_no_gozada')}
                            </label>
                            {form.noGozada && (
                                <div className="flex items-start gap-2 text-[11px] text-text-secondary">
                                    <Info size={12} className="shrink-0 mt-0.5" />
                                    <p>{t('vacaciones.no_gozada_informativo')}</p>
                                </div>
                            )}
                        </div>

                        <div className="bg-surface rounded-xl border border-border p-md">
                            <Toggle checked={form.conciliado} onChange={(v) => setForm((prev) => ({ ...prev, conciliado: v }))} label={t('vacaciones.field_conciliado')} />
                            <p className="text-[11px] text-text-secondary mt-1">
                                {form.conciliado ? t('vacaciones.conciliado_nota') : t('vacaciones.pendiente_nota')}
                            </p>
                        </div>

                        {error && <p className="text-caption text-error">{error}</p>}
                    </div>

                    <div className="px-lg py-md border-t border-border flex gap-sm shrink-0">
                        <Button type="submit" isLoading={isSubmitting} className="flex-1">
                            {registroExistente ? t('vacaciones.action_guardar_cambios') : t('vacaciones.action_guardar')}
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
