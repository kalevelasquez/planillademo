import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Wallet, AlertTriangle, Paperclip, Trash2, Download, UploadCloud } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { useToast } from '../../../../context/ToastContext';
import {
    viaticosFijosVariablesService,
    type ViaticoFijoVariable,
    type TipoViaticoFijoVariable,
} from '../../../../services/viaticosFijosVariablesService';
import {
    viaticoDocumentosService,
    type ViaticoDocumento,
} from '../../../../services/viaticoDocumentosService';
import { esConceptoLavadoGasolina, puedeAplicarLavadoGasolina, CONCEPTO_LAVADO_GASOLINA, CANTIDAD_LAVADOS_MINIMA } from '../../../../utils/viaticosUtils';
import type { Empleado } from '../../../../services/planillaEmpleadosService';
import { InputField } from '../../../components/InputField';
import { Button } from '../../../components/Button';
import { ConfirmModal } from '../../../components/ConfirmModal';
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

/** Mismas validaciones que `ViaticoAdjuntosModal`/`KilometrajeModal` (extensión + tamaño + magic bytes). */
async function validarArchivo(file: File): Promise<ErrorAdjuntosKey | null> {
    const nombreLower = file.name.toLowerCase();
    if (!EXTENSIONES_VALIDAS.some((ext) => nombreLower.endsWith(ext))) return 'viaticos.adjuntos_error_formato';
    if (file.size > TAMANO_MAXIMO_BYTES) return 'viaticos.adjuntos_error_tamano';
    const primerosBytes = await leerPrimerosBytes(file, 4);
    if (!magicBytesCoinciden(primerosBytes, file.type)) return 'viaticos.adjuntos_error_contenido';
    return null;
}

interface FormState {
    empleadoId: string;
    tipo: TipoViaticoFijoVariable;
    esLavadoGasolina: boolean;
    concepto: string;
    cantidadLavados: string;
    monto: string;
}

const FORM_VACIO: FormState = {
    empleadoId: '', tipo: 'fijo', esLavadoGasolina: false, concepto: '', cantidadLavados: '', monto: '',
};

interface FijosVariablesModalProps {
    empleados: EmpleadoActivo[];
    registros: ViaticoFijoVariable[];
    quincenaId: string;
    registroExistente: ViaticoFijoVariable | null;
    /** IMPL-36 CA4 — monto configurado en Configuración > Ingresos > Monto de Lavado y
     * Gasolina; null si el admin todavía no lo configuró. Solo precarga, sigue editable. */
    montoLavadoGasolinaSugerido: number | null;
    onClose: () => void;
    onSaved: (registro: ViaticoFijoVariable, esNuevo: boolean) => void;
}

/**
 * Modal de alta/edición de Viáticos Fijos y Variables (IMPL-129, Observación General UAT) —
 * reemplaza el formulario inline que empujaba la tabla hacia abajo, mismo chrome de
 * overlay/bottom-sheet que KilometrajeModal/VacacionModal/IncapacidadModal (US-UX-02).
 */
