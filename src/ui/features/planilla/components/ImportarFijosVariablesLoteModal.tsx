import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { X, UploadCloud, AlertTriangle, Trash2, PackageOpen } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { useToast } from '../../../../context/ToastContext';
import {
    viaticosFijosVariablesService,
    type ViaticoFijoVariable,
    type TipoViaticoFijoVariable,
} from '../../../../services/viaticosFijosVariablesService';
import { fijosVariablesLoteIaService, type FijoVariableExtraidoLote } from '../../../../services/fijosVariablesLoteIaService';
import { viaticoDocumentosService } from '../../../../services/viaticoDocumentosService';
import { planillaEmpleadosService, type Empleado } from '../../../../services/planillaEmpleadosService';
import { buscarEmpleadoPorNombre } from '../../../../utils/fuzzyMatchUtils';
import { getCodigoEmpleado } from '../../../../utils/empleadoCodigoUtils';
import { esConceptoLavadoGasolina, puedeAplicarLavadoGasolina, CANTIDAD_LAVADOS_MINIMA } from '../../../../utils/viaticosUtils';
import { InputField } from '../../../components/InputField';
import { PageLoader } from '../../../components/PageLoader';
import { Button } from '../../../components/Button';
import { EmpleadoCombobox } from '../../../components/EmpleadoCombobox';
import { Logger } from '../../../../utils/logger';
import { leerPrimerosBytes, magicBytesCoinciden } from './ViaticoAdjuntosModal';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual'>;

const EXTENSIONES_VALIDAS = ['.jpg', '.jpeg', '.png', '.pdf'];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;
const UMBRAL_CONFIANZA_ADVERTENCIA = 70;

interface FilaLoteFijoVariable {
    clientId: string;
    incluir: boolean;
    empleado: EmpleadoActivo | null;
    tipo: TipoViaticoFijoVariable;
    concepto: string;
    cantidadLavados: string;
    monto: string;
    confianza: number;
    advertencias: string[];
}

/** Cascada de verificación de empleado (mismo criterio que ImportarViaticosLoteModal):
 * código exacto → fuzzy de nombre ≥80% → sin match (selección manual). */
function matchearEmpleado(v: FijoVariableExtraidoLote, empleados: EmpleadoActivo[]): EmpleadoActivo | null {
    if (v.codigo_empleado) {
        const porCodigo = empleados.find((e) => getCodigoEmpleado(e).toLowerCase() === v.codigo_empleado!.trim().toLowerCase());
        if (porCodigo) return porCodigo;
    }
    if (v.nombre_completo) return buscarEmpleadoPorNombre(v.nombre_completo, empleados);
    return null;
}

function mapearAFilas(registros: FijoVariableExtraidoLote[], empleados: EmpleadoActivo[], t: TFunction): FilaLoteFijoVariable[] {
    return registros.map((v, i) => {
        const empleado = matchearEmpleado(v, empleados);
        const concepto = v.concepto ?? '';
        const esLavado = esConceptoLavadoGasolina(concepto);
        const advertencias: string[] = [];
        if (!v.legible) advertencias.push(v.motivo_no_legible || t('viaticos.ia_error_ilegible'));
        if (!empleado) advertencias.push(t('viaticos.ia_advertencia_empleado_no_encontrado'));
        if (v.confianza < UMBRAL_CONFIANZA_ADVERTENCIA) advertencias.push(t('viaticos.ia_advertencia_confianza_baja'));
        if (v.monto === null) advertencias.push(t('viaticos.lote_advertencia_monto_no_extraido'));
        if (esLavado && !puedeAplicarLavadoGasolina(v.cantidad_lavados)) advertencias.push(t('viaticos.error_lavado_gasolina_minimo', { minimo: CANTIDAD_LAVADOS_MINIMA }));
        return {
            clientId: `lote-${i}`,
            incluir: v.legible && !!empleado,
            empleado,
            tipo: v.tipo ?? 'variable',
            concepto,
            cantidadLavados: v.cantidad_lavados !== null ? String(v.cantidad_lavados) : '',
            monto: v.monto !== null ? String(v.monto) : '',
            confianza: v.confianza,
            advertencias,
        };
    });
}

interface ImportarFijosVariablesLoteModalProps {
    quincenaId: string;
    onClose: () => void;
    onImportado: (creados: ViaticoFijoVariable[]) => void;
}

/**
 * Importación por lote de Viáticos Fijos y Variables — mismo mecanismo que
 * ImportarViaticosLoteModal (Por Ruta), replicado a pedido explícito del usuario. Carga su
 * propia lista de empleados (a diferencia de Anticipos, `FijosVariablesSection` no expone
 * `empleados` como prop hacia afuera). La misma imagen/PDF del lote se adjunta a TODOS los
 * registros creados (igual que Por Ruta/Anticipos).
 */
