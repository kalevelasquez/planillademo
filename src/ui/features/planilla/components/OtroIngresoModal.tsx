import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Gift } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { otrosIngresosService, type OtroIngreso } from '../../../../services/otrosIngresosService';
import type { OtroIngresoConcepto, Gravabilidad } from '../../../../services/otrosIngresosConceptosService';
import type { Empleado } from '../../../../services/planillaEmpleadosService';
import { InputField } from '../../../components/InputField';
import { Button } from '../../../components/Button';
import { EmpleadoCombobox } from '../../../components/EmpleadoCombobox';
import { GravabilidadSelector } from '../../../components/GravabilidadSelector';
import { Logger } from '../../../../utils/logger';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual'>;

interface OtroIngresoModalProps {
    empleados: EmpleadoActivo[];
    conceptos: OtroIngresoConcepto[];
    conceptoPorId: Map<string, OtroIngresoConcepto>;
    quincenaId: string;
    registroExistente: OtroIngreso | null;
    onClose: () => void;
    onSaved: (registro: OtroIngreso, esNuevo: boolean) => void;
}

/** Modal/bottom-sheet para Registrar/Editar Otro Ingreso (US-OTR-01/02) — fidelidad DEMO
 * (US-UX-02): mismo chrome de overlay que BonificacionModal/VacacionModal. Último de los 5
 * módulos de alta simple en pasar de inline a modal. */
export const OtroIngresoModal: React.FC<OtroIngresoModalProps> = ({ empleados, conceptos, conceptoPorId, quincenaId, registroExistente, onClose, onSaved }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();

    const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState<EmpleadoActivo | null>(
        registroExistente ? empleados.find((e) => e.id === registroExistente.empleado_id) ?? null : null
    );
    const [conceptoId, setConceptoId] = useState(registroExistente?.concepto_id ?? '');
    const [monto, setMonto] = useState(registroExistente ? String(registroExistente.monto) : '');
    const [gravabilidad, setGravabilidad] = useState<Gravabilidad>(registroExistente?.gravabilidad ?? 'gravable');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleConceptoChange = (id: string) => {
        setConceptoId(id);
        const concepto = conceptoPorId.get(id);
        if (concepto) setGravabilidad(concepto.gravabilidad_default);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.id || !quincenaId) return;
        if (!empleadoSeleccionado || !conceptoId || !monto || Number(monto) <= 0) {
            setError(t('otrosIngresos.error_campos_requeridos_registro'));
            return;
        }
        setError(null);
        setIsSubmitting(true);
        try {
            const resultado = registroExistente
                ? await otrosIngresosService.actualizar(registroExistente.id, {
                    empleadoId: empleadoSeleccionado.id,
                    conceptoId,
                    monto: Number(monto),
                    gravabilidad,
                })
                : await otrosIngresosService.crear({
                    quincenaId,
                    empleadoId: empleadoSeleccionado.id,
                    conceptoId,
                    monto: Number(monto),
                    gravabilidad,
                    userId: profile.id,
                });
            onSaved(resultado, !registroExistente);
            onClose();
        } catch (err: unknown) {
            Logger.error('Error al guardar otro ingreso', { editandoId: registroExistente?.id }, err);
            // Al editar, el RPC puede rechazar por quincena cerrada (IMPL-104/CA1) — ese
            // mensaje específico se muestra tal cual; al crear, se usa el genérico.
            setError(registroExistente && err instanceof Error ? err.message : t('otrosIngresos.error_guardar_registro'));
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
                            <h3 className="text-body font-bold text-heading">{registroExistente ? t('otrosIngresos.form_title_editar') : t('otrosIngresos.form_title')}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="overflow-y-auto p-lg flex flex-col gap-md">
                        <div className="flex flex-col gap-1 relative">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('vacaciones.field_empleado')}</label>
                            <EmpleadoCombobox
                                empleados={empleados}
                                value={empleadoSeleccionado}
                                onChange={setEmpleadoSeleccionado}
                                placeholder={t('vacaciones.field_empleado_buscar_placeholder')}
                                noResultsLabel={t('vacaciones.field_empleado_sin_resultados')}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('otrosIngresos.field_concepto')}</label>
                            <select value={conceptoId} onChange={(e) => handleConceptoChange(e.target.value)} className="rounded-md border border-border bg-white px-3 py-2 text-sm">
                                <option value="">{t('otrosIngresos.field_concepto_placeholder')}</option>
                                {conceptos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                            </select>
                        </div>

                        <InputField label={t('otrosIngresos.field_monto')} type="number" min={0} step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} />

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('otrosIngresos.field_gravabilidad')}</label>
                            <GravabilidadSelector value={gravabilidad} onChange={setGravabilidad} />
                        </div>

                        {error && <p className="text-caption text-error">{error}</p>}
                    </div>

                    <div className="px-lg py-md border-t border-border flex gap-sm shrink-0">
                        <Button type="submit" isLoading={isSubmitting} className="flex-1">
                            {registroExistente ? t('vacaciones.action_guardar_cambios') : t('otrosIngresos.action_guardar')}
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
