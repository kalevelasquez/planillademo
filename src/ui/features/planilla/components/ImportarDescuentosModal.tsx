import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, UploadCloud, FileSpreadsheet, Download, CheckCircle2, XCircle, Wallet } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { useToast } from '../../../../context/ToastContext';
import { DESCUENTO_IMPORT_HEADERS, MESSAGES } from '../../../../config/constants';
import {
    validateDescuentoImportHeaders,
    mapExcelRowToDescuentoCruda,
    validarFilasImportacionDescuentos,
    type FilaImportacionDescuento,
} from '../../../../utils/descuentosExcelUtils';
import { planillaEmpleadosService } from '../../../../services/planillaEmpleadosService';
import { descuentoCategoriasService } from '../../../../services/descuentoCategoriasService';
import { descuentosService } from '../../../../services/descuentosService';
import { getCodigoEmpleado } from '../../../../utils/empleadoCodigoUtils';
import { extraerMensajeError } from '../../../../utils/supabaseErrorUtils';
import { Button } from '../../../components/Button';
import { PageLoader } from '../../../components/PageLoader';
import { Logger } from '../../../../utils/logger';

const EXTENSIONES_VALIDAS = ['.xls', '.xlsx'];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

interface ImportarDescuentosModalProps {
    onClose: () => void;
    onImportado: (creados: number) => void;
}

/**
 * Carga masiva de Descuentos desde Excel — mismo patrón que `ImportarEmpleadosModal.tsx`: plantilla
 * propia descargable + parseo determinístico en cliente (SheetJS) + revisión antes de confirmar,
 * en un modal. A diferencia de Empleados (que auto-registra Cargo/Departamento/Banco si no
 * existen), acá la Categoría SIEMPRE debe matchear el catálogo activo existente — no hay quick-add,
 * porque `planilla_descuento_categorias` tiene reglas de negocio propias por nombre (ej. "Préstamo
 * bancario") que no tendría sentido crear al vuelo desde un Excel.
 *
 * Mismo criterio que Empleados: las filas con error NO bloquean el lote — las válidas se importan,
 * las inválidas quedan listadas con su motivo para corregir en el Excel y volver a subir solo esas.
 */
