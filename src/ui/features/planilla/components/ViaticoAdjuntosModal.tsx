import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Paperclip, Trash2, Download, UploadCloud } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import {
    viaticoDocumentosService,
    type ViaticoDocumento,
    type TipoRegistroViatico,
} from '../../../../services/viaticoDocumentosService';
import { Button } from '../../../components/Button';
import { Logger } from '../../../../utils/logger';

const EXTENSIONES_VALIDAS = ['.pdf', '.jpg', '.jpeg', '.png'];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024; // 10MB, mismo límite del bucket

interface ViaticoAdjuntosModalProps {
    tipoRegistro: TipoRegistroViatico;
    registroId: string;
    nombreRegistro: string;
    onClose: () => void;
}

function formatearTamano(bytes: number | null): string {
    if (bytes === null) return '';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Mismas firmas que valida `extraer-viatico-ia`/`extraer-anticipo-ia` (Edge Function) contra
 * el `mime_type` declarado — acá se aplica client-side porque la subida va directa del
 * navegador a Supabase Storage, sin backend propio de por medio (validación de integridad de
 * UX, no un control de seguridad fuerte: un usuario que edite el JS del navegador la puede
 * evitar; para eso haría falta una policy/trigger server-side, fuera de este alcance).
 *
 * Exportada para reutilizarse también en la ruta de captura por IA de `PorRutaSection`
 * (hallazgo QA menor: esa ruta solo validaba extensión/tamaño, más floja que este modal manual).
 */
export function magicBytesCoinciden(bytes: Uint8Array, mimeType: string): boolean {
    if (mimeType === 'application/pdf') return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
    if (mimeType === 'image/png') return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    return false;
}

export async function leerPrimerosBytes(file: File, n: number): Promise<Uint8Array> {
    const buffer = await file.slice(0, n).arrayBuffer();
    return new Uint8Array(buffer);
}

/**
 * Adjuntar Comprobantes al Registro de Viático (US-VIA-08 CA2/CA3) — mismo modal para
 * cualquier tipo de registro (Por Ruta, Fijos y Variables, Kilometraje). No hay un componente
 * Modal genérico en el proyecto (cada feature reimplementa su propio overlay); se sigue ese
 * mismo patrón acá en vez de introducir una abstracción nueva.
 */
export const ViaticoAdjuntosModal: React.FC<ViaticoAdjuntosModalProps> = ({ tipoRegistro, registroId, nombreRegistro, onClose }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const inputRef = useRef<HTMLInputElement>(null);

    const [documentos, setDocumentos] = useState<ViaticoDocumento[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const [eliminandoId, setEliminandoId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const cargar = () => {
        setIsLoading(true);
        viaticoDocumentosService.getPorRegistro(tipoRegistro, registroId)
            .then(setDocumentos)
            .catch((err: unknown) => Logger.error('Error al cargar adjuntos de viático', { tipoRegistro, registroId }, err))
            .finally(() => setIsLoading(false));
    };

    useEffect(cargar, [tipoRegistro, registroId]);

    const handleSubir = async (file: File) => {
        if (!profile?.tenant_id || !profile.id) return;
        const nombreLower = file.name.toLowerCase();
        if (!EXTENSIONES_VALIDAS.some((ext) => nombreLower.endsWith(ext))) {
            setError(t('viaticos.adjuntos_error_formato'));
            return;
        }
        if (file.size > TAMANO_MAXIMO_BYTES) {
            setError(t('viaticos.adjuntos_error_tamano'));
            return;
        }
        const primerosBytes = await leerPrimerosBytes(file, 4);
        if (!magicBytesCoinciden(primerosBytes, file.type)) {
            setError(t('viaticos.adjuntos_error_contenido'));
            return;
        }

        setError(null);
        setIsUploading(true);
        try {
            const nuevo = await viaticoDocumentosService.subirDocumento(profile.tenant_id, tipoRegistro, registroId, file, profile.id);
            setDocumentos((prev) => [nuevo, ...prev]);
        } catch (err: unknown) {
            Logger.error('Error al subir adjunto de viático', { tipoRegistro, registroId }, err);
            setError(t('viaticos.adjuntos_error_subir'));
        } finally {
            setIsUploading(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    const handleVer = async (doc: ViaticoDocumento) => {
        try {
            const url = await viaticoDocumentosService.getSignedUrl(doc.storage_path);
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (err: unknown) {
            Logger.error('Error al generar URL firmada de adjunto', { id: doc.id }, err);
            setError(t('viaticos.adjuntos_error_ver'));
        }
    };

    const handleEliminar = async (doc: ViaticoDocumento) => {
        setEliminandoId(doc.id);
        try {
            await viaticoDocumentosService.eliminarDocumento(doc.id, doc.storage_path);
            setDocumentos((prev) => prev.filter((d) => d.id !== doc.id));
        } catch (err: unknown) {
            Logger.error('Error al eliminar adjunto de viático', { id: doc.id }, err);
            setError(t('viaticos.adjuntos_error_eliminar'));
        } finally {
            setEliminandoId(null);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-md bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-lg shadow-cards border border-border w-full max-w-[28rem] flex flex-col gap-4 p-lg max-h-[80vh] overflow-y-auto">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Paperclip size={16} className="text-primary" />
                        <p className="text-body font-semibold text-heading">{t('viaticos.adjuntos_title', { registro: nombreRegistro })}</p>
                    </div>
                    <button type="button" onClick={onClose} className="p-1.5 text-text-secondary hover:text-heading transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {isLoading ? (
                    <div className="h-16 bg-surface rounded animate-pulse" />
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
                                    <button type="button" onClick={() => handleEliminar(doc)} disabled={eliminandoId === doc.id} className="p-1.5 text-text-secondary hover:text-error transition-colors disabled:opacity-50">
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}

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
                        onChange={(e) => { const file = e.target.files?.[0]; if (file) handleSubir(file); }}
                    />
                </div>

                {isUploading && <div className="h-10 bg-surface rounded animate-pulse" />}
                {error && <p className="text-caption text-error">{error}</p>}

                <Button type="button" variant="ghost" onClick={onClose} className="self-end">
                    {t('viaticos.action_cerrar')}
                </Button>
            </div>
        </div>
    );
};
