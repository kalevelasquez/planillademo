import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Trash2, AlertTriangle, CalendarOff } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { permisosService, type Permiso, type GranularidadPermiso, type TurnoPermiso, type TipoPermiso } from '../../../../services/permisosService';
import { fechaFueraDeQuincena } from '../../../../utils/quincenaUtils';
import type { Empleado } from '../../../../services/planillaEmpleadosService';
import { InputField } from '../../../components/InputField';
import { Button } from '../../../components/Button';
import { EmpleadoCombobox } from '../../../components/EmpleadoCombobox';
import { Logger } from '../../../../utils/logger';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual'>;

interface DiaPermiso {
    fecha: string;
    granularidad: GranularidadPermiso;
    turno: TurnoPermiso | '';
    horas: string;
}

const DIA_VACIO: DiaPermiso = { fecha: '', granularidad: 'dia_completo', turno: '', horas: '' };

interface PermisoModalProps {
    empleados: EmpleadoActivo[];
    quincenaId: string;
    quincenaFechaInicio?: string;
    quincenaFechaFin?: string;
    /** Al editar, el modal opera sobre UNA sola fila — cada día de un trámite se
     * edita/elimina independientemente, mismo criterio que Incapacidades con sus rangos. */
    registroExistente: Permiso | null;
    onClose: () => void;
    onSaved: (registros: Permiso[]) => void;
}

/**
 * Registrar/Editar Permiso (US-PER-01). Al crear, permite agregar varios días con
 * granularidad distinta en un mismo trámite (CA2 — ej. "la tarde de hoy" + "todo el día de
 * mañana"), todos comparten empleado/tipo/motivo y un mismo `grupo_id` generado en el cliente.
 * Al editar, opera sobre un solo día (una sola fila).
 */
