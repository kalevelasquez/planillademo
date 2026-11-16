import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Milestone, AlertTriangle, Paperclip, Trash2, Download, UploadCloud } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { useToast } from '../../../../context/ToastContext';
import { viaticosKilometrajeService, type ViaticoKilometraje } from '../../../../services/viaticosKilometrajeService';
import {
    viaticoDocumentosService,
    type ViaticoDocumento,
} from '../../../../services/viaticoDocumentosService';
import { round2 } from '../../../../utils/calculoPlanillaUtils';
import { fechaFueraDeQuincena } from '../../../../utils/quincenaUtils';
import type { Empleado } from '../../../../services/planillaEmpleadosService';
import { InputField } from '../../../components/InputField';
import { Button } from '../../../components/Button';
import { ConfirmModal } from '../../../components/ConfirmModal';
import { Logger } from '../../../../utils/logger';
import { leerPrimerosBytes, magicBytesCoinciden } from './ViaticoAdjuntosModal';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual'>;

const FORM_VACIO = { fecha: '', km: '', tarifaKm: '' };

const EXTENSIONES_VALIDAS = ['.pdf', '.jpg', '.jpeg', '.png'];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024; // 10MB, mismo límite del bucket

interface KilometrajeModalProps {
    empleados: EmpleadoActivo[];
    tarifasPorCargo: Map<string, number>;
    registros: ViaticoKilometraje[];
    quincenaId: string;
    quincenaFechaInicio?: string;
    quincenaFechaFin?: string;
    registroExistente: ViaticoKilometraje | null;
    onClose: () => void;
    onSaved: (registro: ViaticoKilometraje, esNuevo: boolean) => void;
}

