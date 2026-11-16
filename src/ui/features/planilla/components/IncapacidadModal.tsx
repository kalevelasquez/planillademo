import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Info, AlertTriangle, HeartPulse, Paperclip, Trash2, Download, UploadCloud } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { useToast } from '../../../../context/ToastContext';
import { incapacidadesService, type Incapacidad } from '../../../../services/incapacidadesService';
import { calcularDiasIncapacidad, calcularCoberturaIncapacidad, PORCENTAJE_ISSS_INFORMATIVO, type TipoIncapacidad } from '../../../../utils/incapacidadesUtils';
import { fechaFueraDeQuincena } from '../../../../utils/quincenaUtils';
import {
    viaticoDocumentosService,
    type ViaticoDocumento,
} from '../../../../services/viaticoDocumentosService';
import type { Empleado } from '../../../../services/planillaEmpleadosService';
import { InputField } from '../../../components/InputField';
import { Button } from '../../../components/Button';
import { EmpleadoCombobox } from '../../../components/EmpleadoCombobox';
import { Logger } from '../../../../utils/logger';
import { leerPrimerosBytes, magicBytesCoinciden } from './ViaticoAdjuntosModal';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual'>;

const EXTENSIONES_VALIDAS = ['.pdf', '.jpg', '.jpeg', '.png'];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024; // 10MB, mismo límite del bucket