export const PermisoModal: React.FC<PermisoModalProps> = ({ empleados, quincenaId, quincenaFechaInicio, quincenaFechaFin, registroExistente, onClose, onSaved }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();

    const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState<EmpleadoActivo | null>(
        registroExistente ? empleados.find((e) => e.id === registroExistente.empleado_id) ?? null : null
    );
    const [tipo, setTipo] = useState<TipoPermiso>(registroExistente?.tipo ?? 'con_goce');
    const [motivo, setMotivo] = useState(registroExistente?.motivo ?? '');
    const [dias, setDias] = useState<DiaPermiso[]>(
        registroExistente
            ? [{
                fecha: registroExistente.fecha,
                granularidad: registroExistente.granularidad,
                turno: registroExistente.turno ?? '',
                horas: registroExistente.horas !== null ? String(registroExistente.horas) : '',
            }]
            : [{ ...DIA_VACIO }]
    );
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const actualizarDia = (index: number, cambios: Partial<DiaPermiso>) => {
        setDias((prev) => prev.map((d, i) => (i === index ? { ...d, ...cambios } : d)));
    };

    const agregarDia = () => setDias((prev) => [...prev, { ...DIA_VACIO }]);
    const quitarDia = (index: number) => setDias((prev) => prev.filter((_, i) => i !== index));

    const diaValido = (d: DiaPermiso): boolean => {
        if (!d.fecha) return false;
        if (d.granularidad === 'medio_dia') return d.turno !== '';
        if (d.granularidad === 'horas') return d.horas !== '' && Number(d.horas) > 0 && Number(d.horas) <= 24;
        return true;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.tenant_id || !profile.id || !quincenaId || !empleadoSeleccionado) {
            setError(t('permisos.error_campos_requeridos'));
            return;
        }
        if (!motivo.trim() || dias.length === 0 || !dias.every(diaValido)) {
            setError(t('permisos.error_campos_requeridos'));
            return;
        }

        setError(null);
        setIsSubmitting(true);
        try {
            if (registroExistente) {
                const d = dias[0];
                const actualizado = await permisosService.actualizar(registroExistente.id, {
                    empleado_id: empleadoSeleccionado.id,
                    fecha: d.fecha,
                    granularidad: d.granularidad,
                    turno: d.granularidad === 'medio_dia' ? (d.turno as TurnoPermiso) : null,
                    horas: d.granularidad === 'horas' ? Number(d.horas) : null,
                    tipo,
                    motivo: motivo.trim(),
                });
                onSaved([actualizado]);
            } else {
                const grupoId = crypto.randomUUID();
                const payloads = dias.map((d) => ({
                    tenant_id: profile.tenant_id,
                    quincena_id: quincenaId,
                    empleado_id: empleadoSeleccionado.id,
                    grupo_id: grupoId,
                    fecha: d.fecha,
                    granularidad: d.granularidad,
                    turno: d.granularidad === 'medio_dia' ? (d.turno as TurnoPermiso) : null,
                    horas: d.granularidad === 'horas' ? Number(d.horas) : null,
                    tipo,
                    motivo: motivo.trim(),
                    created_by: profile.id,
                }));
                const creados = await permisosService.crearVarios(payloads);
                onSaved(creados);
            }
            onClose();
        } catch (err: unknown) {
            Logger.error('Error al guardar permiso', { editandoId: registroExistente?.id }, err);
            setError(err instanceof Error ? err.message : t('permisos.error_guardar'));
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
                    className="pointer-events-auto w-full sm:max-w-[560px] bg-white rounded-t-2xl sm:rounded-2xl shadow-modals flex flex-col max-h-[92dvh] overflow-hidden animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-300"
                >
                    <div className="sm:hidden flex justify-center pt-sm pb-0 shrink-0">
                        <div className="w-10 h-1 rounded-full bg-border" />
                    </div>

                    <div className="flex items-center justify-between px-lg py-md border-b border-border shrink-0">
                        <div className="flex items-center gap-sm">
                            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                                <CalendarOff size={16} className="text-blue-600" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{registroExistente ? t('permisos.form_title_editar') : t('permisos.form_title')}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="overflow-y-auto p-lg flex flex-col gap-md">
                        <div className="flex flex-col gap-1 relative">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('permisos.field_empleado')} <span className="text-error">*</span></label>
                            <EmpleadoCombobox
                                empleados={empleados}
                                value={empleadoSeleccionado}
                                onChange={setEmpleadoSeleccionado}
                                placeholder={t('permisos.field_empleado_buscar_placeholder')}
                                noResultsLabel={t('permisos.field_empleado_sin_resultados')}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('permisos.field_tipo')} <span className="text-error">*</span></label>
                            <select
                                value={tipo}
                                onChange={(e) => setTipo(e.target.value as TipoPermiso)}
                                className="rounded-md border border-border bg-white px-3 py-2 text-sm"
                            >
                                <option value="con_goce">{t('permisos.tipo_con_goce')}</option>
                                <option value="sin_goce">{t('permisos.tipo_sin_goce')}</option>
                            </select>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('permisos.field_motivo')} <span className="text-error">*</span></label>
                            <textarea
                                value={motivo}
                                onChange={(e) => setMotivo(e.target.value)}
                                rows={2}
                                className="rounded-md border border-border bg-white px-3 py-2 text-sm resize-none"
                                required
                            />
                        </div>

                        <div className="flex flex-col gap-sm pt-2 border-t border-border/40">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('permisos.field_dias')}</p>
                            {dias.map((d, index) => {
                                const fechaFueraRango = fechaFueraDeQuincena(d.fecha, quincenaFechaInicio, quincenaFechaFin);
                                return (
                                    <div key={index} className="flex flex-col gap-2 bg-surface/50 rounded-lg p-md border border-border/60">
                                        <div className="flex items-start gap-2">
                                            <InputField
                                                label={t('permisos.field_fecha')}
                                                type="date" mask="date"
                                                value={d.fecha}
                                                onChange={(e) => actualizarDia(index, { fecha: e.target.value })}
                                                required
                                                className="flex-1"
                                            />
                                            <div className="flex flex-col gap-1 flex-1">
                                                <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('permisos.field_granularidad')}</label>
                                                <select
                                                    value={d.granularidad}
                                                    onChange={(e) => actualizarDia(index, { granularidad: e.target.value as GranularidadPermiso, turno: '', horas: '' })}
                                                    className="rounded-md border border-border bg-white px-3 py-2 text-sm"
                                                >
                                                    <option value="dia_completo">{t('permisos.granularidad_dia_completo')}</option>
                                                    <option value="medio_dia">{t('permisos.granularidad_medio_dia')}</option>
                                                    <option value="horas">{t('permisos.granularidad_horas')}</option>
                                                </select>
                                            </div>
                                            {dias.length > 1 && (
                                                <button type="button" onClick={() => quitarDia(index)} className="p-2 mt-5 text-text-secondary hover:text-error transition-colors shrink-0">
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>

                                        {d.granularidad === 'medio_dia' && (
                                            <div className="flex flex-col gap-1">
                                                <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('permisos.field_turno')} <span className="text-error">*</span></label>
                                                <select
                                                    value={d.turno}
                                                    onChange={(e) => actualizarDia(index, { turno: e.target.value as TurnoPermiso })}
                                                    className="rounded-md border border-border bg-white px-3 py-2 text-sm"
                                                >
                                                    <option value="">{t('permisos.field_turno_placeholder')}</option>
                                                    <option value="manana">{t('permisos.turno_manana')}</option>
                                                    <option value="tarde">{t('permisos.turno_tarde')}</option>
                                                </select>
                                            </div>
                                        )}

                                        {d.granularidad === 'horas' && (
                                            <InputField
                                                label={t('permisos.field_horas')}
                                                type="number"
                                                min={0.5}
                                                max={24}
                                                step="0.5"
                                                value={d.horas}
                                                onChange={(e) => actualizarDia(index, { horas: e.target.value })}
                                                className="w-40"
                                                required
                                            />
                                        )}

                                        {fechaFueraRango && (
                                            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-md">
                                                <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                                                <p className="text-caption text-heading">{t('common.advertencia_fecha_fuera_quincena')}</p>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {!registroExistente && (
                                <button
                                    type="button"
                                    onClick={agregarDia}
                                    className="flex items-center justify-center gap-xs px-md py-2 text-caption font-semibold text-primary hover:bg-primary-light/40 rounded-lg transition-colors"
                                >
                                    <Plus size={14} /> {t('permisos.action_agregar_dia')}
                                </button>
                            )}
                        </div>

                        {error && <p className="text-caption text-error">{error}</p>}
                    </div>

                    <div className="px-lg py-md border-t border-border flex gap-sm shrink-0">
                        <Button type="submit" isLoading={isSubmitting} className="flex-1">
                            {registroExistente ? t('permisos.action_guardar_cambios') : t('permisos.action_guardar')}
                        </Button>
                        <button type="button" onClick={onClose} className="px-lg py-sm border border-border rounded-xl text-body text-text-secondary hover:bg-surface transition-colors">
                            {t('permisos.action_cancelar')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