function formatearTamano(bytes: number | null): string {
    if (bytes === null) return '';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ErrorAdjuntosKey = 'viaticos.adjuntos_error_formato' | 'viaticos.adjuntos_error_tamano' | 'viaticos.adjuntos_error_contenido';

/** Mismas validaciones que `ViaticoAdjuntosModal` (extensión + tamaño + magic bytes). */
async function validarArchivo(file: File): Promise<ErrorAdjuntosKey | null> {
    const nombreLower = file.name.toLowerCase();
    if (!EXTENSIONES_VALIDAS.some((ext) => nombreLower.endsWith(ext))) return 'viaticos.adjuntos_error_formato';
    if (file.size > TAMANO_MAXIMO_BYTES) return 'viaticos.adjuntos_error_tamano';
    const primerosBytes = await leerPrimerosBytes(file, 4);
    if (!magicBytesCoinciden(primerosBytes, file.type)) return 'viaticos.adjuntos_error_contenido';
    return null;
}

/**
 * Modal "Agregar registro de km" (US-VIA-06 CA2) — el CA2 exige modal explícitamente
 * ("Modal 'Agregar registro de km'..."), defecto UAT: se había implementado como formulario
 * inline. Mismo chrome de overlay/bottom-sheet que VacacionModal/IncapacidadModal/
 * AnticipoModal (US-UX-02). La tarifa por KM se precarga según el cargo del empleado
 * seleccionado (editable puntualmente); el monto se calcula automáticamente (KM × tarifa) y
 * no es editable a mano. El alta y la edición comparten este mismo modal (mismo patrón de
 * formulario unificado que el resto de la épica).
 *
 * Adjuntos (CA3, defecto UAT): el formulario permite adjuntar archivos con el MISMO mecanismo
 * multi-archivo de US-VIA-08 (IMPL-39, `viaticoDocumentosService`). En edición se muestran los
 * adjuntos existentes del registro (ver/eliminar/agregar); en creación los archivos se
 * seleccionan antes de guardar y se suben después de crear el registro (los metadatos apuntan
 * a un `registro_id` que todavía no existe hasta el INSERT).
 */
export const KilometrajeModal: React.FC<KilometrajeModalProps> = ({
    empleados,
    tarifasPorCargo,
    registros,
    quincenaId,
    quincenaFechaInicio,
    quincenaFechaFin,
    registroExistente,
    onClose,
    onSaved,
}) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const inputRef = useRef<HTMLInputElement>(null);

    const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState<EmpleadoActivo | null>(
        registroExistente ? empleados.find((e) => e.id === registroExistente.empleado_id) ?? null : null
    );
    const [form, setForm] = useState(registroExistente ? {
        fecha: registroExistente.fecha,
        km: String(registroExistente.km_recorridos),
        tarifaKm: String(registroExistente.tarifa_km),
    } : FORM_VACIO);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmKmCero, setConfirmKmCero] = useState(false);

    // ── Adjuntos (CA3) ──────────────────────────────────────────────
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
        viaticoDocumentosService.getPorRegistro('kilometraje', registroExistente.id)
            .then((docs) => { if (activo) setDocumentos(docs); })
            .catch((err: unknown) => {
                Logger.error('Error al cargar adjuntos de kilometraje', { id: registroExistente.id }, err);
                if (activo) setErrorDoc(t('viaticos.adjuntos_error_ver'));
            })
            .finally(() => { if (activo) setIsLoadingDoc(false); });
        return () => { activo = false; };
    }, [registroExistente, t]);

    const montoCalculado = useMemo(() => {
        const km = Number(form.km) || 0;
        const tarifa = Number(form.tarifaKm) || 0;
        return km * tarifa;
    }, [form.km, form.tarifaKm]);

    // US-VIA-06 — hallazgo QA menor: sin detección de gastos duplicados. Heurística no
    // bloqueante (solo advierte, nunca impide guardar): mismo empleado + misma fecha ya
    // registrados en la quincena.
    const posibleDuplicado = useMemo(() => {
        if (!empleadoSeleccionado || !form.fecha) return false;
        return registros.some((r) =>
            r.id !== registroExistente?.id &&
            r.empleado_id === empleadoSeleccionado.id &&
            r.fecha === form.fecha
        );
    }, [empleadoSeleccionado, form.fecha, registros, registroExistente]);

    // IMPL-134 (Observación General UAT) — advertencia no bloqueante si la fecha cae fuera del
    // rango de la quincena que se está calculando.
    const fechaFueraRango = fechaFueraDeQuincena(form.fecha, quincenaFechaInicio, quincenaFechaFin);

    const handleSeleccionarEmpleado = (emp: EmpleadoActivo | null) => {
        setEmpleadoSeleccionado(emp);
        const tarifaSugerida = emp?.cargo ? tarifasPorCargo.get(emp.cargo) : undefined;
        if (tarifaSugerida !== undefined) {
            setForm((prev) => ({ ...prev, tarifaKm: String(tarifaSugerida) }));
        }
    };

    // ── Adjuntos: subir (edición) / acumular pendientes (creación) ──
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
            const nuevo = await viaticoDocumentosService.subirDocumento(profile.tenant_id, 'kilometraje', registroExistente.id, file, profile.id);
            setDocumentos((prev) => [nuevo, ...prev]);
        } catch (err: unknown) {
            Logger.error('Error al subir adjunto de kilometraje', { id: registroExistente.id }, err);
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
            Logger.error('Error al eliminar adjunto de kilometraje', { id: doc.id }, err);
            setErrorDoc(t('viaticos.adjuntos_error_eliminar'));
        } finally {
            setEliminandoDocId(null);
        }
    };

    /** Guardado real, separado de `handleSubmit` para poder dispararse tanto directo como tras
     * confirmar el aviso de 0 KM (US-VIA-06 — hallazgo QA menor). El monto se redondea a 2
     * decimales acá (mismo `round2` que usa `calculoPlanillaUtils`) para no persistir el ruido
     * de punto flotante de `km * tarifa` (ej. 12.300000000000001). En creación, los archivos
     * pendientes se suben después del INSERT (los metadatos referencian el `registro_id` nuevo). */
    const guardar = async () => {
        if (!profile?.tenant_id || !profile.id || !quincenaId || !empleadoSeleccionado) return;
        const montoRedondeado = round2(montoCalculado);

        setError(null);
        setIsSubmitting(true);
        try {
            if (registroExistente) {
                const actualizado = await viaticosKilometrajeService.actualizar(registroExistente.id, {
                    empleado_id: empleadoSeleccionado.id,
                    fecha: form.fecha,
                    km_recorridos: Number(form.km),
                    tarifa_km: Number(form.tarifaKm),
                    monto: montoRedondeado,
                });
                onSaved(actualizado, false);
            } else {
                const creado = await viaticosKilometrajeService.crear({
                    tenant_id: profile.tenant_id,
                    quincena_id: quincenaId,
                    empleado_id: empleadoSeleccionado.id,
                    fecha: form.fecha,
                    km_recorridos: Number(form.km),
                    tarifa_km: Number(form.tarifaKm),
                    monto: montoRedondeado,
                    created_by: profile.id,
                });
                if (pendientes.length > 0) {
                    const resultados = await Promise.allSettled(
                        pendientes.map((f) => viaticoDocumentosService.subirDocumento(profile.tenant_id, 'kilometraje', creado.id, f, profile.id))
                    );
                    if (resultados.some((r) => r.status === 'rejected')) {
                        showToast(t('viaticos.adjuntos_error_subir'), 'error');
                    }
                }
                onSaved(creado, true);
            }
            onClose();
        } catch (err: unknown) {
            Logger.error('Error al guardar viático por kilometraje', { editandoId: registroExistente?.id }, err);
            setError(t('viaticos.error_guardar'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.tenant_id || !profile.id || !quincenaId) return;
        if (!empleadoSeleccionado || !form.fecha || !form.km || !form.tarifaKm) {
            setError(t('viaticos.error_campos_requeridos'));
            return;
        }

        // US-VIA-06 — hallazgo QA menor: 0 KM se guardaba sin confirmación. No bloquea, solo
        // exige un segundo click explícito antes de persistir.
        if (Number(form.km) === 0) {
            setConfirmKmCero(true);
            return;
        }

        await guardar();
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
                                <Milestone size={16} className="text-primary" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{registroExistente ? t('viaticos.form_title_kilometraje_editar') : t('viaticos.form_title_kilometraje')}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="overflow-y-auto p-lg flex flex-col gap-md">
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('viaticos.field_empleado')} <span className="text-error">*</span></label>
                            <select
                                value={empleadoSeleccionado?.id ?? ''}
                                onChange={(e) => handleSeleccionarEmpleado(empleados.find((emp) => emp.id === e.target.value) ?? null)}
                                className="rounded-md border border-border bg-white px-3 py-2 text-sm"
                            >
                                <option value="">{t('viaticos.field_empleado_placeholder')}</option>
                                {empleados.map((emp) => (
                                    <option key={emp.id} value={emp.id}>{emp.nombre_completo}{emp.cargo ? ` — ${emp.cargo}` : ''}</option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-md">
                            <InputField
                                label={t('viaticos.field_fecha')}
                                type="date" mask="date"
                                value={form.fecha}
                                onChange={(e) => setForm((prev) => ({ ...prev, fecha: e.target.value }))}
                                required
                            />
                            <InputField
                                label={t('viaticos.field_km')}
                                type="number"
                                min={0}
                                step="0.1"
                                value={form.km}
                                onChange={(e) => setForm((prev) => ({ ...prev, km: e.target.value }))}
                                required
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <InputField
                                label={t('viaticos.field_tarifa_km')}
                                type="number"
                                min={0}
                                step="0.01"
                                value={form.tarifaKm}
                                onChange={(e) => setForm((prev) => ({ ...prev, tarifaKm: e.target.value }))}
                                required
                            />
                            <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('viaticos.col_monto')}</span>
                                <span className="font-semibold text-heading">${montoCalculado.toFixed(2)}</span>
                            </div>
                        </div>

                        {posibleDuplicado && (
                            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-md">
                                <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                                <p className="text-caption text-heading">{t('viaticos.advertencia_posible_duplicado')}</p>
                            </div>
                        )}

                        {fechaFueraRango && (
                            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-md">
                                <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                                <p className="text-caption text-heading">{t('common.advertencia_fecha_fuera_quincena')}</p>
                            </div>
                        )}

                        {/* CA3 (defecto UAT) — adjuntos dentro del formulario, mismo mecanismo
                            multi-archivo de US-VIA-08. En edición: lista de existentes + subir. En
                            creación: archivos pendientes que se suben al guardar el registro. */}
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
                                                    <p className="text-[11px] text-text-secondary">
                                                        {formatearTamano(doc.tamano_bytes)}
                                                        {doc.origen === 'captura_ia' && ` · ${t('viaticos.badge_origen_ia')}`}
                                                    </p>
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
                            {registroExistente ? t('viaticos.action_guardar_cambios') : t('viaticos.action_guardar_viatico')}
                        </Button>
                        <button type="button" onClick={onClose} className="px-lg py-sm border border-border rounded-xl text-body text-text-secondary hover:bg-surface transition-colors">
                            {t('viaticos.action_cancelar')}
                        </button>
                    </div>
                </form>
            </div>

            <ConfirmModal
                isOpen={confirmKmCero}
                onClose={() => setConfirmKmCero(false)}
                onConfirm={() => { setConfirmKmCero(false); void guardar(); }}
                title={t('viaticos.confirm_km_cero_title')}
                message={t('viaticos.confirm_km_cero_message')}
                confirmLabel={t('viaticos.confirm_km_cero_action')}
                cancelLabel={t('viaticos.action_cancelar')}
                variant="warning"
            />
        </div>
    );
};