export const ImportarDescuentosModal: React.FC<ImportarDescuentosModalProps> = ({ onClose, onImportado }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const inputRef = useRef<HTMLInputElement>(null);

    const [isCargandoCatalogos, setIsCargandoCatalogos] = useState(true);
    const [empleadosActivos, setEmpleadosActivos] = useState<{ id: string; codigo: string; nombreCompleto: string }[]>([]);
    const [categoriasActivas, setCategoriasActivas] = useState<{ id: string; nombre: string }[]>([]);

    useEffect(() => {
        Promise.all([
            planillaEmpleadosService.getEmpleadosActivos(),
            descuentoCategoriasService.getActivas(),
        ])
            .then(([empleados, categorias]) => {
                setEmpleadosActivos(empleados.map((e) => ({ id: e.id, codigo: getCodigoEmpleado(e), nombreCompleto: e.nombre_completo })));
                setCategoriasActivas(categorias.map((c) => ({ id: c.id, nombre: c.nombre })));
            })
            .catch((err: unknown) => {
                Logger.error('Error al cargar catálogos para importación de descuentos', {}, err);
                setError(t('descuentos.importacion_error_catalogos'));
            })
            .finally(() => setIsCargandoCatalogos(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [archivo, setArchivo] = useState<File | null>(null);
    const [isParsing, setIsParsing] = useState(false);
    const [isConfirmando, setIsConfirmando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [filas, setFilas] = useState<FilaImportacionDescuento[] | null>(null);

    const handleDescargarPlantilla = async () => {
        const { utils, writeFile } = await import('xlsx');
        const encabezados = Object.values(DESCUENTO_IMPORT_HEADERS);
        const filaEjemplo = [
            empleadosActivos[0]?.codigo ?? 'EMP-2026-001', 'Préstamo bancario', 'Banco Agrícola',
            '50.00', '1000.00', '20', '', '', '',
        ];
        const hoja = utils.aoa_to_sheet([encabezados, filaEjemplo]);
        const libro = utils.book_new();
        utils.book_append_sheet(libro, hoja, 'Descuentos');
        writeFile(libro, 'plantilla_descuentos.xlsx');
    };

    const procesarArchivo = async (file: File) => {
        const nombreLower = file.name.toLowerCase();
        if (!EXTENSIONES_VALIDAS.some((ext) => nombreLower.endsWith(ext))) { setError(t('descuentos.importacion_error_formato')); return; }
        if (file.size > TAMANO_MAXIMO_BYTES) { setError(t('descuentos.importacion_error_tamano')); return; }

        setError(null);
        setArchivo(file);
        setIsParsing(true);
        setFilas(null);
        try {
            const { read, utils } = await import('xlsx');
            const buffer = await file.arrayBuffer();
            const workbook = read(buffer, { type: 'array', cellDates: true });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];

            const matriz = utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];
            const encabezados = matriz.length > 0 ? (matriz[0] || []).map(String) : [];
            if (encabezados.length === 0) { setError(t('descuentos.importacion_error_vacio')); return; }

            const { isValid, missingHeaders } = validateDescuentoImportHeaders(encabezados);
            if (!isValid) { setError(t('descuentos.importacion_error_headers', { columnas: missingHeaders.join(', ') })); return; }

            const filasArchivo = utils.sheet_to_json(worksheet, { defval: '' }) as Record<string, unknown>[];
            if (filasArchivo.length === 0) { setError(t('descuentos.importacion_error_vacio')); return; }

            const crudas = filasArchivo.map(mapExcelRowToDescuentoCruda);
            setFilas(validarFilasImportacionDescuentos(crudas, {
                empleados: empleadosActivos,
                categoriasActivas,
            }));
        } catch (err: unknown) {
            Logger.error('Error al leer archivo de descuentos', {}, err);
            setError(t('descuentos.importacion_error_lectura'));
        } finally {
            setIsParsing(false);
        }
    };

    const reemplazar = () => {
        setArchivo(null);
        setFilas(null);
        setError(null);
        if (inputRef.current) inputRef.current.value = '';
    };

    const filasValidas = (filas ?? []).filter((f) => f.listo);
    const filasConError = (filas ?? []).filter((f) => !f.listo);

    const handleConfirmar = async () => {
        if (!profile?.id || filasValidas.length === 0) return;
        setIsConfirmando(true);
        setError(null);
        try {
            const listos = filasValidas.map((f) => f.listo!);
            const creados = await descuentosService.confirmarImportacion(listos, profile.id);
            showToast(t('descuentos.importacion_resultado_exito', { count: creados }), 'success');
            onImportado(creados);
            if (filasConError.length === 0) onClose();
        } catch (err: unknown) {
            Logger.error('Error al confirmar importación de descuentos', {}, err);
            setError(extraerMensajeError(err, MESSAGES.ERROR.DESCUENTO_IMPORT_ERROR));
        } finally {
            setIsConfirmando(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-heading/40 backdrop-blur-xs" onClick={onClose} />

            <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-lg pointer-events-none">
                <div className="pointer-events-auto w-full sm:max-w-[880px] bg-white rounded-t-2xl sm:rounded-2xl shadow-modals flex flex-col max-h-[92dvh] overflow-hidden animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-300">
                    <div className="flex items-center justify-between px-lg py-md border-b border-border shrink-0">
                        <div className="flex items-center gap-sm">
                            <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                                <Wallet size={16} className="text-primary" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{t('descuentos.importacion_titulo')}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="overflow-y-auto p-lg flex flex-col gap-md">
                        {isCargandoCatalogos ? (
                            <PageLoader label={t('common.loading')} />
                        ) : (
                            <>
                                {!filas && (
                                    <>
                                        <div className="bg-primary-light/30 border border-primary/20 rounded-lg p-md flex items-start gap-3">
                                            <div className="flex flex-col gap-2">
                                                <p className="text-caption text-text-secondary">{t('descuentos.importacion_instrucciones_desc')}</p>
                                                <button type="button" onClick={handleDescargarPlantilla} className="self-start flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:underline">
                                                    <Download size={14} /> {t('descuentos.importacion_descargar_plantilla')}
                                                </button>
                                            </div>
                                        </div>

                                        {isParsing ? (
                                            <PageLoader label={t('common.loading')} />
                                        ) : (
                                            <div
                                                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                                onDragLeave={() => setIsDragging(false)}
                                                onDrop={(e) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files?.[0]; if (file) void procesarArchivo(file); }}
                                                onClick={() => inputRef.current?.click()}
                                                className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-xl text-center cursor-pointer transition-colors ${isDragging ? 'border-primary bg-primary-light/20' : 'border-border hover:bg-surface/50'}`}
                                            >
                                                <UploadCloud size={28} className={isDragging ? 'text-primary' : 'text-text-secondary/50'} />
                                                <p className="text-body font-semibold text-heading">{t('descuentos.importacion_dropzone_title')}</p>
                                                <p className="text-caption text-text-secondary">{t('descuentos.importacion_dropzone_desc')}</p>
                                                <input
                                                    ref={inputRef}
                                                    type="file"
                                                    accept=".xls,.xlsx"
                                                    className="hidden"
                                                    onChange={(e) => { const file = e.target.files?.[0]; if (file) void procesarArchivo(file); }}
                                                />
                                            </div>
                                        )}
                                        {error && <p className="text-caption text-error">{error}</p>}
                                    </>
                                )}

                                {filas && (
                                    <div className="flex flex-col gap-3">
                                        <div className="flex items-center justify-between gap-3 bg-surface rounded-lg p-md flex-wrap">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <FileSpreadsheet size={18} className="text-primary shrink-0" />
                                                <p className="text-caption font-semibold text-heading truncate">{archivo?.name}</p>
                                            </div>
                                            <div className="flex items-center gap-3 text-[11px] font-bold">
                                                <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 size={12} /> {filasValidas.length} {t('descuentos.importacion_ok')}</span>
                                                <span className="flex items-center gap-1 text-error"><XCircle size={12} /> {filasConError.length} {t('descuentos.importacion_con_error')}</span>
                                            </div>
                                            <Button variant="ghost" size="sm" onClick={reemplazar} className="flex items-center gap-1">
                                                <X size={14} /> {t('descuentos.importacion_reemplazar')}
                                            </Button>
                                        </div>

                                        {error && <p className="text-caption text-error">{error}</p>}

                                        {filasConError.length > 0 && (
                                            <div className="flex flex-col gap-2">
                                                <p className="text-[11px] font-bold uppercase tracking-wider text-error">{t('descuentos.importacion_filas_con_error_title')}</p>
                                                <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto">
                                                    {filasConError.map((f) => (
                                                        <div key={f.clientId} className="border border-error/30 bg-error/5 rounded-lg p-sm">
                                                            <p className="text-caption font-semibold text-heading">
                                                                {t('descuentos.importacion_fila_excel', { numero: f.numeroFilaExcel })} — {f.nombreEmpleado || f.codigoEmpleado || t('descuentos.importacion_sin_identificar')}
                                                            </p>
                                                            <ul className="text-[12px] text-error/90 list-disc list-inside">
                                                                {f.errores.map((e, i) => <li key={i}>{e}</li>)}
                                                            </ul>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {filasValidas.length > 0 && (
                                            <div className="flex flex-col gap-2">
                                                <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('descuentos.importacion_filas_validas_title')}</p>
                                                <div className="overflow-x-auto max-h-64 overflow-y-auto border border-border rounded-lg">
                                                    <table className="w-full text-left text-sm">
                                                        <thead>
                                                            <tr className="bg-surface text-[10px] font-bold uppercase tracking-widest text-text-secondary sticky top-0">
                                                                <th className="p-sm">{t('empleados.col_codigo')}</th>
                                                                <th className="p-sm">{t('empleados.table_employee')}</th>
                                                                <th className="p-sm">{t('descuentos.importacion_col_categoria')}</th>
                                                                <th className="p-sm">{t('descuentos.importacion_col_monto_quincenal')}</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-border/30">
                                                            {filasValidas.map((f) => (
                                                                <tr key={f.clientId}>
                                                                    <td className="p-sm">{f.codigoEmpleado}</td>
                                                                    <td className="p-sm">{f.nombreEmpleado}</td>
                                                                    <td className="p-sm">{categoriasActivas.find((c) => c.id === f.listo?.categoria_id)?.nombre ?? '—'}</td>
                                                                    <td className="p-sm">${f.listo?.monto_quincenal.toFixed(2)}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {filas && (
                        <div className="px-lg py-md border-t border-border flex gap-sm shrink-0">
                            <Button type="button" isLoading={isConfirmando} disabled={filasValidas.length === 0} onClick={handleConfirmar} className="flex-1">
                                {t('descuentos.importacion_action_confirmar', { count: filasValidas.length })}
                            </Button>
                            <button type="button" onClick={onClose} className="px-lg py-sm border border-border rounded-xl text-body text-text-secondary hover:bg-surface transition-colors">
                                {t('common.cancel')}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
