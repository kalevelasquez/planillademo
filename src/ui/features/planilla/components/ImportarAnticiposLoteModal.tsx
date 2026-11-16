import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { X, UploadCloud, AlertTriangle, Trash2, PackageOpen } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { useToast } from '../../../../context/ToastContext';
import { anticiposService, type Anticipo } from '../../../../services/anticiposService';
import { anticiposLoteIaService, type ValeExtraidoLote } from '../../../../services/anticiposLoteIaService';
import { viaticoDocumentosService } from '../../../../services/viaticoDocumentosService';
import { planillaEmpleadosService, type Empleado } from '../../../../services/planillaEmpleadosService';
import { type TipoAnticipo } from '../../../../utils/anticiposUtils';
import { buscarEmpleadoPorNombre } from '../../../../utils/fuzzyMatchUtils';
import { InputField } from '../../../components/InputField';
import { Button } from '../../../components/Button';
import { EmpleadoCombobox } from '../../../components/EmpleadoCombobox';
import { PageLoader } from '../../../components/PageLoader';
import { Logger } from '../../../../utils/logger';
import { leerPrimerosBytes, magicBytesCoinciden } from './ViaticoAdjuntosModal';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual'>;

const EXTENSIONES_VALIDAS = ['.jpg', '.jpeg', '.png', '.pdf'];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;
const UMBRAL_CONFIANZA_ADVERTENCIA = 70;

interface FilaLote {
    clientId: string;
    incluir: boolean;
    empleado: EmpleadoActivo | null;
    /** Nombre tal cual vino del archivo original — se conserva aunque no haya match, para
     * poder mostrarlo en la advertencia (IMPL-171 CA2, reunión con Imporfrut sept. 2026). */
    nombreCrudo: string | null;
    numeroVale: string;
    fecha: string;
    monto: string;
    tipo: TipoAnticipo;
    numeroCuotas: number;
    confianza: number;
    advertencias: string[];
}

function mapearAFilas(vales: ValeExtraidoLote[], empleados: EmpleadoActivo[], t: TFunction): FilaLote[] {
    return vales.map((v, i) => {
        const empleado = v.nombre_completo ? buscarEmpleadoPorNombre(v.nombre_completo, empleados) : null;
        const advertencias: string[] = [];
        if (!v.legible) advertencias.push(v.motivo_no_legible || t('anticipos.ia_error_ilegible'));
        if (!empleado) advertencias.push(t('anticipos.ia_advertencia_empleado_no_encontrado', { nombre: v.nombre_completo ?? '' }));
        if (v.confianza < UMBRAL_CONFIANZA_ADVERTENCIA) advertencias.push(t('anticipos.ia_advertencia_confianza_baja'));
        return {
            clientId: `lote-${i}`,
            incluir: v.legible && !!empleado,
            empleado,
            nombreCrudo: v.nombre_completo,
            numeroVale: v.numero_vale ?? '',
            fecha: v.fecha ?? '',
            monto: v.monto !== null ? String(v.monto) : '',
            tipo: 'salario',
            numeroCuotas: 1,
            confianza: v.confianza,
            advertencias,
        };
    });
}

interface ImportarAnticiposLoteModalProps {
    empleados: EmpleadoActivo[];
    onClose: () => void;
    onImportado: (creados: Anticipo[]) => void;
}

/**
 * Importación por lote de vales de Anticipo — Imporfrut confirmó en UAT que en la práctica
 * entregan un solo documento con el detalle de VARIOS empleados a la vez (una hoja de control
 * con muchas filas, o varios "Vale de Caja Chica" escaneados juntos), no una foto por persona
 * como asumía el flujo original (US-ANT-01/02). Convive con ese flujo individual, no lo
 * reemplaza — el Preparador elige cuál usar según cómo le llegó la información.
 * La misma imagen/PDF del lote se adjunta a TODOS los anticipos creados desde acá (no hay forma
 * automática de "recortar" el comprobante de cada persona por separado) — decisión del usuario.
 */
