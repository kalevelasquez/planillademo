import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, FileImage, Download, Trash2, UploadCloud, AlertTriangle } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { planillaEmpleadosService, type EmpleadoDocumento, type DocumentoTipo } from '../../../../services/planillaEmpleadosService';
import { Button } from '../../../components/Button';
import { Logger } from '../../../../utils/logger';

interface DocumentosSectionProps {
    empleadoId: string;
    isReadOnly: boolean;
}

const TIPOS: DocumentoTipo[] = ['dui', 'afp', 'isss', 'incapacidad', 'amonestacion', 'constancia', 'liquidacion'];

// Mismo límite que ya aplica el bucket de Supabase — se valida acá antes para no depender
// del error crudo de Supabase (IMPL-6 gap #5).
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;
const TIPOS_MIME_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/png'];

function fmtFecha(iso: string): string {
    return new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTamano(bytes: number | null): string {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * Documentos adjuntos del empleado (US-EMP-04 / IMPL-6). Igual que IndemnizacionesSection,
 * vive fuera del <form> de perfil — subir/eliminar un documento es una acción inmediata
 * e independiente del guardado general.
 */
export const DocumentosSection: React.FC<DocumentosSectionProps> = ({ empleadoId, isReadOnly }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();

    const [documentos, setDocumentos] = useState<EmpleadoDocumento[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [tipoSeleccionado, setTipoSeleccionado] = useState<DocumentoTipo>('dui');
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [documentoAEliminar, setDocumentoAEliminar] = useState<EmpleadoDocumento | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const tipoLabel = (tipo: DocumentoTipo) => t(`empleados.documento_tipo_${tipo}`);

    const loadDocumentos = async () => {
        setIsLoading(true);
        try {
            const data = await planillaEmpleadosService.getDocumentos(empleadoId);
            setDocumentos(data);
        } catch (err: unknown) {
            Logger.error('Error al cargar documentos del empleado', { empleadoId }, err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadDocumentos();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [empleadoId]);

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !profile?.tenant_id || !profile.id) return;

        setError(null);

        if (!TIPOS_MIME_PERMITIDOS.includes(file.type)) {
            setError(t('empleados.documento_validacion_tipo'));
            return;
        }
        if (file.size > TAMANO_MAXIMO_BYTES) {
            setError(t('empleados.documento_validacion_tamano'));
            return;
        }

        setIsUploading(true);
        try {
            await planillaEmpleadosService.uploadDocumento(profile.tenant_id, empleadoId, file, tipoSeleccionado, profile.id);
            await loadDocumentos();
        } catch (err: unknown) {
            Logger.error('Error al subir documento', { empleadoId, tipo: tipoSeleccionado }, err);
            setError(err instanceof Error ? err.message : t('empleados.documento_upload_error'));
        } finally {
            setIsUploading(false);
        }
    };

    const handleDownload = async (doc: EmpleadoDocumento) => {
        try {
            const url = await planillaEmpleadosService.getDocumentoSignedUrl(doc.storage_path);
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (err: unknown) {
            Logger.error('Error al generar enlace de descarga', { documentoId: doc.id }, err);
        }
    };

    const confirmDelete = async () => {
        if (!documentoAEliminar) return;
        setIsDeleting(true);
        try {
            await planillaEmpleadosService.deleteDocumento(documentoAEliminar.id, documentoAEliminar.storage_path);
            setDocumentoAEliminar(null);
            await loadDocumentos();
        } catch (err: unknown) {
            Logger.error('Error al eliminar documento', { documentoId: documentoAEliminar.id }, err);
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">
            <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                <FileText size={14} className="text-primary" />
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('empleados.section_documentos')}</h3>
            </div>

            {isLoading ? (
                <div className="h-4 bg-surface rounded w-1/3 animate-pulse" />
            ) : documentos.length === 0 ? (
                <p className="text-caption text-text-secondary italic">{t('empleados.documento_empty')}</p>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {documentos.map((doc) => {
                        const esPdf = doc.mime_type === 'application/pdf';
                        return (
                            <div key={doc.id} className="bg-white rounded-xl border border-border shadow-cards p-3 flex items-center gap-3 group">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${esPdf ? 'bg-red-50' : 'bg-blue-50'}`}>
                                    {esPdf ? <FileText size={20} className="text-red-500" /> : <FileImage size={20} className="text-blue-500" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-heading truncate">{doc.nombre_archivo}</p>
                                    <p className="text-[11px] text-text-secondary">
                                        {tipoLabel(doc.tipo)} · {fmtFecha(doc.created_at)} {doc.tamano_bytes ? `· ${fmtTamano(doc.tamano_bytes)}` : ''}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        type="button"
                                        onClick={() => handleDownload(doc)}
                                        className="p-2 rounded-lg text-text-secondary hover:text-primary hover:bg-primary-light transition-colors"
                                        title={t('empleados.documento_download')}
                                    >
                                        <Download size={16} />
                                    </button>
                                    {!isReadOnly && (
                                        <button
                                            type="button"
                                            onClick={() => setDocumentoAEliminar(doc)}
                                            className="p-2 rounded-lg text-text-secondary hover:text-error hover:bg-error/10 transition-colors"
                                            title={t('empleados.documento_delete')}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {!isReadOnly && (
                <div className="flex flex-col gap-2 pt-2 border-t border-border/40">
                    <select
                        value={tipoSeleccionado}
                        onChange={(e) => setTipoSeleccionado(e.target.value as DocumentoTipo)}
                        className="w-full sm:w-fit bg-white border border-border rounded-lg px-3 py-2 text-sm text-heading focus:outline-none focus:border-primary"
                    >
                        {TIPOS.map((tipo) => (
                            <option key={tipo} value={tipo}>{tipoLabel(tipo)}</option>
                        ))}
                    </select>
                    <div className="relative">
                        <div className="w-full border-2 border-dashed border-border rounded-xl p-4 text-center text-text-secondary hover:border-primary hover:text-primary hover:bg-primary-light/30 transition-colors">
                            <div className="flex flex-col items-center gap-1">
                                {isUploading ? (
                                    <span className="text-[13px] font-semibold">{t('empleados.documento_upload')}…</span>
                                ) : (
                                    <>
                                        <UploadCloud size={22} className="opacity-60" />
                                        <span className="text-[13px] font-semibold">{t('empleados.documento_upload')}</span>
                                    </>
                                )}
                            </div>
                        </div>
                        {!isUploading && (
                            <input
                                type="file"
                                accept="application/pdf,image/jpeg,image/png"
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                onChange={handleUpload}
                            />
                        )}
                    </div>
                </div>
            )}
            {error && <p className="text-caption text-error">{error}</p>}

            {documentoAEliminar && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-md bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                    <div
                        className="bg-white rounded-lg shadow-modals w-[90vw] md:w-[400px] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-xl flex flex-col items-center text-center gap-md">
                            <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center text-error border border-error/20">
                                <AlertTriangle size={32} />
                            </div>
                            <div>
                                <h3 className="text-h3 text-heading mb-xs">{t('empleados.documento_delete_confirm_title')}</h3>
                                <p className="text-body text-text-secondary">{documentoAEliminar.nombre_archivo}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-sm p-md border-t border-border bg-surface/30">
                            <Button
                                variant="secondary"
                                className="flex-1"
                                onClick={() => !isDeleting && setDocumentoAEliminar(null)}
                                disabled={isDeleting}
                            >
                                {t('common.cancel')}
                            </Button>
                            <Button
                                className="flex-1 bg-error hover:bg-error-dark text-white border-transparent"
                                onClick={confirmDelete}
                                isLoading={isDeleting}
                            >
                                {t('empleados.documento_delete_confirm_btn')}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
};
