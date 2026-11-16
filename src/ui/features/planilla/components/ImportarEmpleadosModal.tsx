import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, UploadCloud, FileSpreadsheet, Download, CheckCircle2, XCircle, Users } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { useToast } from '../../../../context/ToastContext';
import { EMPLEADO_IMPORT_HEADERS, MESSAGES } from '../../../../config/constants';
import {
    validateEmpleadoImportHeaders,
    mapExcelRowToEmpleadoCruda,
    validarFilasImportacionEmpleados,
    resolverValorCatalogo,
    type FilaImportacionEmpleado,
    type EmpleadoImportListo,
} from '../../../../utils/empleadosExcelUtils';
import { planillaEmpleadosService } from '../../../../services/planillaEmpleadosService';
import { ubicacionesService } from '../../../../services/ubicacionesService';
import { cargosService } from '../../../../services/cargosService';
import { departamentosService } from '../../../../services/departamentosService';
import { bancosService } from '../../../../services/bancosService';
import { tiposContratoService } from '../../../../services/tiposContratoService';
import { Button } from '../../../components/Button';
import { PageLoader } from '../../../components/PageLoader';
import { Logger } from '../../../../utils/logger';

const EXTENSIONES_VALIDAS = ['.xls', '.xlsx'];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;

interface ImportarEmpleadosModalProps {
    onClose: () => void;
    onImportado: (creados: number) => void;
}

/**
 * Carga masiva de Empleados desde Excel — pedido directo del jefe para el arranque de UAT esta
 * semana. Mismo patrón que `ImportacionMarcacionesSection` (Reloj Marcador): plantilla propia
 * descargable + parseo determinístico en cliente (SheetJS) + revisión antes de confirmar, pero en
 * un modal (no una sección de pantalla) porque Empleados es un CRUD simple, no un módulo con
 * checklist por ubicación/quincena como Horas Extras.
 *
 * Decisión explícita del usuario (AskUserQuestion): las filas con error NO bloquean el lote — las
 * válidas se importan, las inválidas quedan listadas con su motivo para corregir en el Excel y
 * volver a subir solo esas. Cargo/Departamento/Banco/Tipo de Contrato se auto-registran en su
 * catálogo si el valor no existe (mismo criterio que el quick-add del alta individual,
 * `CatalogSelectQuickAdd` — de hecho reutiliza sus mismas funciones `crear*`, así que hereda su
 * mismo comportamiento de permisos). Ubicación es la única excepción: es la única FK real del
 * modelo, así que un nombre que no matchea el catálogo activo rechaza la fila en vez de crearla.
 */
