import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Minus, Info, Camera, Sparkles, AlertTriangle, Paperclip, UploadCloud } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { useToast } from '../../../../context/ToastContext';
import { anticiposService, type Anticipo } from '../../../../services/anticiposService';
import { anticipoIaService, type ExtraccionAnticipoIA } from '../../../../services/anticipoIaService';
import { viaticoDocumentosService } from '../../../../services/viaticoDocumentosService';
import { calcularMontoCuota, requiereAutorizacionGG, type TipoAnticipo } from '../../../../utils/anticiposUtils';
import { fechaFueraDeQuincena } from '../../../../utils/quincenaUtils';
import { buscarEmpleadoPorNombre } from '../../../../utils/fuzzyMatchUtils';
import { planillaEmpleadosService, type Empleado } from '../../../../services/planillaEmpleadosService';
import { InputField } from '../../../components/InputField';
import { Button } from '../../../components/Button';
import { EmpleadoCombobox } from '../../../components/EmpleadoCombobox';
import { Logger } from '../../../../utils/logger';
import { getCodigoEmpleado } from '../../../../utils/empleadoCodigoUtils';
import { leerPrimerosBytes, magicBytesCoinciden } from './ViaticoAdjuntosModal';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual'>;

type EstadoIA = 'idle' | 'cargando' | 'extraido' | 'error' | 'manual';
const EXTENSIONES_VALIDAS_IA = ['.jpg', '.jpeg', '.png', '.pdf'];
const TAMANO_MAXIMO_IA_BYTES = 10 * 1024 * 1024;
const UMBRAL_CONFIANZA_ADVERTENCIA = 70;

const EXTENSIONES_VALIDAS_ADJUNTO = ['.pdf', '.jpg', '.jpeg', '.png'];
const TAMANO_MAXIMO_ADJUNTO_BYTES = 10 * 1024 * 1024; // 10MB, mismo límite del bucket

type ErrorAdjuntosKey = 'viaticos.adjuntos_error_formato' | 'viaticos.adjuntos_error_tamano' | 'viaticos.adjuntos_error_contenido';

/** Mismas validaciones que `ViaticoAdjuntosModal`/`KilometrajeModal` (extensión + tamaño +
 * magic bytes). */
async function validarArchivoAdjunto(file: File): Promise<ErrorAdjuntosKey | null> {
    const nombreLower = file.name.toLowerCase();
    if (!EXTENSIONES_VALIDAS_ADJUNTO.some((ext) => nombreLower.endsWith(ext))) return 'viaticos.adjuntos_error_formato';
    if (file.size > TAMANO_MAXIMO_ADJUNTO_BYTES) return 'viaticos.adjuntos_error_tamano';
    const primerosBytes = await leerPrimerosBytes(file, 4);
    if (!magicBytesCoinciden(primerosBytes, file.type)) return 'viaticos.adjuntos_error_contenido';
    return null;
}

const FORM_VACIO = {
    numeroVale: '', fechaVale: '', tipo: 'salario' as TipoAnticipo,
    montoTotal: '', numeroCuotas: 1, autorizadoGG: false, autorizadoGGPor: '',
};

const BADGE_TIPO: Record<TipoAnticipo, string> = {
    salario: 'bg-primary-light text-primary',
    vacaciones: 'bg-teal-50 text-teal-700',
    aguinaldo: 'bg-purple-50 text-purple-700',
};

interface AnticipoModalProps {
    empleados: EmpleadoActivo[];
    /** IMPL-134 (Observación General UAT) — Anticipos no está atado a una sola quincena (se
     * paga en cuotas a lo largo de varias), pero por decisión de producto la fecha del vale sí
     * se valida (con alerta, no bloqueante) contra la quincena ACTIVA (la que se está
     * calculando ahora), no contra ninguna que el usuario esté simplemente mirando. */
    quincenaActivaFechaInicio?: string;
    quincenaActivaFechaFin?: string;
    onClose: () => void;
    onSaved: (anticipo: Anticipo) => void;
}