function formatearTamano(bytes: number | null): string {
    if (bytes === null) return '';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ErrorAdjuntosKey = 'viaticos.adjuntos_error_formato' | 'viaticos.adjuntos_error_tamano' | 'viaticos.adjuntos_error_contenido';

/** Mismas validaciones que `ViaticoAdjuntosModal`/`KilometrajeModal` (extensión + tamaño +
 * magic bytes). */
async function validarArchivo(file: File): Promise<ErrorAdjuntosKey | null> {
    const nombreLower = file.name.toLowerCase();
    if (!EXTENSIONES_VALIDAS.some((ext) => nombreLower.endsWith(ext))) return 'viaticos.adjuntos_error_formato';
    if (file.size > TAMANO_MAXIMO_BYTES) return 'viaticos.adjuntos_error_tamano';
    const primerosBytes = await leerPrimerosBytes(file, 4);
    if (!magicBytesCoinciden(primerosBytes, file.type)) return 'viaticos.adjuntos_error_contenido';
    return null;
}

interface FormState {
    numeroCit: string;
    fechaInicio: string;
    fechaFin: string;
    tipo: TipoIncapacidad;
    trabajoDuranteIncapacidad: boolean;
    montoBonoTrabajado: string;
}

const FORM_VACIO: FormState = {
    numeroCit: '', fechaInicio: '', fechaFin: '', tipo: 'enfermedad_comun',
    trabajoDuranteIncapacidad: false, montoBonoTrabajado: '',
};

interface IncapacidadModalProps {
    empleados: EmpleadoActivo[];
    quincenaId: string;
    quincenaFechaInicio?: string;
    quincenaFechaFin?: string;
    registroExistente: Incapacidad | null;
    onClose: () => void;
    onSaved: (registro: Incapacidad) => void;
}

/**
 * Modal/bottom-sheet para Registrar/Editar Certificado (US-INC-01) — fidelidad DEMO
 * (US-UX-02): mismo chrome de overlay que Nueva Quincena. Incluye los campos propios del real
 * que el DEMO no modela (trabajo_durante_incapacidad + monto_bono_trabajado, US-INC-0x) — se
 * preservan tal cual, solo cambia el contenedor.
 */
export const IncapacidadModal: React.FC<IncapacidadModalProps> = ({ empleados, quincenaId, quincenaFechaInicio, quincenaFechaFin, registroExistente, onClose, onSaved }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const inputRef = useRef<HTMLInputElement>(null);

    const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState<EmpleadoActivo | null>(
        registroExistente ? empleados.find((e) => e.id === registroExistente.empleado_id) ?? null : null
    );
    const [form, setForm] = useState<FormState>(registroExistente ? {
        numeroCit: registroExistente.numero_cit,
        fechaInicio: registroExistente.fecha_inicio,
        fechaFin: registroExistente.fecha_fin,
        tipo: registroExistente.tipo,
        trabajoDuranteIncapacidad: registroExistente.trabajo_durante_incapacidad,
        montoBonoTrabajado: registroExistente.monto_bono_trabajado !== null ? String(registroExistente.monto_bono_trabajado) : '',
    } : FORM_VACIO);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // ── Adjuntos (IMPL-130, Observación General UAT) ───────────────────
    const [documentos, setDocumentos] = useState<ViaticoDocumento[]>([]);
    const [pendientes, setPendientes] = useState<File[]>([]);
    const [isLoadingDoc, setIsLoadingDoc] = useState(!!registroExistente);
    const [isSubiendoDoc, setIsSubiendoDoc] = useState(false);
    const [eliminandoDocId, setEliminandoDocId] = useState<string | null>(null);
    const [errorDoc, setErrorDoc] = useState<string | null>(null);

    useEffect(() => {
        if (!registroExistente) return;
        let activo = true;
        setIsLoadingDoc(true);
        viaticoDocumentosService.getPorRegistro('incapacidad', registroExistente.id)
            .then((docs) => { if (activo) setDocumentos(docs); })
            .catch((err: unknown) => {
                Logger.error('Error al cargar adjuntos de incapacidad', { id: registroExistente.id }, err);
                if (activo) setErrorDoc(t('viaticos.adjuntos_error_ver'));
            })
            .finally(() => { if (activo) setIsLoadingDoc(false); });
        return () => { activo = false; };
    }, [registroExistente, t]);

    const handleSeleccionarArchivo = async (file: File | undefined) => {
        if (!file) return;
        const errorKey = await validarArchivo(file);
        if (errorKey) {
            setErrorDoc(t(errorKey));
            if (inputRef.current) inputRef.current.value = '';
            return;
        }
        setErrorDoc(null);
        if (registroExistente) {
            await subirDocumento(file);
        } else {
            setPendientes((prev) => [...prev, file]);
        }
        if (inputRef.current) inputRef.current.value = '';
    };

    const subirDocumento = async (file: File) => {
        if (!profile?.tenant_id || !profile.id || !registroExistente) return;
        setIsSubiendoDoc(true);
        try {
            const nuevo = await viaticoDocumentosService.subirDocumento(profile.tenant_id, 'incapacidad', registroExistente.id, file, profile.id);
            setDocumentos((prev) => [nuevo, ...prev]);
        } catch (err: unknown) {
            Logger.error('Error al subir adjunto de incapacidad', { id: registroExistente.id }, err);
            setErrorDoc(t('viaticos.adjuntos_error_subir'));
        } finally {
            setIsSubiendoDoc(false);
        }
    };

    const handleVer = async (doc: ViaticoDocumento) => {
        try {
            const url = await viaticoDocumentosService.getSignedUrl(doc.storage_path);
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (err: unknown) {
            Logger.error('Error al generar URL firmada de adjunto', { id: doc.id }, err);
            setErrorDoc(t('viaticos.adjuntos_error_ver'));
        }
    };

    const handleEliminarDoc = async (doc: ViaticoDocumento) => {
        setEliminandoDocId(doc.id);
        try {
            await viaticoDocumentosService.eliminarDocumento(doc.id, doc.storage_path);
            setDocumentos((prev) => prev.filter((d) => d.id !== doc.id));
        } catch (err: unknown) {
            Logger.error('Error al eliminar adjunto de incapacidad', { id: doc.id }, err);
            setErrorDoc(t('viaticos.adjuntos_error_eliminar'));
        } finally {
            setEliminandoDocId(null);
        }
    };

    const dias = form.fechaInicio && form.fechaFin && form.fechaFin >= form.fechaInicio
        ? calcularDiasIncapacidad(form.fechaInicio, form.fechaFin)
        : null;
    const cobertura = dias !== null ? calcularCoberturaIncapacidad(form.tipo, dias) : null;

    // IMPL-134 (Observación General UAT) — advertencia no bloqueante si la fecha de inicio cae
    // fuera del rango de la quincena que se está calculando.
    const fechaFueraRango = fechaFueraDeQuincena(form.fechaInicio, quincenaFechaInicio, quincenaFechaFin);

    const textoCoberturaPara = (tipo: TipoIncapacidad, conSubsidio: boolean): string => {
        if (tipo === 'accidente_trabajo') return t('incapacidades.cobertura_accidente_trabajo');
        if (tipo === 'maternidad') return t('incapacidades.cobertura_maternidad');
        return conSubsidio ? t('incapacidades.cobertura_enfermedad_con_subsidio') : t('incapacidades.cobertura_enfermedad_sin_subsidio');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.tenant_id || !profile.id || !quincenaId) return;
        if (!empleadoSeleccionado || !form.numeroCit.trim() || !form.fechaInicio || !form.fechaFin || dias === null || !cobertura) {
            setError(t('incapacidades.error_campos_requeridos'));
            return;
        }
        if (form.trabajoDuranteIncapacidad && !form.montoBonoTrabajado) {
            setError(t('incapacidades.error_monto_bono_requerido'));
            return;
        }

        const montoBono = form.trabajoDuranteIncapacidad ? Number(form.montoBonoTrabajado) : null;

        setError(null);
        setIsSubmitting(true);
        try {
            if (registroExistente) {
                const actualizado = await incapacidadesService.actualizar(registroExistente.id, {
                    empleado_id: empleadoSeleccionado.id,
                    numero_cit: form.numeroCit.trim(),
                    fecha_inicio: form.fechaInicio,
                    fecha_fin: form.fechaFin,
                    tipo: form.tipo,
                    dias,
                    con_subsidio: cobertura.conSubsidio,
                    dias_cubiertos_imporfrut: cobertura.diasCubiertosImporfrut,
                    dia_inicio_subsidio_isss: cobertura.diaInicioSubsidioIsss,
                    trabajo_durante_incapacidad: form.trabajoDuranteIncapacidad,
                    monto_bono_trabajado: montoBono,
                });
                onSaved(actualizado);
            } else {
                const creado = await incapacidadesService.crear({
                    tenant_id: profile.tenant_id,
                    quincena_id: quincenaId,
                    empleado_id: empleadoSeleccionado.id,
                    numero_cit: form.numeroCit.trim(),
                    fecha_inicio: form.fechaInicio,
                    fecha_fin: form.fechaFin,
                    tipo: form.tipo,
                    dias,
                    con_subsidio: cobertura.conSubsidio,
                    dias_cubiertos_imporfrut: cobertura.diasCubiertosImporfrut,
                    dia_inicio_subsidio_isss: cobertura.diaInicioSubsidioIsss,
                    trabajo_durante_incapacidad: form.trabajoDuranteIncapacidad,
                    monto_bono_trabajado: montoBono,
                    created_by: profile.id,
                });
                if (pendientes.length > 0) {
                    const resultados = await Promise.allSettled(
                        pendientes.map((f) => viaticoDocumentosService.subirDocumento(profile.tenant_id, 'incapacidad', creado.id, f, profile.id))
                    );
                    if (resultados.some((r) => r.status === 'rejected')) {
                        showToast(t('viaticos.adjuntos_error_subir'), 'error');
                    }
                }
                onSaved(creado);
            }
            onClose();
        } catch (err: unknown) {
            Logger.error('Error al guardar incapacidad', { editandoId: registroExistente?.id }, err);
            setError(err instanceof Error ? err.message : t('incapacidades.error_guardar'));
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
                            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                                <HeartPulse size={16} className="text-blue-600" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{registroExistente ? t('incapacidades.form_title_editar') : t('incapacidades.form_title')}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="overflow-y-auto p-lg flex flex-col gap-md">
                        <div className="flex flex-col gap-1 relative">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('incapacidades.field_empleado')} <span className="text-error">*</span></label>
                            <EmpleadoCombobox
                                empleados={empleados}
                                value={empleadoSeleccionado}
                                onChange={setEmpleadoSeleccionado}
                                placeholder={t('incapacidades.field_empleado_buscar_placeholder')}
                                noResultsLabel={t('incapacidades.field_empleado_sin_resultados')}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-md">
                            <InputField
                                label={t('incapacidades.field_numero_cit')}
                                value={form.numeroCit}
                                onChange={(e) => setForm((prev) => ({ ...prev, numeroCit: e.target.value }))}
                                required
                            />
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('incapacidades.field_tipo')} <span className="text-error">*</span></label>
                                <select
                                    value={form.tipo}
                                    onChange={(e) => setForm((prev) => ({ ...prev, tipo: e.target.value as TipoIncapacidad }))}
                                    className="rounded-md border border-border bg-white px-3 py-2 text-sm"
                                >
                                    <option value="enfermedad_comun">{t('incapacidades.tipo_enfermedad_comun')}</option>
                                    <option value="accidente_trabajo">{t('incapacidades.tipo_accidente_trabajo')}</option>
                                    <option value="maternidad">{t('incapacidades.tipo_maternidad')}</option>
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-md">
                            <InputField
                                label={t('incapacidades.field_fecha_inicio')}
                                type="date" mask="date"
                                value={form.fechaInicio}
                                onChange={(e) => setForm((prev) => ({ ...prev, fechaInicio: e.target.value }))}
                                required
                            />
                            <InputField
                                label={t('incapacidades.field_fecha_fin')}
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

                        {dias !== null && cobertura && (
                            <div className="flex flex-col gap-2 bg-primary-light/20 border border-primary/20 rounded-lg p-md">
                                <p className="text-caption font-semibold text-heading">{t('incapacidades.cobertura_title', { dias })}</p>
                                <p className="text-caption text-heading">{textoCoberturaPara(form.tipo, cobertura.conSubsidio)}</p>
                                {cobertura.conSubsidio && (
                                    <div className="flex items-start gap-2 text-[11px] text-text-secondary">
                                        <Info size={12} className="shrink-0 mt-0.5" />
                                        <p>{t('incapacidades.cobertura_isss_informativo', { porcentaje: PORCENTAJE_ISSS_INFORMATIVO })}</p>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex flex-col gap-2 pt-2 border-t border-border/40">
                            <label className="flex items-center gap-2 text-caption text-heading">
                                <input
                                    type="checkbox"
                                    checked={form.trabajoDuranteIncapacidad}
                                    onChange={(e) => setForm((prev) => ({ ...prev, trabajoDuranteIncapacidad: e.target.checked, montoBonoTrabajado: e.target.checked ? prev.montoBonoTrabajado : '' }))}
                                />
                                {t('incapacidades.field_trabajo_durante_incapacidad')}
                            </label>
                            {form.trabajoDuranteIncapacidad && (
                                <div className="flex flex-col gap-2">
                                    <InputField
                                        label={t('incapacidades.field_monto_bono_trabajado')}
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={form.montoBonoTrabajado}
                                        onChange={(e) => setForm((prev) => ({ ...prev, montoBonoTrabajado: e.target.value }))}
                                        className="w-40"
                                        required
                                    />
                                    <div className="flex items-start gap-2 text-[11px] text-text-secondary">
                                        <Info size={12} className="shrink-0 mt-0.5" />
                                        <p>{t('incapacidades.bono_trabajado_informativo')}</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* IMPL-130 (Observación General UAT) — adjuntos dentro del mismo modal,
                            mismo mecanismo multi-archivo de US-VIA-08 que KilometrajeModal. En
                            edición: lista de existentes + subir. En creación: archivos
                            pendientes que se suben al guardar el registro. */}
                        <div className="flex flex-col gap-2 border-t border-border/40 pt-md">
                            <div className="flex items-center gap-2">
                                <Paperclip size={14} className="text-primary" />
                                <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('viaticos.adjuntos_label')}</span>
                            </div>

                            {registroExistente ? (
                                isLoadingDoc ? (
                                    <div className="h-12 bg-surface rounded animate-pulse" />
                                ) : documentos.length === 0 ? (
                                    <p className="text-caption text-text-secondary italic">{t('viaticos.adjuntos_empty')}</p>
                                ) : (
                                    <ul className="flex flex-col gap-2">
                                        {documentos.map((doc) => (
                                            <li key={doc.id} className="flex items-center justify-between gap-3 text-sm border-b border-border/40 pb-2 last:border-b-0 last:pb-0">
                                                <div className="min-w-0">
                                                    <p className="font-medium text-heading truncate">{doc.nombre_archivo}</p>
                                                    <p className="text-[11px] text-text-secondary">{formatearTamano(doc.tamano_bytes)}</p>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button type="button" onClick={() => handleVer(doc)} className="p-1.5 text-text-secondary hover:text-primary transition-colors">
                                                        <Download size={14} />
                                                    </button>
                                                    <button type="button" onClick={() => handleEliminarDoc(doc)} disabled={eliminandoDocId === doc.id} className="p-1.5 text-text-secondary hover:text-error transition-colors disabled:opacity-50">
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )
                            ) : pendientes.length > 0 ? (
                                <ul className="flex flex-col gap-2">
                                    {pendientes.map((f, i) => (
                                        <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 text-sm border-b border-border/40 pb-2 last:border-b-0 last:pb-0">
                                            <p className="font-medium text-heading truncate">{f.name}</p>
                                            <button type="button" onClick={() => setPendientes((prev) => prev.filter((_, j) => j !== i))} className="p-1.5 text-text-secondary hover:text-error transition-colors shrink-0">
                                                <X size={14} />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}

                            <div
                                onClick={() => inputRef.current?.click()}
                                className="flex flex-col items-center justify-center gap-1 border-2 border-dashed border-border rounded-lg p-md text-center cursor-pointer hover:bg-surface/50 transition-colors"
                            >
                                <UploadCloud size={20} className="text-text-secondary/50" />
                                <p className="text-caption text-text-secondary">{t('viaticos.adjuntos_subir_hint')}</p>
                                <input
                                    ref={inputRef}
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png"
                                    className="hidden"
                                    onChange={(e) => handleSeleccionarArchivo(e.target.files?.[0])}
                                />
                            </div>

                            {isSubiendoDoc && <div className="h-8 bg-surface rounded animate-pulse" />}
                            {errorDoc && <p className="text-caption text-error">{errorDoc}</p>}
                        </div>

                        {error && <p className="text-caption text-error">{error}</p>}
                    </div>

                    <div className="px-lg py-md border-t border-border flex gap-sm shrink-0">
                        <Button type="submit" isLoading={isSubmitting} className="flex-1">
                            {registroExistente ? t('incapacidades.action_guardar_cambios') : t('incapacidades.action_guardar')}
                        </Button>
                        <button type="button" onClick={onClose} className="px-lg py-sm border border-border rounded-xl text-body text-text-secondary hover:bg-surface transition-colors">
                            {t('incapacidades.action_cancelar')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
