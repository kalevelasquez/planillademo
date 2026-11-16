import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, MapPin, AlertTriangle, Camera, Sparkles, Image as ImageIcon, Paperclip, Trash2, Download, UploadCloud } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { useToast } from '../../../../context/ToastContext';
import { viaticosPorRutaService, type ViaticoPorRuta } from '../../../../services/viaticosPorRutaService';
import { viaticoIaService, type ExtraccionViaticoIA } from '../../../../services/viaticoIaService';
import { viaticoDocumentosService, type ViaticoDocumento } from '../../../../services/viaticoDocumentosService';
import { Logger } from '../../../../utils/logger';
import { buscarEmpleadoPorNombre } from '../../../../utils/fuzzyMatchUtils';
import { getCodigoEmpleado } from '../../../../utils/empleadoCodigoUtils';
import { fechaFueraDeQuincena } from '../../../../utils/quincenaUtils';
import type { Empleado } from '../../../../services/planillaEmpleadosService';
import { InputField } from '../../../components/InputField';
import { Button } from '../../../components/Button';
import { EmpleadoCombobox } from '../../../components/EmpleadoCombobox';
import { leerPrimerosBytes, magicBytesCoinciden } from './ViaticoAdjuntosModal';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual'>;

type EstadoIA = 'idle' | 'cargando' | 'extraido' | 'error' | 'manual';

const FORM_VACIO = { fecha: '', cargoMotivo: '', destino: '', monto: '' };
const EXTENSIONES_VALIDAS_IA = ['.jpg', '.jpeg', '.png', '.pdf'];
const TAMANO_MAXIMO_IA_BYTES = 10 * 1024 * 1024;
const UMBRAL_CONFIANZA_ADVERTENCIA = 70; // US-VIA-01 CA4

// Adjuntos manuales (distintos de la captura por IA de arriba, que ya se auto-adjunta) — mismas
// validaciones que KilometrajeModal/ViaticoAdjuntosModal.
const EXTENSIONES_VALIDAS_ADJUNTO = ['.pdf', '.jpg', '.jpeg', '.png'];
const TAMANO_MAXIMO_ADJUNTO_BYTES = 10 * 1024 * 1024;