export const ImportarEmpleadosModal: React.FC<ImportarEmpleadosModalProps> = ({ onClose, onImportado }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const inputRef = useRef<HTMLInputElement>(null);

    const [isCargandoCatalogos, setIsCargandoCatalogos] = useState(true);
    const [ubicacionesActivas, setUbicacionesActivas] = useState<{ id: string; nombre: string }[]>([]);
    const [cargos, setCargos] = useState<{ nombre: string }[]>([]);
    const [departamentos, setDepartamentos] = useState<{ nombre: string }[]>([]);
    const [bancos, setBancos] = useState<{ nombre: string }[]>([]);
    const [tiposContrato, setTiposContrato] = useState<{ nombre: string }[]>([]);

    useEffect(() => {
        Promise.all([
            ubicacionesService.getUbicaciones(),
            cargosService.getCargos(),
            departamentosService.getDepartamentos(),
            bancosService.getBancos(),
            tiposContratoService.getTiposContrato(),
        ])
            .then(([ubicaciones, cargosData, departamentosData, bancosData, tiposContratoData]) => {
                setUbicacionesActivas(ubicaciones.filter((u) => u.estado === 'activo').map((u) => ({ id: u.id, nombre: u.nombre })));
                setCargos(cargosData);
                setDepartamentos(departamentosData);
                setBancos(bancosData);
                setTiposContrato(tiposContratoData);
            })
            .catch((err: unknown) => {
                Logger.error('Error al cargar catálogos para importación de empleados', {}, err);
                setError(t('empleados.importacion_error_catalogos'));
            })
            .finally(() => setIsCargandoCatalogos(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [archivo, setArchivo] = useState<File | null>(null);
    const [isParsing, setIsParsing] = useState(false);
    const [isConfirmando, setIsConfirmando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [filas, setFilas] = useState<FilaImportacionEmpleado[] | null>(null);

    const handleDescargarPlantilla = async () => {
        const { utils, writeFile } = await import('xlsx');
        const encabezados = Object.values(EMPLEADO_IMPORT_HEADERS);
        const filaEjemplo = [
            'EMP-001', 'Juan Pérez López', '01234567-8', '', '', '', '15/03/1990', 'M',
            '7000-0000', 'juan.perez@correo.com', '', '', '',
            'Operario', 'Producción', '', ubicacionesActivas[0]?.nombre ?? 'Planta Central',
            '01/09/2026', '450.00', 'AFP Crecer', '', '', '', '', '',
        ];
        const hoja = utils.aoa_to_sheet([encabezados, filaEjemplo]);
        const libro = utils.book_new();
        utils.book_append_sheet(libro, hoja, 'Empleados');
        writeFile(libro, 'plantilla_empleados.xlsx');
    };

    const procesarArchivo = async (file: File) => {
        const nombreLower = file.name.toLowerCase();
        if (!EXTENSIONES_VALIDAS.some((ext) => nombreLower.endsWith(ext))) { setError(t('empleados.importacion_error_formato')); return; }
        if (file.size > TAMANO_MAXIMO_BYTES) { setError(t('empleados.importacion_error_tamano')); return; }

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
            if (encabezados.length === 0) { setError(t('empleados.importacion_error_vacio')); return; }

            const { isValid, missingHeaders } = validateEmpleadoImportHeaders(encabezados);
            if (!isValid) { setError(t('empleados.importacion_error_headers', { columnas: missingHeaders.join(', ') })); return; }

            const filasArchivo = utils.sheet_to_json(worksheet, { defval: '' }) as Record<string, unknown>[];
            if (filasArchivo.length === 0) { setError(t('empleados.importacion_error_vacio')); return; }

            const { duis, codigosNormalizados } = await planillaEmpleadosService.getExistentesParaImportacion();
            const crudas = filasArchivo.map(mapExcelRowToEmpleadoCruda);
            setFilas(validarFilasImportacionEmpleados(crudas, {
                ubicacionesActivas,
                duisExistentes: duis,
                codigosExistentesNormalizados: codigosNormalizados,
            }));
        } catch (err: unknown) {
            Logger.error('Error al leer archivo de empleados', {}, err);
            setError(t('empleados.importacion_error_lectura'));
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

    /**
     * Resuelve un catálogo de texto libre para TODAS las filas válidas de una sola vez: una
     * llamada a `crear` por valor DISTINTO (no por fila) para no generar duplicados dentro del
     * mismo lote si 10 filas traen el mismo Cargo nuevo.
     */
    async function resolverCatalogoDelLote(
        obtenerValor: (f: EmpleadoImportListo) => string | null,
        itemsExistentes: { nombre: string }[],
        crear: (nombre: string) => Promise<{ nombre: string }>
    ): Promise<{ resueltos: Map<string, string>; errores: Map<string, string> }> {
        const valoresDistintos = Array.from(new Set(
            filasValidas.map((f) => obtenerValor(f.listo as EmpleadoImportListo)).filter((v): v is string => !!v)
        ));
        const resueltos = new Map<string, string>();
        const errores = new Map<string, string>();
        for (const valor of valoresDistintos) {
            const resultado = await resolverValorCatalogo(valor, itemsExistentes, crear);
            if (resultado.valorCanonico) resueltos.set(valor, resultado.valorCanonico);
            else errores.set(valor, resultado.error ?? 'Error desconocido');
        }
        return { resueltos, errores };
    }

    const handleConfirmar = async () => {
        if (!profile?.tenant_id || filasValidas.length === 0) return;
        setIsConfirmando(true);
        setError(null);
        try {
            const [cargoRes, departamentoRes, bancoRes, tipoContratoRes] = await Promise.all([
                resolverCatalogoDelLote((l) => l.cargo, cargos, (nombre) => cargosService.createCargo(profile.tenant_id, nombre)),
                resolverCatalogoDelLote((l) => l.departamento, departamentos, (nombre) => departamentosService.createDepartamento(profile.tenant_id, nombre, 'blue')),
                resolverCatalogoDelLote((l) => l.banco, bancos, (nombre) => bancosService.createBanco(profile.tenant_id, nombre)),
                resolverCatalogoDelLote((l) => l.tipo_contrato, tiposContrato, (nombre) => tiposContratoService.createTipoContrato(profile.tenant_id, nombre)),
            ]);

            // Filas cuyo Cargo/Departamento/Banco/Tipo de Contrato no se pudo registrar (ej. RLS
            // rechazó el rol de quien importa) pasan de "lista" a "error" recién acá — antes de
            // esto no había forma de saberlo sin intentar la creación real en el catálogo.
            const listasFinal: EmpleadoImportListo[] = [];
            const bloqueadasPorCatalogo: FilaImportacionEmpleado[] = [];
            for (const fila of filasValidas) {
                const l = fila.listo as EmpleadoImportListo;
                const camposFallidos: string[] = [];
                if (l.cargo && cargoRes.errores.has(l.cargo)) camposFallidos.push(`Cargo "${l.cargo}": ${cargoRes.errores.get(l.cargo)}`);
                if (l.departamento && departamentoRes.errores.has(l.departamento)) camposFallidos.push(`Departamento "${l.departamento}": ${departamentoRes.errores.get(l.departamento)}`);
                if (l.banco && bancoRes.errores.has(l.banco)) camposFallidos.push(`Banco "${l.banco}": ${bancoRes.errores.get(l.banco)}`);
                if (l.tipo_contrato && tipoContratoRes.errores.has(l.tipo_contrato)) camposFallidos.push(`Tipo de Contrato "${l.tipo_contrato}": ${tipoContratoRes.errores.get(l.tipo_contrato)}`);

                if (camposFallidos.length > 0) {
                    bloqueadasPorCatalogo.push({ ...fila, listo: null, errores: camposFallidos });
                    continue;
                }
                listasFinal.push({
                    ...l,
                    cargo: l.cargo ? (cargoRes.resueltos.get(l.cargo) ?? l.cargo) : null,
                    departamento: l.departamento ? (departamentoRes.resueltos.get(l.departamento) ?? l.departamento) : null,
                    banco: l.banco ? (bancoRes.resueltos.get(l.banco) ?? l.banco) : null,
                    tipo_contrato: l.tipo_contrato ? (tipoContratoRes.resueltos.get(l.tipo_contrato) ?? l.tipo_contrato) : null,
                });
            }

            if (bloqueadasPorCatalogo.length > 0) {
                const idsBloqueadas = new Set(bloqueadasPorCatalogo.map((f) => f.clientId));
                setFilas((prev) => (prev ?? []).map((f) => {
                    const bloqueada = bloqueadasPorCatalogo.find((b) => b.clientId === f.clientId);
                    return idsBloqueadas.has(f.clientId) && bloqueada ? bloqueada : f;
                }));
            }

            if (listasFinal.length === 0) {
                setError(t('empleados.importacion_error_catalogos_todas'));
                return;
            }

            const creados = await planillaEmpleadosService.confirmarImportacion(listasFinal);
            showToast(t('empleados.importacion_resultado_exito', { count: creados }), 'success');
            onImportado(creados);
            if (bloqueadasPorCatalogo.length === 0 && filasConError.length === 0) onClose();
        } catch (err: unknown) {
            Logger.error('Error al confirmar importación de empleados', {}, err);
            setError(MESSAGES.ERROR.EMPLOYEE_IMPORT_ERROR);
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
                                <Users size={16} className="text-primary" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{t('empleados.importacion_titulo')}</h3>
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
                                                <p className="text-caption text-text-secondary">{t('empleados.importacion_instrucciones_desc')}</p>
                                                <button type="button" onClick={handleDescargarPlantilla} className="self-start flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:underline">
                                                    <Download size={14} /> {t('empleados.importacion_descargar_plantilla')}
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
                                                <p className="text-body font-semibold text-heading">{t('empleados.importacion_dropzone_title')}</p>
                                                <p className="text-caption text-text-secondary">{t('empleados.importacion_dropzone_desc')}</p>
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
                                                <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 size={12} /> {filasValidas.length} {t('empleados.importacion_ok')}</span>
                                                <span className="flex items-center gap-1 text-error"><XCircle size={12} /> {filasConError.length} {t('empleados.importacion_con_error')}</span>
                                            </div>
                                            <Button variant="ghost" size="sm" onClick={reemplazar} className="flex items-center gap-1">
                                                <X size={14} /> {t('empleados.importacion_reemplazar')}
                                            </Button>
                                        </div>

                                        {error && <p className="text-caption text-error">{error}</p>}

                                        {filasConError.length > 0 && (
                                            <div className="flex flex-col gap-2">
                                                <p className="text-[11px] font-bold uppercase tracking-wider text-error">{t('empleados.importacion_filas_con_error_title')}</p>
                                                <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto">
                                                    {filasConError.map((f) => (
                                                        <div key={f.clientId} className="border border-error/30 bg-error/5 rounded-lg p-sm">
                                                            <p className="text-caption font-semibold text-heading">
                                                                {t('empleados.importacion_fila_excel', { numero: f.numeroFilaExcel })} — {f.nombreCompleto || f.codigoEmpleadoManual || t('empleados.importacion_sin_identificar')}
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
                                                <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('empleados.importacion_filas_validas_title')}</p>
                                                <div className="overflow-x-auto max-h-64 overflow-y-auto border border-border rounded-lg">
                                                    <table className="w-full text-left text-sm">
                                                        <thead>
                                                            <tr className="bg-surface text-[10px] font-bold uppercase tracking-widest text-text-secondary sticky top-0">
                                                                <th className="p-sm">{t('empleados.col_codigo')}</th>
                                                                <th className="p-sm">{t('empleados.table_employee')}</th>
                                                                <th className="p-sm">{t('empleados.table_position')}</th>
                                                                <th className="p-sm">{t('empleados.field_ubicacion')}</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-border/30">
                                                            {filasValidas.map((f) => (
                                                                <tr key={f.clientId}>
                                                                    <td className="p-sm">{f.listo?.codigo_empleado_manual}</td>
                                                                    <td className="p-sm">{f.nombreCompleto}</td>
                                                                    <td className="p-sm">{f.listo?.cargo ?? '—'}</td>
                                                                    <td className="p-sm">{ubicacionesActivas.find((u) => u.id === f.listo?.ubicacion_id)?.nombre ?? '—'}</td>
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
                                {t('empleados.importacion_action_confirmar', { count: filasValidas.length })}
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