export const ImportarFijosVariablesLoteModal: React.FC<ImportarFijosVariablesLoteModalProps> = ({ quincenaId, onClose, onImportado }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();

    const [empleados, setEmpleados] = useState<EmpleadoActivo[]>([]);
    const [archivo, setArchivo] = useState<File | null>(null);
    const [filas, setFilas] = useState<FilaLoteFijoVariable[] | null>(null);
    const [isProcesando, setIsProcesando] = useState(false);
    const [isImportando, setIsImportando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleSeleccionarArchivo = async (file: File | undefined) => {
        if (!file) return;
        const nombreLower = file.name.toLowerCase();
        if (!EXTENSIONES_VALIDAS.some((ext) => nombreLower.endsWith(ext))) {
            setError(t('viaticos.ia_error_formato'));
            return;
        }
        if (file.size > TAMANO_MAXIMO_BYTES) {
            setError(t('viaticos.ia_error_tamano'));
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
            const [registros, emps] = await Promise.all([
                fijosVariablesLoteIaService.extraerLote(file),
                empleados.length > 0 ? Promise.resolve(empleados) : planillaEmpleadosService.getEmpleadosActivos(),
            ]);
            if (empleados.length === 0) setEmpleados(emps);
            if (registros.length === 0) {
                setError(t('viaticos.lote_error_sin_registros'));
                return;
            }
            setFilas(mapearAFilas(registros, emps, t));
        } catch (err: unknown) {
            Logger.error('Error al extraer lote de fijos y variables', {}, err);
            setError(err instanceof Error && err.message === 'timeout' ? t('viaticos.ia_error_timeout') : t('viaticos.ia_error_procesar'));
        } finally {
            setIsProcesando(false);
        }
    };

    const actualizarFila = (clientId: string, cambios: Partial<FilaLoteFijoVariable>) => {
        setFilas((prev) => prev && prev.map((f) => (f.clientId === clientId ? { ...f, ...cambios } : f)));
    };

    const filasIncluidas = (filas ?? []).filter((f) => f.incluir);
    const puedeConfirmar = filasIncluidas.length > 0 && filasIncluidas.every((f) => {
        if (!f.empleado || !f.concepto.trim() || !f.monto || Number(f.monto) <= 0) return false;
        if (esConceptoLavadoGasolina(f.concepto) && !puedeAplicarLavadoGasolina(Number(f.cantidadLavados) || 0)) return false;
        return true;
    });

    const handleConfirmar = async () => {
        if (!profile?.tenant_id || !profile.id || !archivo || !filas) return;
        setIsImportando(true);
        const creados: ViaticoFijoVariable[] = [];
        let fallidas = 0;
        for (const fila of filasIncluidas) {
            try {
                const esLavado = esConceptoLavadoGasolina(fila.concepto);
                const creado = await viaticosFijosVariablesService.crear({
                    tenant_id: profile.tenant_id,
                    quincena_id: quincenaId,
                    empleado_id: fila.empleado!.id,
                    tipo: fila.tipo,
                    concepto: fila.concepto.trim(),
                    cantidad_lavados: esLavado ? Number(fila.cantidadLavados) || 0 : null,
                    monto: Number(fila.monto),
                    created_by: profile.id,
                });
                creados.push(creado);
                try {
                    await viaticoDocumentosService.subirDocumento(profile.tenant_id, 'fijos_variables', creado.id, archivo, profile.id, 'captura_ia');
                } catch (adjErr: unknown) {
                    Logger.error('Error al adjuntar imagen del lote al registro creado', { registroId: creado.id }, adjErr);
                }
            } catch (err: unknown) {
                fallidas++;
                Logger.error('Error al crear fijo/variable desde lote', { empleadoId: fila.empleado?.id }, err);
            }
        }
        setIsImportando(false);
        if (creados.length > 0) onImportado(creados);
        showToast(
            fallidas > 0
                ? t('viaticos.lote_resultado_parcial', { creados: creados.length, total: filasIncluidas.length })
                : t('viaticos.lote_resultado_exito', { creados: creados.length }),
            fallidas > 0 ? 'error' : 'success'
        );
        if (fallidas === 0) onClose();
    };

    return (
        <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-heading/40 backdrop-blur-xs" onClick={onClose} />

            <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-lg pointer-events-none">
                <div className="pointer-events-auto w-full sm:max-w-180 bg-white rounded-t-2xl sm:rounded-2xl shadow-modals flex flex-col max-h-[92dvh] overflow-hidden animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-300">
                    <div className="flex items-center justify-between px-lg py-md border-b border-border shrink-0">
                        <div className="flex items-center gap-sm">
                            <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                                <PackageOpen size={16} className="text-primary" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{t('viaticos.lote_titulo_fijos_variables')}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="overflow-y-auto p-lg flex flex-col gap-md">
                        {!filas && (
                            <>
                                <p className="text-caption text-text-secondary">{t('viaticos.lote_desc_fijos_variables')}</p>
                                {isProcesando ? (
                                    <PageLoader label={t('viaticos.lote_procesando')} />
                                ) : (
                                    <div
                                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                        onDragLeave={() => setIsDragging(false)}
                                        onDrop={(e) => { e.preventDefault(); setIsDragging(false); void handleSeleccionarArchivo(e.dataTransfer.files?.[0]); }}
                                        onClick={() => inputRef.current?.click()}
                                        className={`flex flex-col items-center justify-center gap-sm border-2 border-dashed rounded-xl p-xl cursor-pointer transition-colors ${isDragging ? 'border-primary bg-primary-light' : 'border-border hover:border-primary/40'}`}
                                    >
                                        <UploadCloud size={28} className="text-text-secondary" />
                                        <p className="text-body font-semibold text-heading">{t('viaticos.lote_dropzone_titulo')}</p>
                                        <p className="text-caption text-text-secondary">{t('viaticos.lote_dropzone_desc')}</p>
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
                                <p className="text-caption text-text-secondary">{t('viaticos.lote_revision_desc', { count: filas.length })}</p>
                                <div className="flex flex-col gap-sm">
                                    {filas.map((fila) => {
                                        const esLavado = esConceptoLavadoGasolina(fila.concepto);
                                        return (
                                            // Sin opacity en el contenedor (ver fix de IMPL-49-lote en Anticipos): CSS
                                            // opacity se aplica a todo el subarbol, incluido el popup del EmpleadoCombobox.
                                            <div key={fila.clientId} className={`border rounded-lg p-md flex flex-col gap-sm ${fila.incluir ? 'border-border' : 'border-border bg-surface/60'}`}>
                                                <div className="flex items-start gap-sm">
                                                    <input
                                                        type="checkbox"
                                                        checked={fila.incluir}
                                                        onChange={(e) => actualizarFila(fila.clientId, { incluir: e.target.checked })}
                                                        className="mt-1"
                                                    />
                                                    <div className="flex-1 flex flex-col gap-2">
                                                        <div className="flex flex-col sm:flex-row gap-2">
                                                            <div className="flex-1 flex flex-col gap-1">
                                                                <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('viaticos.field_empleado')}</label>
                                                                <EmpleadoCombobox
                                                                    empleados={empleados}
                                                                    value={fila.empleado}
                                                                    onChange={(emp) => actualizarFila(fila.clientId, { empleado: emp, incluir: !!emp })}
                                                                    placeholder={t('viaticos.field_empleado_buscar_placeholder')}
                                                                    noResultsLabel={t('viaticos.field_empleado_sin_resultados')}
                                                                />
                                                            </div>
                                                            <div className="flex flex-col gap-1">
                                                                <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('viaticos.field_tipo')}</label>
                                                                <div className="inline-flex bg-surface border border-border rounded-lg p-0.5 gap-0.5">
                                                                    {(['fijo', 'variable'] as const).map((opcion) => (
                                                                        <button
                                                                            key={opcion}
                                                                            type="button"
                                                                            onClick={() => actualizarFila(fila.clientId, { tipo: opcion })}
                                                                            className={`px-sm py-xs rounded-md text-[12px] font-semibold transition-colors ${fila.tipo === opcion ? 'bg-white text-primary shadow-sm border border-border/50' : 'text-text-secondary hover:text-heading'}`}
                                                                        >
                                                                            {opcion === 'fijo' ? t('viaticos.tipo_fijo') : t('viaticos.tipo_variable')}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-col sm:flex-row gap-2">
                                                            <InputField
                                                                label={t('viaticos.field_concepto')}
                                                                value={fila.concepto}
                                                                onChange={(e) => actualizarFila(fila.clientId, { concepto: e.target.value })}
                                                                className="flex-1"
                                                            />
                                                            {esLavado && (
                                                                <InputField
                                                                    label={t('viaticos.field_cantidad_lavados')}
                                                                    type="number"
                                                                    min={0}
                                                                    value={fila.cantidadLavados}
                                                                    onChange={(e) => actualizarFila(fila.clientId, { cantidadLavados: e.target.value })}
                                                                    className="sm:w-32"
                                                                />
                                                            )}
                                                            <InputField
                                                                label={t('viaticos.field_monto')}
                                                                type="number"
                                                                min={0}
                                                                step="0.01"
                                                                value={fila.monto}
                                                                onChange={(e) => actualizarFila(fila.clientId, { monto: e.target.value })}
                                                                className="sm:w-28"
                                                            />
                                                        </div>
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
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </div>

                    {filas && (
                        <div className="px-lg py-md border-t border-border flex gap-sm shrink-0">
                            <Button type="button" isLoading={isImportando} disabled={!puedeConfirmar} onClick={handleConfirmar} className="flex-1">
                                {t('viaticos.lote_action_confirmar', { count: filasIncluidas.length })}
                            </Button>
                            <button type="button" onClick={onClose} className="px-lg py-sm border border-border rounded-xl text-body text-text-secondary hover:bg-surface transition-colors">
                                {t('viaticos.action_cancelar')}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