/**
 * Modal/bottom-sheet para Registrar Nuevo Anticipo (US-ANT-01/02) — fidelidad DEMO (US-UX-02):
 * mismo chrome de overlay que NuevaQuincenaModal/IncapacidadModal. Captura por IA en morado,
 * igual criterio ya adoptado en Viáticos Por Ruta (2da confirmación del mismo patrón).
 */
export const AnticipoModal: React.FC<AnticipoModalProps> = ({ empleados, quincenaActivaFechaInicio, quincenaActivaFechaFin, onClose, onSaved }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();

    const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState<EmpleadoActivo | null>(null);
    const [form, setForm] = useState(FORM_VACIO);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [estadoIA, setEstadoIA] = useState<EstadoIA>('idle');
    const [archivoCapturado, setArchivoCapturado] = useState<File | null>(null);
    const [confianzaIA, setConfianzaIA] = useState<number | null>(null);
    const [advertenciasIA, setAdvertenciasIA] = useState<string[]>([]);
    const [errorIA, setErrorIA] = useState<string | null>(null);
    const inputIARef = useRef<HTMLInputElement>(null);
    const inputCamaraRef = useRef<HTMLInputElement>(null);
    const extraccionIdRef = useRef(0);

    // ── Adjuntos (IMPL-130/131, Observación General UAT) — Anticipos no tenía este mecanismo,
    // se agregó igualando al resto de módulos que manejan comprobantes. Solo alta (este modal
    // no tiene modo edición): los archivos se acumulan como pendientes y se suben después de
    // crear el registro, igual que KilometrajeModal en su rama de creación. ──
    const [pendientes, setPendientes] = useState<File[]>([]);
    const [errorAdjunto, setErrorAdjunto] = useState<string | null>(null);
    const inputAdjuntoRef = useRef<HTMLInputElement>(null);

    const handleSeleccionarAdjunto = async (file: File | undefined) => {
        if (!file) return;
        const errorKey = await validarArchivoAdjunto(file);
        if (errorKey) {
            setErrorAdjunto(t(errorKey));
            if (inputAdjuntoRef.current) inputAdjuntoRef.current.value = '';
            return;
        }
        setErrorAdjunto(null);
        setPendientes((prev) => [...prev, file]);
        if (inputAdjuntoRef.current) inputAdjuntoRef.current.value = '';
    };

    const montoTotalNum = Number(form.montoTotal);
    const cuotaPreview = form.montoTotal && montoTotalNum > 0 ? calcularMontoCuota(montoTotalNum, form.numeroCuotas) : null;
    const necesitaAutorizacionGG = requiereAutorizacionGG(form.tipo);
    const mostrarFormulario = estadoIA === 'manual' || estadoIA === 'extraido';
    const fechaFueraRango = fechaFueraDeQuincena(form.fechaVale, quincenaActivaFechaInicio, quincenaActivaFechaFin);

    const ejecutarCascada = (extraccion: ExtraccionAnticipoIA) => {
        const advertencias: string[] = [];

        let match: EmpleadoActivo | null = null;
        if (extraccion.codigo_empleado) {
            match = empleados.find((e) => getCodigoEmpleado(e).toLowerCase() === extraccion.codigo_empleado!.trim().toLowerCase()) ?? null;
        }
        if (!match && extraccion.nombre_completo) {
            match = buscarEmpleadoPorNombre(extraccion.nombre_completo, empleados);
        }
        if (!match) advertencias.push(t('anticipos.ia_advertencia_empleado_no_encontrado'));
        if (extraccion.confianza < UMBRAL_CONFIANZA_ADVERTENCIA) {
            advertencias.push(t('anticipos.ia_advertencia_confianza_baja'));
        }

        setEmpleadoSeleccionado(match);
        setForm((prev) => ({
            ...prev,
            numeroVale: extraccion.numero_vale ?? '',
            fechaVale: extraccion.fecha ?? '',
            montoTotal: extraccion.monto !== null ? String(extraccion.monto) : '',
        }));
        setConfianzaIA(extraccion.confianza);
        setAdvertenciasIA(advertencias);
        setEstadoIA('extraido');
    };

    const handleSeleccionarArchivoIA = async (file: File) => {
        const nombreLower = file.name.toLowerCase();
        if (!EXTENSIONES_VALIDAS_IA.some((ext) => nombreLower.endsWith(ext))) {
            setEstadoIA('error');
            setErrorIA(t('anticipos.ia_error_formato'));
            return;
        }
        if (file.size > TAMANO_MAXIMO_IA_BYTES) {
            setEstadoIA('error');
            setErrorIA(t('anticipos.ia_error_tamano'));
            return;
        }

        const miId = ++extraccionIdRef.current;
        setEstadoIA('cargando');
        setArchivoCapturado(file);
        try {
            const extraccion = await anticipoIaService.extraerDatos(file);
            if (extraccionIdRef.current !== miId) return;
            if (!extraccion.legible) {
                setEstadoIA('error');
                setErrorIA(t('anticipos.ia_error_ilegible'));
                return;
            }
            ejecutarCascada(extraccion);
        } catch (err: unknown) {
            if (extraccionIdRef.current !== miId) return;
            setEstadoIA('error');
            setErrorIA(err instanceof Error && err.message === 'timeout' ? t('anticipos.ia_error_timeout') : t('anticipos.ia_error_procesar'));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.id) return;
        if (!empleadoSeleccionado || !form.numeroVale.trim() || !form.fechaVale || !form.montoTotal || montoTotalNum <= 0) {
            setError(t('anticipos.error_campos_requeridos'));
            return;
        }
        if (necesitaAutorizacionGG && !form.autorizadoGG) {
            setError(t('anticipos.error_autorizacion_gg_requerida'));
            return;
        }

        setError(null);
        setIsSubmitting(true);
        try {
            const creado = await anticiposService.crear({
                empleadoId: empleadoSeleccionado.id,
                numeroVale: form.numeroVale.trim(),
                fechaVale: form.fechaVale,
                tipo: form.tipo,
                montoTotal: montoTotalNum,
                numeroCuotas: form.numeroCuotas,
                autorizadoGG: form.autorizadoGG,
                autorizadoGGPor: form.autorizadoGGPor.trim() || null,
                origen: archivoCapturado ? 'ia' : 'manual',
                iaConfianza: archivoCapturado ? confianzaIA : null,
                userId: profile.id,
            });
            const tenantId = profile.tenant_id;
            if (pendientes.length > 0 && tenantId) {
                // CA2 (IMPL-6) — el vale también debe quedar como documento del empleado, no
                // solo en `planilla_viatico_documentos`. Se sube el mismo File a ambos destinos
                // en paralelo (no se copia el archivo ya subido, para no depender de un bucket
                // cruzado que la RLS/servicios actuales no soportan).
                const resultados = await Promise.allSettled([
                    ...pendientes.map((f) => viaticoDocumentosService.subirDocumento(tenantId, 'anticipo', creado.id, f, profile.id)),
                    ...pendientes.map((f) => planillaEmpleadosService.uploadDocumento(tenantId, empleadoSeleccionado.id, f, 'anticipo', profile.id, 'anticipo')),
                ]);
                if (resultados.some((r) => r.status === 'rejected')) {
                    showToast(t('viaticos.adjuntos_error_subir'), 'error');
                }
            }
            onSaved(creado);
            onClose();
        } catch (err: unknown) {
            Logger.error('Error al guardar anticipo', {}, err);
            setError(t('anticipos.error_guardar'));
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
                                <Plus size={16} className="text-primary" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{t('anticipos.form_title')}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="overflow-y-auto p-lg flex flex-col gap-md">
                        {estadoIA === 'idle' && (
                            <div className="flex flex-col items-center gap-md text-center bg-purple-50 rounded-2xl py-xl px-lg">
                                <div className="w-14 h-14 rounded-xl bg-purple-100 flex items-center justify-center">
                                    <Camera size={26} className="text-purple-600" />
                                </div>
                                <div className="max-w-[320px] mx-auto flex flex-col gap-1">
                                    <p className="text-body font-bold text-heading">{t('anticipos.ia_captura_title')}</p>
                                    <p className="text-[12px] text-text-secondary">{t('anticipos.ia_dropzone_desc')}</p>
                                </div>
                                <div className="flex flex-col gap-2 w-full">
                                    <button
                                        type="button"
                                        onClick={() => inputCamaraRef.current?.click()}
                                        className="sm:hidden flex items-center justify-center gap-2 px-lg py-sm bg-purple-600 text-white rounded-xl font-semibold text-body hover:bg-purple-700 transition-colors"
                                    >
                                        <Camera size={16} /> {t('anticipos.ia_abrir_camara')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => inputIARef.current?.click()}
                                        className="flex items-center justify-center gap-2 px-lg py-sm bg-purple-600 text-white rounded-xl font-semibold text-body hover:bg-purple-700 transition-colors"
                                    >
                                        {t('anticipos.ia_dropzone_title')}
                                    </button>
                                </div>
                                <button type="button" onClick={() => setEstadoIA('manual')} className="text-[12px] font-semibold text-primary hover:underline">
                                    {t('anticipos.ia_ingresar_manualmente')}
                                </button>
                            </div>
                        )}

                        {estadoIA === 'cargando' && (
                            <div className="flex flex-col items-center gap-md py-xl">
                                <div className="w-14 h-14 rounded-xl bg-purple-50 flex items-center justify-center animate-pulse">
                                    <Sparkles size={26} className="text-purple-600" />
                                </div>
                                <div className="flex items-center gap-2 text-purple-600 font-semibold">
                                    <div className="h-4 w-4 rounded-full border-2 border-purple-300 border-t-purple-600 animate-spin" />
                                    {t('anticipos.ia_extrayendo')}
                                </div>
                            </div>
                        )}

                        {estadoIA === 'error' && errorIA && (
                            <div className="flex flex-col gap-2">
                                <div className="flex items-start gap-3 bg-error/5 border border-error/20 rounded-lg p-md">
                                    <AlertTriangle size={16} className="text-error shrink-0 mt-0.5" />
                                    <p className="text-caption text-heading">{errorIA}</p>
                                </div>
                                <button type="button" onClick={() => setEstadoIA('manual')} className="self-start text-[12px] font-semibold text-primary hover:underline">
                                    {t('anticipos.ia_ingresar_manualmente')}
                                </button>
                            </div>
                        )}

                        {estadoIA === 'extraido' && (
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-2 bg-linear-to-r from-purple-600 to-purple-500 rounded-lg p-md">
                                    <Sparkles size={16} className="text-white shrink-0" />
                                    <p className="text-caption text-white font-semibold">{t('anticipos.ia_extraccion_exitosa', { confianza: confianzaIA })}</p>
                                </div>
                                {advertenciasIA.map((adv) => (
                                    <div key={adv} className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-md">
                                        <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                                        <p className="text-caption text-heading">{adv}</p>
                                    </div>
                                ))}
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

                        {mostrarFormulario && (
                            <>
                                <div className="flex flex-col gap-1 relative">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('anticipos.field_empleado')} <span className="text-error">*</span></label>
                                    <EmpleadoCombobox
                                        empleados={empleados}
                                        value={empleadoSeleccionado}
                                        onChange={setEmpleadoSeleccionado}
                                        placeholder={t('anticipos.field_empleado_buscar_placeholder')}
                                        noResultsLabel={t('anticipos.field_empleado_sin_resultados')}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-md">
                                    <InputField
                                        label={t('anticipos.field_numero_vale')}
                                        value={form.numeroVale}
                                        onChange={(e) => setForm((prev) => ({ ...prev, numeroVale: e.target.value }))}
                                        required
                                    />
                                    <InputField
                                        label={t('anticipos.field_fecha_vale')}
                                        type="date" mask="date"
                                        value={form.fechaVale}
                                        onChange={(e) => setForm((prev) => ({ ...prev, fechaVale: e.target.value }))}
                                        required
                                    />
                                </div>

                                {fechaFueraRango && (
                                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-md">
                                        <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                                        <p className="text-caption text-heading">{t('common.advertencia_fecha_fuera_quincena')}</p>
                                    </div>
                                )}

                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('anticipos.field_tipo')}</label>
                                    <div className="flex gap-2">
                                        {(['salario', 'vacaciones', 'aguinaldo'] as TipoAnticipo[]).map((tipo) => (
                                            <button
                                                key={tipo}
                                                type="button"
                                                onClick={() => setForm((prev) => ({ ...prev, tipo, autorizadoGG: requiereAutorizacionGG(tipo) ? prev.autorizadoGG : false }))}
                                                className={`px-3 py-1.5 rounded-full text-[12px] font-bold uppercase tracking-wide transition-colors ${
                                                    form.tipo === tipo ? BADGE_TIPO[tipo] : 'bg-surface text-text-secondary hover:bg-border/40'
                                                }`}
                                            >
                                                {t(`anticipos.tipo_${tipo}`)}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {necesitaAutorizacionGG && (
                                    <div className="flex flex-col gap-2 bg-amber-50/60 border border-amber-200 rounded-lg p-md">
                                        <label className="flex items-center gap-2 text-caption text-heading">
                                            <input
                                                type="checkbox"
                                                checked={form.autorizadoGG}
                                                onChange={(e) => setForm((prev) => ({ ...prev, autorizadoGG: e.target.checked }))}
                                            />
                                            {t('anticipos.field_autorizado_gg')} <span className="text-error">*</span>
                                        </label>
                                        <InputField
                                            label={t('anticipos.field_autorizado_gg_por')}
                                            value={form.autorizadoGGPor}
                                            onChange={(e) => setForm((prev) => ({ ...prev, autorizadoGGPor: e.target.value }))}
                                        />
                                        <div className="flex items-start gap-2 text-[11px] text-text-secondary">
                                            <Info size={12} className="shrink-0 mt-0.5" />
                                            <p>{t('anticipos.autorizacion_gg_informativo')}</p>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-md">
                                    <InputField
                                        label={t('anticipos.field_monto_total')}
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={form.montoTotal}
                                        onChange={(e) => setForm((prev) => ({ ...prev, montoTotal: e.target.value }))}
                                        required
                                    />
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('anticipos.field_numero_cuotas')}</label>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setForm((prev) => ({ ...prev, numeroCuotas: Math.max(1, prev.numeroCuotas - 1) }))}
                                                className="p-1.5 rounded-md border border-border hover:bg-surface"
                                            >
                                                <Minus size={14} />
                                            </button>
                                            <span className="w-8 text-center font-semibold text-heading">{form.numeroCuotas}</span>
                                            <button
                                                type="button"
                                                onClick={() => setForm((prev) => ({ ...prev, numeroCuotas: prev.numeroCuotas + 1 }))}
                                                className="p-1.5 rounded-md border border-border hover:bg-surface"
                                            >
                                                <Plus size={14} />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {cuotaPreview !== null && (
                                    <p className="text-caption text-text-secondary">
                                        {t('anticipos.cuota_preview', { monto: cuotaPreview.toFixed(2) })}
                                    </p>
                                )}

                                {/* IMPL-130/131 (Observación General UAT) — Anticipos no tenía
                                    mecanismo de adjuntos; se agregó igualando al resto de
                                    módulos. Solo alta (sin modo edición en este modal): los
                                    archivos quedan pendientes y se suben al guardar. */}
                                <div className="flex flex-col gap-2 border-t border-border/40 pt-md">
                                    <div className="flex items-center gap-2">
                                        <Paperclip size={14} className="text-primary" />
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('viaticos.adjuntos_label')}</span>
                                    </div>

                                    {pendientes.length > 0 && (
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
                                    )}

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
                                            onChange={(e) => handleSeleccionarAdjunto(e.target.files?.[0])}
                                        />
                                    </div>

                                    {errorAdjunto && <p className="text-caption text-error">{errorAdjunto}</p>}
                                </div>
                            </>
                        )}

                        {error && <p className="text-caption text-error">{error}</p>}
                    </div>

                    {mostrarFormulario && (
                        <div className="px-lg py-md border-t border-border flex gap-sm shrink-0">
                            <Button type="submit" isLoading={isSubmitting} className="flex-1">
                                {t('anticipos.action_guardar')}
                            </Button>
                            <button type="button" onClick={onClose} className="px-lg py-sm border border-border rounded-xl text-body text-text-secondary hover:bg-surface transition-colors">
                                {t('anticipos.action_cancelar')}
                            </button>
                        </div>
                    )}
                </form>
            </div>
        </div>
    );
};