function formatearTamano(bytes: number | null): string {
    if (bytes === null) return '';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ErrorAdjuntosKey = 'viaticos.adjuntos_error_formato' | 'viaticos.adjuntos_error_tamano' | 'viaticos.adjuntos_error_contenido';

async function validarArchivoAdjunto(file: File): Promise<ErrorAdjuntosKey | null> {
    const nombreLower = file.name.toLowerCase();
    if (!EXTENSIONES_VALIDAS_ADJUNTO.some((ext) => nombreLower.endsWith(ext))) return 'viaticos.adjuntos_error_formato';
    if (file.size > TAMANO_MAXIMO_ADJUNTO_BYTES) return 'viaticos.adjuntos_error_tamano';
    const primerosBytes = await leerPrimerosBytes(file, 4);
    if (!magicBytesCoinciden(primerosBytes, file.type)) return 'viaticos.adjuntos_error_contenido';
    return null;
}

interface PorRutaModalProps {
    empleados: EmpleadoActivo[];
    quincenaId: string;
    quincenaFechaInicio?: string;
    quincenaFechaFin?: string;
    registroExistente: ViaticoPorRuta | null;
    onClose: () => void;
    onSaved: (registro: ViaticoPorRuta, esNuevo: boolean) => void;
}

/**
 * Modal de alta/edición de Viático por Ruta (IMPL-129, Observación General UAT) — reemplaza el
 * formulario inline que empujaba la tabla hacia abajo, mismo chrome de overlay/bottom-sheet que
 * KilometrajeModal/VacacionModal/IncapacidadModal (US-UX-02). La Captura por IA (US-VIA-00/01/02)
 * vive DENTRO de este modal, no como pantalla separada — CA5 de US-VIA-02 ("Ingresar
 * manualmente siempre disponible, sin pasar por la IA en absoluto") solo tiene sentido pleno si
 * ambos caminos comparten el mismo formulario. En edición se entra directo al formulario manual
 * (sin pasar por el panel de captura).
 */
export const PorRutaModal: React.FC<PorRutaModalProps> = ({ empleados, quincenaId, quincenaFechaInicio, quincenaFechaFin, registroExistente, onClose, onSaved }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const inputIARef = useRef<HTMLInputElement>(null);
    const inputCamaraRef = useRef<HTMLInputElement>(null);
    const inputAdjuntoRef = useRef<HTMLInputElement>(null);
    const extraccionIdRef = useRef(0);

    const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState<EmpleadoActivo | null>(
        registroExistente ? empleados.find((e) => e.id === registroExistente.empleado_id) ?? null : null
    );
    const [form, setForm] = useState(registroExistente ? {
        fecha: registroExistente.fecha,
        cargoMotivo: registroExistente.cargo_motivo,
        destino: registroExistente.destino,
        monto: String(registroExistente.monto),
    } : FORM_VACIO);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /** Al seleccionar empleado (manual, fuera de la cascada de IA), autocompleta "Cargo" con el
     * puesto real de su ficha (US-VIA respuesta Imporfrut: el campo es el PUESTO del empleado,
     * no un motivo de viaje) — reemplaza tipearlo a mano, sigue editable por si hace falta. */
    const handleSeleccionarEmpleado = (empleado: EmpleadoActivo | null) => {
        setEmpleadoSeleccionado(empleado);
        const cargo = empleado?.cargo;
        if (cargo) {
            setForm((prev) => ({ ...prev, cargoMotivo: cargo }));
        }
    };

    // Observación Imporfrut (2026-10-05) — "Agregar" (un viático a la vez) arranca directo en el
    // formulario manual; la Captura por IA de ESTE modal queda sin usar por defecto (sigue
    // existiendo en el código, por si se reactiva más adelante). El otro camino para adjuntar un
    // archivo real es "Importar" (lote), un botón/modal totalmente aparte (ImportarViaticosLoteModal),
    // que no cambia.
    const [estadoIA, setEstadoIA] = useState<EstadoIA>('manual');
    const [archivoCapturado, setArchivoCapturado] = useState<File | null>(null);
    const [confianzaIA, setConfianzaIA] = useState<number | null>(null);
    const [advertenciasIA, setAdvertenciasIA] = useState<string[]>([]);
    const [errorIA, setErrorIA] = useState<string | null>(null);
    const [nombreExtraidoIA, setNombreExtraidoIA] = useState<string | null>(null);

    // ── Adjuntos manuales, mismo mecanismo que KilometrajeModal (defecto UAT: la vía "Ingresar
    // manualmente" no dejaba adjuntar nada — solo la Captura por IA auto-adjuntaba la foto). ──
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
        viaticoDocumentosService.getPorRegistro('por_ruta', registroExistente.id)
            .then((docs) => { if (activo) setDocumentos(docs); })
            .catch((err: unknown) => {
                Logger.error('Error al cargar adjuntos de viático por ruta', { id: registroExistente.id }, err);
                if (activo) setErrorDoc(t('viaticos.adjuntos_error_ver'));
            })
            .finally(() => { if (activo) setIsLoadingDoc(false); });
        return () => { activo = false; };
    }, [registroExistente, t]);

    const handleSeleccionarArchivoAdjunto = async (file: File | undefined) => {
        if (!file) return;
        const errorKey = await validarArchivoAdjunto(file);
        if (errorKey) {
            setErrorDoc(t(errorKey));
            if (inputAdjuntoRef.current) inputAdjuntoRef.current.value = '';
            return;
        }
        setErrorDoc(null);
        if (registroExistente) {
            await subirDocumentoManual(file);
        } else {
            setPendientes((prev) => [...prev, file]);
        }
        if (inputAdjuntoRef.current) inputAdjuntoRef.current.value = '';
    };

    const subirDocumentoManual = async (file: File) => {
        if (!profile?.tenant_id || !profile.id || !registroExistente) return;
        setIsSubiendoDoc(true);
        try {
            const nuevo = await viaticoDocumentosService.subirDocumento(profile.tenant_id, 'por_ruta', registroExistente.id, file, profile.id);
            setDocumentos((prev) => [nuevo, ...prev]);
        } catch (err: unknown) {
            Logger.error('Error al subir adjunto de viático por ruta', { id: registroExistente.id }, err);
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
            Logger.error('Error al eliminar adjunto de viático por ruta', { id: doc.id }, err);
            setErrorDoc(t('viaticos.adjuntos_error_eliminar'));
        } finally {
            setEliminandoDocId(null);
        }
    };

    const limpiarEstadoIA = () => {
        extraccionIdRef.current += 1; // invalida cualquier extracción en curso
        setEstadoIA('idle');
        setArchivoCapturado(null);
        setConfianzaIA(null);
        setAdvertenciasIA([]);
        setErrorIA(null);
        setNombreExtraidoIA(null);
        if (inputIARef.current) inputIARef.current.value = '';
        if (inputCamaraRef.current) inputCamaraRef.current.value = '';
    };

    /** Cascada de verificación de empleado (US-VIA-01): código exacto → fuzzy de nombre ≥80%
     * → sin match (selección manual). Además arma las advertencias de confianza/fecha/destino
     * (US-VIA-01 CA4, US-VIA-02 CA2/CA3) — ninguna bloquea el guardado. */
    const ejecutarCascada = (extraccion: ExtraccionViaticoIA) => {
        const advertencias: string[] = [];

        let match: EmpleadoActivo | null = null;
        if (extraccion.codigo_empleado) {
            match = empleados.find((e) => getCodigoEmpleado(e).toLowerCase() === extraccion.codigo_empleado!.trim().toLowerCase()) ?? null;
        }
        if (!match && extraccion.nombre_completo) {
            match = buscarEmpleadoPorNombre(extraccion.nombre_completo, empleados);
        }
        if (!match) advertencias.push(t('viaticos.ia_advertencia_empleado_no_encontrado'));

        if (extraccion.confianza < UMBRAL_CONFIANZA_ADVERTENCIA) {
            advertencias.push(t('viaticos.ia_advertencia_confianza_baja'));
        }
        if (!extraccion.destino) {
            advertencias.push(t('viaticos.ia_advertencia_destino_vacio'));
        }

        setEmpleadoSeleccionado(match);
        setForm({
            fecha: extraccion.fecha ?? '',
            cargoMotivo: extraccion.cargo_motivo ?? '',
            destino: extraccion.destino ?? '',
            monto: '',
        });
        setConfianzaIA(extraccion.confianza);
        setAdvertenciasIA(advertencias);
        setNombreExtraidoIA(extraccion.nombre_completo ?? null);
        setEstadoIA('extraido');
    };

    const handleSeleccionarArchivoIA = async (file: File) => {
        const nombreLower = file.name.toLowerCase();
        if (!EXTENSIONES_VALIDAS_IA.some((ext) => nombreLower.endsWith(ext))) {
            setEstadoIA('error');
            setErrorIA(t('viaticos.ia_error_formato'));
            return;
        }
        if (file.size > TAMANO_MAXIMO_IA_BYTES) {
            setEstadoIA('error');
            setErrorIA(t('viaticos.ia_error_tamano'));
            return;
        }
        const primerosBytes = await leerPrimerosBytes(file, 4);
        if (!magicBytesCoinciden(primerosBytes, file.type)) {
            setEstadoIA('error');
            setErrorIA(t('viaticos.adjuntos_error_contenido'));
            return;
        }

        const miId = ++extraccionIdRef.current;
        setEstadoIA('cargando');
        setErrorIA(null);
        try {
            const extraccion = await viaticoIaService.extraerDatos(file);
            if (extraccionIdRef.current !== miId) return; // el usuario ya abandonó/reinició

            if (!extraccion.legible) {
                setEstadoIA('error');
                setErrorIA(t('viaticos.ia_error_ilegible'));
                return;
            }
            setArchivoCapturado(file);
            ejecutarCascada(extraccion);
        } catch (err: unknown) {
            if (extraccionIdRef.current !== miId) return;
            Logger.error('Error al extraer datos de viático por IA', {}, err);
            setEstadoIA('error');
            setErrorIA(err instanceof Error && err.message === 'timeout' ? t('viaticos.ia_error_timeout') : t('viaticos.ia_error_procesar'));
        } finally {
            if (inputIARef.current) inputIARef.current.value = '';
        }
    };

    const guardar = async () => {
        if (!profile?.tenant_id || !profile.id || !quincenaId || !empleadoSeleccionado) return;

        setError(null);
        setIsSubmitting(true);
        try {
            if (registroExistente) {
                const actualizado = await viaticosPorRutaService.actualizar(registroExistente.id, {
                    empleado_id: empleadoSeleccionado.id,
                    fecha: form.fecha,
                    cargo_motivo: form.cargoMotivo.trim(),
                    destino: form.destino.trim(),
                    monto: Number(form.monto),
                });
                onSaved(actualizado, false);
            } else {
                const creado = await viaticosPorRutaService.crear({
                    tenant_id: profile.tenant_id,
                    quincena_id: quincenaId,
                    empleado_id: empleadoSeleccionado.id,
                    fecha: form.fecha,
                    cargo_motivo: form.cargoMotivo.trim(),
                    destino: form.destino.trim(),
                    monto: Number(form.monto),
                    origen: archivoCapturado ? 'ia' : 'manual',
                    created_by: profile.id,
                });

                // US-VIA-08 CA1 — la imagen capturada por IA se guarda automáticamente como
                // primer adjunto; un fallo acá no debe impedir que el viático ya guardado quede
                // persistido (el usuario puede adjuntar manualmente después si esto falla).
                if (archivoCapturado) {
                    try {
                        await viaticoDocumentosService.subirDocumento(profile.tenant_id, 'por_ruta', creado.id, archivoCapturado, profile.id, 'captura_ia');
                    } catch (adjErr: unknown) {
                        Logger.error('Error al auto-adjuntar captura de IA', { registroId: creado.id }, adjErr);
                        showToast(t('viaticos.ia_error_auto_adjuntar'), 'error');
                    }
                }

                // Adjuntos manuales seleccionados antes de guardar (independiente de la captura
                // IA de arriba — pueden coexistir, ej. la foto de la IA + un recibo adicional).
                if (pendientes.length > 0) {
                    const resultados = await Promise.allSettled(
                        pendientes.map((f) => viaticoDocumentosService.subirDocumento(profile.tenant_id, 'por_ruta', creado.id, f, profile.id))
                    );
                    if (resultados.some((r) => r.status === 'rejected')) {
                        showToast(t('viaticos.adjuntos_error_subir'), 'error');
                    }
                }

                onSaved(creado, true);
            }
            onClose();
        } catch (err: unknown) {
            Logger.error('Error al guardar viático por ruta', { editandoId: registroExistente?.id }, err);
            setError(t('viaticos.error_guardar'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.tenant_id || !profile.id || !quincenaId) return;
        if (!empleadoSeleccionado || !form.fecha || !form.cargoMotivo.trim() || !form.destino.trim() || !form.monto) {
            setError(t('viaticos.error_campos_requeridos'));
            return;
        }

        await guardar();
    };

    const mostrarFormulario = estadoIA === 'manual' || estadoIA === 'extraido';
    const fechaFueraRango = fechaFueraDeQuincena(form.fecha, quincenaFechaInicio, quincenaFechaFin);

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
                            <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                                <MapPin size={16} className="text-primary" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{registroExistente ? t('viaticos.form_title_por_ruta_editar') : t('viaticos.form_title_por_ruta')}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="overflow-y-auto p-lg flex flex-col gap-md">
                        {/* US-VIA-00/01/02 — Captura por IA, integrada en el mismo formulario (no
                            una pantalla separada) para que "Ingresar manualmente" sea un bypass
                            real, no un camino distinto. Solo se ofrece en alta (en edición se
                            entra directo al formulario manual). */}
                        {!registroExistente && (
                            <div className="flex flex-col gap-2">
                                {estadoIA === 'idle' && (
                                    <div className="bg-white rounded-2xl border border-border shadow-cards py-xl px-lg">
                                        <div className="max-w-[400px] mx-auto flex flex-col items-center text-center">
                                            <div className="w-20 h-20 rounded-2xl bg-purple-50 flex items-center justify-center mb-lg">
                                                <Camera size={36} className="text-purple-600" />
                                            </div>
                                            <h3 className="text-h3 font-bold text-heading mb-xs">{t('viaticos.ia_captura_title')}</h3>
                                            <p className="text-body text-text-secondary mb-lg">{t('viaticos.ia_dropzone_desc')}</p>
                                            <div className="flex flex-col gap-sm w-full">
                                                <button
                                                    type="button"
                                                    onClick={() => inputCamaraRef.current?.click()}
                                                    className="sm:hidden flex items-center justify-center gap-sm px-xl py-md bg-purple-600 text-white rounded-xl font-semibold text-body hover:bg-purple-700 transition-colors shadow-cards w-full"
                                                >
                                                    <Camera size={18} /> {t('viaticos.ia_abrir_camara')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => inputIARef.current?.click()}
                                                    className="flex items-center justify-center gap-sm px-xl py-md bg-purple-600 text-white rounded-xl font-semibold text-body hover:bg-purple-700 transition-colors shadow-cards w-full"
                                                >
                                                    <ImageIcon size={18} /> {t('viaticos.ia_dropzone_title')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setEstadoIA('manual')}
                                                    className="text-[13px] text-text-secondary hover:text-primary transition-colors underline mt-xs"
                                                >
                                                    {t('viaticos.ia_ingresar_manualmente')}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {estadoIA === 'cargando' && (
                                    <div className="bg-white rounded-2xl border border-purple-200 shadow-cards p-xl flex flex-col items-center gap-md">
                                        <div className="w-16 h-16 rounded-2xl bg-purple-50 flex items-center justify-center animate-pulse">
                                            <Sparkles size={28} className="text-purple-600" />
                                        </div>
                                        <div className="flex items-center gap-sm text-purple-600 font-semibold">
                                            <div className="h-4 w-4 rounded-full border-2 border-purple-300 border-t-purple-600 animate-spin" />
                                            {t('viaticos.ia_extrayendo')}
                                        </div>
                                    </div>
                                )}
                                {estadoIA === 'error' && errorIA && (
                                    <div className="flex items-start gap-3 bg-error/5 border border-error/20 rounded-lg p-md">
                                        <AlertTriangle size={16} className="text-error shrink-0 mt-0.5" />
                                        <p className="text-caption text-heading">{errorIA}</p>
                                    </div>
                                )}
                                {estadoIA === 'extraido' && (
                                    <div className="bg-white rounded-2xl border border-purple-200 shadow-cards overflow-hidden">
                                        <div className="bg-linear-to-r from-purple-600 to-purple-500 px-lg py-md flex items-center gap-sm">
                                            <Sparkles size={16} className="text-white shrink-0" />
                                            <p className="text-white font-bold text-body">{t('viaticos.ia_extraccion_exitosa', { confianza: confianzaIA })}</p>
                                        </div>
                                        {advertenciasIA.length > 0 && (
                                            <div className="p-lg flex flex-col gap-2">
                                                {advertenciasIA.map((adv) => (
                                                    <div key={adv} className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-md">
                                                        <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                                                        <p className="text-caption text-heading">{adv}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <input
                                    ref={inputIARef}
                                    type="file"
                                    accept=".jpg,.jpeg,.png,.pdf"
                                    className="hidden"
                                    onChange={(e) => { const file = e.target.files?.[0]; if (file) handleSeleccionarArchivoIA(file); }}
                                />
                                <input
                                    ref={inputCamaraRef}
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="hidden"
                                    onChange={(e) => { const file = e.target.files?.[0]; if (file) handleSeleccionarArchivoIA(file); }}
                                />

                                {(estadoIA === 'extraido' || estadoIA === 'error') && (
                                    <button type="button" onClick={limpiarEstadoIA} className="self-start text-[12px] font-semibold text-primary hover:underline">
                                        {t('viaticos.ia_ingresar_manualmente')}
                                    </button>
                                )}
                            </div>
                        )}

                        {mostrarFormulario && (
                            <div className="flex flex-col gap-3 pt-3 border-t border-border/40">
                                <div className="flex flex-col gap-1 relative">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('viaticos.field_empleado')} <span className="text-error">*</span></label>
                                    <EmpleadoCombobox
                                        empleados={empleados}
                                        value={empleadoSeleccionado}
                                        onChange={handleSeleccionarEmpleado}
                                        placeholder={t('viaticos.field_empleado_buscar_placeholder')}
                                        noResultsLabel={t('viaticos.field_empleado_sin_resultados')}
                                    />
                                    {nombreExtraidoIA && (
                                        <p className="text-[11px] text-text-secondary italic">
                                            {t('viaticos.ia_nombre_extraido', { nombre: nombreExtraidoIA })}
                                        </p>
                                    )}
                                </div>

                                <div className="flex flex-col sm:flex-row gap-2">
                                    <InputField
                                        label={t('viaticos.field_fecha')}
                                        type="date" mask="date"
                                        value={form.fecha}
                                        onChange={(e) => setForm((prev) => ({ ...prev, fecha: e.target.value }))}
                                        className="sm:w-44"
                                        required
                                    />
                                    <InputField
                                        label={t('viaticos.field_cargo_motivo')}
                                        value={form.cargoMotivo}
                                        onChange={(e) => setForm((prev) => ({ ...prev, cargoMotivo: e.target.value }))}
                                        className="flex-1"
                                        required
                                    />
                                </div>

                                {fechaFueraRango && (
                                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-md">
                                        <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                                        <p className="text-caption text-heading">{t('common.advertencia_fecha_fuera_quincena')}</p>
                                    </div>
                                )}

                                <div className="flex flex-col sm:flex-row gap-2">
                                    <InputField
                                        label={t('viaticos.field_destino')}
                                        value={form.destino}
                                        onChange={(e) => setForm((prev) => ({ ...prev, destino: e.target.value }))}
                                        className="flex-1"
                                        required
                                    />
                                    <InputField
                                        label={t('viaticos.field_monto')}
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={form.monto}
                                        onChange={(e) => setForm((prev) => ({ ...prev, monto: e.target.value }))}
                                        className="sm:w-40"
                                        required
                                    />
                                </div>

                                {/* Adjuntos manuales — independiente de la Captura por IA de
                                    arriba (esa ya se auto-adjunta al guardar). En edición: lista
                                    de existentes + subir. En creación: pendientes hasta guardar. */}
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
                                        onClick={() => inputAdjuntoRef.current?.click()}
                                        className="flex flex-col items-center justify-center gap-1 border-2 border-dashed border-border rounded-lg p-md text-center cursor-pointer hover:bg-surface/50 transition-colors"
                                    >
                                        <UploadCloud size={20} className="text-text-secondary/50" />
                                        <p className="text-caption text-text-secondary">{t('viaticos.adjuntos_subir_hint')}</p>
                                        <input
                                            ref={inputAdjuntoRef}
                                            type="file"
                                            accept=".pdf,.jpg,.jpeg,.png"
                                            className="hidden"
                                            onChange={(e) => handleSeleccionarArchivoAdjunto(e.target.files?.[0])}
                                        />
                                    </div>

                                    {isSubiendoDoc && <div className="h-8 bg-surface rounded animate-pulse" />}
                                    {errorDoc && <p className="text-caption text-error">{errorDoc}</p>}
                                </div>
                            </div>
                        )}

                        {error && <p className="text-caption text-error">{error}</p>}
                    </div>

                    {mostrarFormulario && (
                        <div className="px-lg py-md border-t border-border flex gap-sm shrink-0">
                            <Button type="submit" isLoading={isSubmitting} className="flex-1">
                                {registroExistente ? t('viaticos.action_guardar_cambios') : t('viaticos.action_guardar_viatico')}
                            </Button>
                            <button type="button" onClick={onClose} className="px-lg py-sm border border-border rounded-xl text-body text-text-secondary hover:bg-surface transition-colors">
                                {t('viaticos.action_cancelar')}
                            </button>
                        </div>
                    )}
                </form>
            </div>
        </div>
    );
};