export const ImportarAnticiposLoteModal: React.FC<ImportarAnticiposLoteModalProps> = ({ empleados, onClose, onImportado }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();

    const [archivo, setArchivo] = useState<File | null>(null);
    const [filas, setFilas] = useState<FilaLote[] | null>(null);
    const [isProcesando, setIsProcesando] = useState(false);
    const [isImportando, setIsImportando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleSeleccionarArchivo = async (file: File | undefined) => {
        if (!file) return;
        const nombreLower = file.name.toLowerCase();
        if (!EXTENSIONES_VALIDAS.some((ext) => nombreLower.endsWith(ext))) {
            setError(t('anticipos.ia_error_formato'));
            return;
        }
        if (file.size > TAMANO_MAXIMO_BYTES) {
            setError(t('anticipos.ia_error_tamano'));
            return;
        }
        const primerosBytes = await leerPrimerosBytes(file, 4);
        if (!magicBytesCoinciden(primerosBytes, file.type)) {
            setError(t('viaticos.adjuntos_error_contenido'));
            return;
        }

        setError(null);
        setArchivo(file);
        setIsProcesando(true);
        setFilas(null);
        try {
            const vales = await anticiposLoteIaService.extraerLote(file);
            if (vales.length === 0) {
                setError(t('anticipos.lote_error_sin_vales'));
                return;
            }
            setFilas(mapearAFilas(vales, empleados, t));
        } catch (err: unknown) {
            Logger.error('Error al extraer lote de anticipos', {}, err);
            setError(err instanceof Error && err.message === 'timeout' ? t('anticipos.ia_error_timeout') : t('anticipos.ia_error_procesar'));
        } finally {
            setIsProcesando(false);
        }
    };

    const actualizarFila = (clientId: string, cambios: Partial<FilaLote>) => {
        setFilas((prev) => prev && prev.map((f) => (f.clientId === clientId ? { ...f, ...cambios } : f)));
    };

    const filasIncluidas = (filas ?? []).filter((f) => f.incluir);
    const puedeConfirmar = filasIncluidas.length > 0 && filasIncluidas.every((f) => f.empleado && f.monto && Number(f.monto) > 0 && f.fecha);
    const montoTotalIncluido = filasIncluidas.reduce((acc, f) => acc + (Number(f.monto) || 0), 0);

    const handleConfirmar = async () => {
        if (!profile?.tenant_id || !profile.id || !archivo || !filas) return;
        setIsImportando(true);
        const creados: Anticipo[] = [];
        let fallidas = 0;
        for (const fila of filasIncluidas) {
            try {
                const creado = await anticiposService.crear({
                    empleadoId: fila.empleado!.id,
                    numeroVale: fila.numeroVale.trim(),
                    fechaVale: fila.fecha,
                    tipo: fila.tipo,
                    montoTotal: Number(fila.monto),
                    numeroCuotas: fila.numeroCuotas,
                    autorizadoGG: false,
                    autorizadoGGPor: null,
                    origen: 'ia',
                    iaConfianza: fila.confianza,
                    userId: profile.id,
                });
                creados.push(creado);
                await Promise.allSettled([
                    viaticoDocumentosService.subirDocumento(profile.tenant_id, 'anticipo', creado.id, archivo, profile.id),
                    planillaEmpleadosService.uploadDocumento(profile.tenant_id, fila.empleado!.id, archivo, 'anticipo', profile.id, 'anticipo'),
                ]);
            } catch (err: unknown) {
                fallidas++;
                Logger.error('Error al crear anticipo desde lote', { empleadoId: fila.empleado?.id, numeroVale: fila.numeroVale }, err);
            }
        }
        setIsImportando(false);
        if (creados.length > 0) onImportado(creados);
        showToast(
            fallidas > 0
                ? t('anticipos.lote_resultado_parcial', { creados: creados.length, total: filasIncluidas.length })
                : t('anticipos.lote_resultado_exito', { creados: creados.length }),
            fallidas > 0 ? 'error' : 'success'
        );
        if (fallidas === 0) onClose();
    };

    return (
        <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-heading/40 backdrop-blur-xs" onClick={onClose} />

            <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-lg pointer-events-none">
                <div className="pointer-events-auto w-full sm:max-w-[720px] bg-white rounded-t-2xl sm:rounded-2xl shadow-modals flex flex-col max-h-[92dvh] overflow-hidden animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-300">
                    <div className="flex items-center justify-between px-lg py-md border-b border-border shrink-0">
                        <div className="flex items-center gap-sm">
                            <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                                <PackageOpen size={16} className="text-primary" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{t('anticipos.lote_titulo')}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="overflow-y-auto p-lg flex flex-col gap-md">
                        {!filas && (
                            <>
                                <p className="text-caption text-text-secondary">{t('anticipos.lote_desc')}</p>
                                {isProcesando ? (
                                    <PageLoader label={t('anticipos.lote_procesando')} />
                                ) : (
                                    <div
                                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                        onDragLeave={() => setIsDragging(false)}
                                        onDrop={(e) => { e.preventDefault(); setIsDragging(false); void handleSeleccionarArchivo(e.dataTransfer.files?.[0]); }}
                                        onClick={() => inputRef.current?.click()}
                                        className={`flex flex-col items-center justify-center gap-sm border-2 border-dashed rounded-xl p-xl cursor-pointer transition-colors ${isDragging ? 'border-primary bg-primary-light' : 'border-border hover:border-primary/40'}`}
                                    >
                                        <UploadCloud size={28} className="text-text-secondary" />
                                        <p className="text-body font-semibold text-heading">{t('anticipos.lote_dropzone_titulo')}</p>
                                        <p className="text-caption text-text-secondary">{t('anticipos.lote_dropzone_desc')}</p>
                                        <input
                                            ref={inputRef}
                                            type="file"
                                            accept=".jpg,.jpeg,.png,.pdf"
                                            className="hidden"
                                            onChange={(e) => { void handleSeleccionarArchivo(e.target.files?.[0]); e.target.value = ''; }}
                                        />
                                    </div>
                                )}
                                {error && <p className="text-caption text-error">{error}</p>}
                            </>
                        )}

                        {filas && (
                            <>
                                <p className="text-caption text-text-secondary">{t('anticipos.lote_revision_desc', { count: filas.length })}</p>
                                <div className="flex flex-col gap-sm">
                                    <div className="hidden sm:flex items-start gap-sm px-1">
                                        <div className="w-4.5 shrink-0" />
                                        <div className="flex-1 flex gap-2">
                                            <p className="flex-1 text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('anticipos.field_empleado')}</p>
                                            <p className="w-40 text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('anticipos.field_fecha_vale')}</p>
                                            <p className="w-28 text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('anticipos.field_monto_total')}</p>
                                        </div>
                                        <div className="w-6.5 shrink-0" />
                                    </div>
                                    {filas.map((fila) => (
                                        // Sin opacity-60 (ademas de bg-surface/60): CSS opacity se aplica a todo el subarbol,
                                        // incluido el popup del EmpleadoCombobox de esta fila -- lo dejaba semi-transparente
                                        // justo cuando el usuario mas necesita verlo bien, para corregir la fila excluida.
                                        <div key={fila.clientId} className={`border rounded-lg p-md flex flex-col gap-sm ${fila.incluir ? 'border-border' : 'border-border bg-surface/60'}`}>
                                            <div className="flex items-start gap-sm">
                                                <input
                                                    type="checkbox"
                                                    checked={fila.incluir}
                                                    onChange={(e) => actualizarFila(fila.clientId, { incluir: e.target.checked })}
                                                    className="mt-1"
                                                />
                                                <div className="flex-1 flex flex-col sm:flex-row gap-2">
                                                    <EmpleadoCombobox
                                                        empleados={empleados}
                                                        value={fila.empleado}
                                                        onChange={(emp) => actualizarFila(fila.clientId, { empleado: emp, incluir: !!emp })}
                                                        placeholder={t('anticipos.field_empleado_buscar_placeholder')}
                                                        noResultsLabel={t('anticipos.field_empleado_sin_resultados')}
                                                        className="flex-1"
                                                    />
                                                    <InputField
                                                        type="date"
                                                        mask="date"
                                                        value={fila.fecha}
                                                        onChange={(e) => actualizarFila(fila.clientId, { fecha: e.target.value })}
                                                        className="w-40"
                                                    />
                                                    <InputField
                                                        type="number"
                                                        min={0}
                                                        step="0.01"
                                                        value={fila.monto}
                                                        onChange={(e) => actualizarFila(fila.clientId, { monto: e.target.value })}
                                                        className="w-28"
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setFilas((prev) => prev && prev.filter((f) => f.clientId !== fila.clientId))}
                                                    className="p-1.5 text-text-secondary hover:text-error transition-colors rounded-lg hover:bg-error/10"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                            {fila.advertencias.length > 0 && (
                                                <div className="flex items-start gap-1.5 pl-6">
                                                    <AlertTriangle size={12} className="text-amber-600 shrink-0 mt-0.5" />
                                                    <p className="text-caption text-amber-700">{fila.advertencias.join(' · ')}</p>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    {filas && (
                        <div className="px-lg py-md border-t border-border flex flex-col gap-sm shrink-0">
                            {filasIncluidas.length > 0 && (
                                <p className="text-caption text-text-secondary text-right">
                                    {t('anticipos.lote_resumen_monto_total', { monto: montoTotalIncluido.toFixed(2) })}
                                </p>
                            )}
                            <div className="flex gap-sm">
                                <Button type="button" isLoading={isImportando} disabled={!puedeConfirmar} onClick={handleConfirmar} className="flex-1">
                                    {t('anticipos.lote_action_confirmar', { count: filasIncluidas.length })}
                                </Button>
                                <button type="button" onClick={onClose} className="px-lg py-sm border border-border rounded-xl text-body text-text-secondary hover:bg-surface transition-colors">
                                    {t('anticipos.action_cancelar')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