export const FijosVariablesModal: React.FC<FijosVariablesModalProps> = ({ empleados, registros, quincenaId, registroExistente, montoLavadoGasolinaSugerido, onClose, onSaved }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const inputRef = useRef<HTMLInputElement>(null);

    const [form, setForm] = useState<FormState>(registroExistente ? {
        empleadoId: registroExistente.empleado_id,
        tipo: registroExistente.tipo,
        esLavadoGasolina: esConceptoLavadoGasolina(registroExistente.concepto),
        concepto: registroExistente.concepto,
        cantidadLavados: registroExistente.cantidad_lavados !== null ? String(registroExistente.cantidad_lavados) : '',
        monto: String(registroExistente.monto),
    } : FORM_VACIO);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmMontoCero, setConfirmMontoCero] = useState(false);

    // ── Adjuntos, mismo mecanismo que KilometrajeModal (defecto UAT: la vía manual de
    // Fijos y Variables no dejaba adjuntar nada, a diferencia de Kilometraje). ──
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
        viaticoDocumentosService.getPorRegistro('fijos_variables', registroExistente.id)
            .then((docs) => { if (activo) setDocumentos(docs); })
            .catch((err: unknown) => {
                Logger.error('Error al cargar adjuntos de viático fijo/variable', { id: registroExistente.id }, err);
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
            const nuevo = await viaticoDocumentosService.subirDocumento(profile.tenant_id, 'fijos_variables', registroExistente.id, file, profile.id);
            setDocumentos((prev) => [nuevo, ...prev]);
        } catch (err: unknown) {
            Logger.error('Error al subir adjunto de viático fijo/variable', { id: registroExistente.id }, err);
            setErrorDoc(t('viaticos.adjuntos_error_subir'));
        } finally {
            setIsSubiendoDoc(false);
        }
    };

    const handleVerDoc = async (doc: ViaticoDocumento) => {
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
            Logger.error('Error al eliminar adjunto de viático fijo/variable', { id: doc.id }, err);
            setErrorDoc(t('viaticos.adjuntos_error_eliminar'));
        } finally {
            setEliminandoDocId(null);
        }
    };

    // US-VIA-05 — hallazgo QA menor: sin detección de gastos duplicados. Heurística no
    // bloqueante: mismo empleado + mismo concepto + mismo monto ya presente en la quincena.
    const posibleDuplicado = useMemo(() => {
        if (!form.empleadoId || !form.concepto.trim() || !form.monto) return false;
        const montoNum = Number(form.monto);
        const conceptoNorm = form.concepto.trim().toLowerCase();
        return registros.some((r) =>
            r.id !== registroExistente?.id &&
            r.empleado_id === form.empleadoId &&
            r.concepto.trim().toLowerCase() === conceptoNorm &&
            r.monto === montoNum
        );
    }, [form.empleadoId, form.concepto, form.monto, registros, registroExistente]);

    const handleToggleLavadoGasolina = (checked: boolean) => {
        setForm((prev) => ({
            ...prev,
            esLavadoGasolina: checked,
            concepto: checked ? CONCEPTO_LAVADO_GASOLINA : (prev.concepto === CONCEPTO_LAVADO_GASOLINA ? '' : prev.concepto),
            cantidadLavados: checked ? prev.cantidadLavados : '',
            // CA4 (IMPL-36) — precarga el monto configurado, sigue editable para casos
            // puntuales (mismo criterio que la Tarifa por KM de US-VIA-06).
            monto: checked && montoLavadoGasolinaSugerido !== null ? String(montoLavadoGasolinaSugerido) : prev.monto,
        }));
    };

    /** Guardado real, separado de `handleSubmit` para poder dispararse tanto directo como tras
     * confirmar el aviso de monto $0 (US-VIA-05 — hallazgo QA menor). */
    const guardar = async () => {
        if (!profile?.tenant_id || !profile.id || !quincenaId) return;
        const cantidadLavados = form.esLavadoGasolina ? Number(form.cantidadLavados) || 0 : null;

        setError(null);
        setIsSubmitting(true);
        try {
            if (registroExistente) {
                const actualizado = await viaticosFijosVariablesService.actualizar(registroExistente.id, {
                    empleado_id: form.empleadoId,
                    tipo: form.tipo,
                    concepto: form.concepto.trim(),
                    cantidad_lavados: cantidadLavados,
                    monto: Number(form.monto),
                });
                onSaved(actualizado, false);
            } else {
                const creado = await viaticosFijosVariablesService.crear({
                    tenant_id: profile.tenant_id,
                    quincena_id: quincenaId,
                    empleado_id: form.empleadoId,
                    tipo: form.tipo,
                    concepto: form.concepto.trim(),
                    cantidad_lavados: cantidadLavados,
                    monto: Number(form.monto),
                    created_by: profile.id,
                });
                if (pendientes.length > 0) {
                    const resultados = await Promise.allSettled(
                        pendientes.map((f) => viaticoDocumentosService.subirDocumento(profile.tenant_id, 'fijos_variables', creado.id, f, profile.id))
                    );
                    if (resultados.some((r) => r.status === 'rejected')) {
                        showToast(t('viaticos.adjuntos_error_subir'), 'error');
                    }
                }
                onSaved(creado, true);
            }
            onClose();
        } catch (err: unknown) {
            Logger.error('Error al guardar viático fijo/variable', { editandoId: registroExistente?.id }, err);
            setError(t('viaticos.error_guardar'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.tenant_id || !profile.id || !quincenaId) return;
        if (!form.empleadoId || !form.concepto.trim() || !form.monto) {
            setError(t('viaticos.error_campos_requeridos'));
            return;
        }

        const cantidadLavados = form.esLavadoGasolina ? Number(form.cantidadLavados) || 0 : null;
        if (form.esLavadoGasolina && !puedeAplicarLavadoGasolina(cantidadLavados)) {
            setError(t('viaticos.error_lavado_gasolina_minimo', { minimo: CANTIDAD_LAVADOS_MINIMA }));
            return;
        }

        // US-VIA-05 — hallazgo QA menor: monto $0 se guardaba sin confirmación.
        if (Number(form.monto) === 0) {
            setConfirmMontoCero(true);
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
                                <Wallet size={16} className="text-primary" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{registroExistente ? t('viaticos.form_title_fijos_variables_editar') : t('viaticos.form_title_fijos_variables')}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="overflow-y-auto p-lg flex flex-col gap-md">
                        <div className="flex flex-col sm:flex-row gap-2">
                            <div className="flex flex-col gap-1 flex-1 min-w-0">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('viaticos.field_empleado')} <span className="text-error">*</span></label>
                                <select
                                    value={form.empleadoId}
                                    onChange={(e) => setForm((prev) => ({ ...prev, empleadoId: e.target.value }))}
                                    className="w-full min-w-0 rounded-md border border-border bg-white px-3 py-2 text-sm"
                                >
                                    <option value="">{t('viaticos.field_empleado_placeholder')}</option>
                                    {empleados.map((emp) => (
                                        <option key={emp.id} value={emp.id}>{emp.nombre_completo}{emp.cargo ? ` — ${emp.cargo}` : ''}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex flex-col gap-1 shrink-0">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('viaticos.field_tipo')}</label>
                                <div className="inline-flex bg-surface border border-border rounded-lg p-0.5 gap-0.5">
                                    {(['fijo', 'variable'] as const).map((opcion) => (
                                        <button
                                            key={opcion}
                                            type="button"
                                            onClick={() => setForm((prev) => ({ ...prev, tipo: opcion }))}
                                            className={`px-sm py-xs rounded-md text-[12px] font-semibold transition-colors ${form.tipo === opcion ? 'bg-white text-primary shadow-sm border border-border/50' : 'text-text-secondary hover:text-heading'}`}
                                        >
                                            {opcion === 'fijo' ? t('viaticos.tipo_fijo') : t('viaticos.tipo_variable')}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <label className="flex items-center gap-2 text-caption text-heading">
                            <input type="checkbox" checked={form.esLavadoGasolina} onChange={(e) => handleToggleLavadoGasolina(e.target.checked)} />
                            {t('viaticos.checkbox_lavado_gasolina', { minimo: CANTIDAD_LAVADOS_MINIMA })}
                        </label>

                        <div className="flex flex-col sm:flex-row gap-2">
                            <InputField
                                label={t('viaticos.field_concepto')}
                                value={form.concepto}
                                onChange={(e) => setForm((prev) => ({ ...prev, concepto: e.target.value }))}
                                disabled={form.esLavadoGasolina}
                                className="flex-1"
                                required={!form.esLavadoGasolina}
                            />
                            {form.esLavadoGasolina && (
                                <InputField
                                    label={t('viaticos.field_cantidad_lavados')}
                                    type="number"
                                    min={0}
                                    value={form.cantidadLavados}
                                    onChange={(e) => setForm((prev) => ({ ...prev, cantidadLavados: e.target.value }))}
                                    className="w-40"
                                    required
                                />
                            )}
                            <InputField
                                label={t('viaticos.field_monto')}
                                type="number"
                                min={0}
                                step="0.01"
                                value={form.monto}
                                onChange={(e) => setForm((prev) => ({ ...prev, monto: e.target.value }))}
                                className="w-40"
                                required
                            />
                        </div>

                        {posibleDuplicado && (
                            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-md">
                                <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                                <p className="text-caption text-heading">{t('viaticos.advertencia_posible_duplicado')}</p>
                            </div>
                        )}

                        {/* Adjuntos: mismo mecanismo multi-archivo de US-VIA-08. En edición: lista
                            de existentes + subir. En creación: archivos pendientes que se suben al
                            guardar el registro. */}
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
                                                    <button type="button" onClick={() => handleVerDoc(doc)} className="p-1.5 text-text-secondary hover:text-primary transition-colors">
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
                            {registroExistente ? t('viaticos.action_guardar_cambios') : t('viaticos.action_agregar')}
                        </Button>
                        <button type="button" onClick={onClose} className="px-lg py-sm border border-border rounded-xl text-body text-text-secondary hover:bg-surface transition-colors">
                            {t('viaticos.action_cancelar')}
                        </button>
                    </div>
                </form>
            </div>

            <ConfirmModal
                isOpen={confirmMontoCero}
                onClose={() => setConfirmMontoCero(false)}
                onConfirm={() => { setConfirmMontoCero(false); void guardar(); }}
                title={t('viaticos.confirm_monto_cero_title')}
                message={t('viaticos.confirm_monto_cero_message')}
                confirmLabel={t('viaticos.confirm_monto_cero_action')}
                cancelLabel={t('viaticos.action_cancelar')}
                variant="warning"
            />
        </div>
    );
};
