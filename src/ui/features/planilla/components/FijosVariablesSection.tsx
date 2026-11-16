import React, { useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2, Paperclip } from 'lucide-react';

import { useToast } from '../../../../context/ToastContext';
import { planillaEmpleadosService, type Empleado } from '../../../../services/planillaEmpleadosService';
import {
    viaticosFijosVariablesService,
    type ViaticoFijoVariable,
} from '../../../../services/viaticosFijosVariablesService';
import { viaticoDocumentosService } from '../../../../services/viaticoDocumentosService';
import { lavadoGasolinaConfigService } from '../../../../services/lavadoGasolinaConfigService';
import { esConceptoLavadoGasolina } from '../../../../utils/viaticosUtils';
import { PageLoader } from '../../../components/PageLoader';
import { Logger } from '../../../../utils/logger';
import { ViaticoAdjuntosModal } from './ViaticoAdjuntosModal';
import { FijosVariablesModal } from './FijosVariablesModal';
import { ImportarFijosVariablesLoteModal } from './ImportarFijosVariablesLoteModal';
import { getCodigoEmpleado } from '../../../../utils/empleadoCodigoUtils';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual'>;

export interface FijosVariablesSectionHandle {
    abrirAlta: () => void;
    abrirLote: () => void;
}

interface FijosVariablesSectionProps {
    quincenaId: string;
    ref?: React.Ref<FijosVariablesSectionHandle>;
}

/**
 * Viáticos Fijos y Variables (US-VIA-05). Sin dimensión de ubicación y sin candado de
 * completitud de módulo propio — ver gap en planilla-contexto.md. El alta/edición vive en
 * `FijosVariablesModal` (IMPL-129, Observación General UAT): antes era un formulario inline
 * que empujaba la tabla hacia abajo.
 */
export const FijosVariablesSection: React.FC<FijosVariablesSectionProps> = ({ quincenaId, ref }) => {
    const { t } = useTranslation();
    const { showToast } = useToast();

    const [empleados, setEmpleados] = useState<EmpleadoActivo[]>([]);
    const [registros, setRegistros] = useState<ViaticoFijoVariable[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // IMPL-36 CA4 — monto sugerido para "Lavado y gasolina" (configurable en Configuración >
    // Ingresos), null si el admin todavía no lo configuró (el campo del modal sigue editable
    // igual, esto solo precarga).
    const [montoLavadoGasolinaSugerido, setMontoLavadoGasolinaSugerido] = useState<number | null>(null);

    const [modalAbierto, setModalAbierto] = useState(false);
    const [showLoteModal, setShowLoteModal] = useState(false);
    const [editTarget, setEditTarget] = useState<ViaticoFijoVariable | null>(null);
    const [eliminandoId, setEliminandoId] = useState<string | null>(null);
    const [adjuntosAbiertoPara, setAdjuntosAbiertoPara] = useState<ViaticoFijoVariable | null>(null);
    /** IMPL-131 (Observación General UAT) — cantidad de adjuntos por registro, mismo patrón
     * batch (sin N+1) que KilometrajeSection/IncapacidadesView. */
    const [adjuntosPorRegistro, setAdjuntosPorRegistro] = useState<Map<string, number>>(new Map());

    useEffect(() => {
        if (!quincenaId) return;
        setIsLoading(true);
        setError(null);
        Promise.all([
            planillaEmpleadosService.getEmpleadosActivos(),
            viaticosFijosVariablesService.getPorQuincena(quincenaId),
        ])
            .then(([emps, regs]) => { setEmpleados(emps); setRegistros(regs); })
            .catch((err: unknown) => {
                Logger.error('Error al cargar viáticos fijos y variables', { quincenaId }, err);
                setError(t('viaticos.error_cargar'));
            })
            .finally(() => setIsLoading(false));
    }, [quincenaId, t]);

    useEffect(() => {
        lavadoGasolinaConfigService.getConfig()
            .then((config) => setMontoLavadoGasolinaSugerido(config?.monto ?? null))
            .catch((err: unknown) => Logger.error('Error al cargar config de lavado y gasolina', {}, err));
    }, []);

    useEffect(() => {
        if (registros.length === 0) {
            setAdjuntosPorRegistro(new Map());
            return;
        }
        let activo = true;
        viaticoDocumentosService.getPorRegistros('fijos_variables', registros.map((r) => r.id))
            .then((docs) => {
                if (!activo) return;
                const counts = new Map<string, number>();
                for (const d of docs) counts.set(d.registro_id, (counts.get(d.registro_id) ?? 0) + 1);
                setAdjuntosPorRegistro(counts);
            })
            .catch((err: unknown) => Logger.error('Error al cargar contadores de adjuntos de fijos y variables', {}, err));
        return () => { activo = false; };
    }, [registros]);

    const nombreEmpleado = (empleadoId: string): string => empleados.find((e) => e.id === empleadoId)?.nombre_completo ?? empleadoId;
    const codigoEmpleado = (empleadoId: string): string => {
        const emp = empleados.find((e) => e.id === empleadoId);
        return emp ? getCodigoEmpleado(emp) : '';
    };

    const montoTotal = useMemo(() => registros.reduce((sum, r) => sum + r.monto, 0), [registros]);

    const abrirAlta = () => {
        setEditTarget(null);
        setModalAbierto(true);
    };

    useImperativeHandle(ref, () => ({ abrirAlta, abrirLote: () => setShowLoteModal(true) }));

    const handleLoteImportado = (creados: ViaticoFijoVariable[]) => {
        setRegistros((prev) => [...prev, ...creados]);
    };

    const abrirEdicion = (registro: ViaticoFijoVariable) => {
        setEditTarget(registro);
        setModalAbierto(true);
    };

    /** El modal hace el guardado y acá se actualiza el listado + toast (mismo patrón que
     * Kilometraje/Vacaciones/Incapacidades: la vista es dueña del estado del listado). */
    const handleSaved = (registro: ViaticoFijoVariable, esNuevo: boolean) => {
        setRegistros((prev) => (esNuevo ? [...prev, registro] : prev.map((r) => (r.id === registro.id ? registro : r))));
        showToast(esNuevo ? t('viaticos.toast_guardado') : t('viaticos.toast_actualizado'), 'success');
        setModalAbierto(false);
        setEditTarget(null);
    };

    const handleEliminar = async (id: string) => {
        setEliminandoId(id);
        try {
            await viaticosFijosVariablesService.eliminar(id);
            setRegistros((prev) => prev.filter((r) => r.id !== id));
        } catch (err: unknown) {
            Logger.error('Error al eliminar viático fijo/variable', { id }, err);
            setError(t('viaticos.error_eliminar'));
        } finally {
            setEliminandoId(null);
        }
    };

    if (isLoading) {
        return <PageLoader label={t('common.loading')} />;
    }

    return (
        <div className="flex flex-col gap-4">
            <p className="text-[12px] text-text-secondary">
                {registros.length === 0
                    ? t('viaticos.fijos_variables_empty')
                    : t('viaticos.resumen_fijos_variables', { count: registros.length, total: `$${montoTotal.toFixed(2)}` })}
            </p>

            {error && <p className="text-caption text-error">{error}</p>}

            {registros.length > 0 && (
                <>

                <div className="flex flex-col gap-sm sm:hidden">
                    {registros.map((r) => (
                        <div key={r.id} className="bg-white rounded-xl border border-border shadow-cards p-md flex items-center gap-md">
                            <span className={`px-sm py-0.5 rounded-full text-[10px] font-bold shrink-0 ${r.tipo === 'fijo' ? 'bg-primary-light text-primary' : 'bg-amber-50 text-amber-700'}`}>
                                {r.tipo === 'fijo' ? t('viaticos.tipo_fijo') : t('viaticos.tipo_variable')}
                            </span>
                            <div className="flex-1 min-w-0">
                                <p className="text-body font-semibold text-heading truncate">{r.concepto}</p>
                                <p className="text-[12px] text-text-secondary truncate">{nombreEmpleado(r.empleado_id)} <span className="font-mono">{codigoEmpleado(r.empleado_id)}</span></p>
                                {esConceptoLavadoGasolina(r.concepto) && r.cantidad_lavados !== null && (
                                    <p className="text-[11px] text-text-secondary italic">{t('viaticos.nota_cantidad_lavados', { cantidad: r.cantidad_lavados })}</p>
                                )}
                            </div>
                            <p className="text-body font-bold text-heading shrink-0">${r.monto.toFixed(2)}</p>
                            <div className="flex gap-xs shrink-0">
                                <button type="button" onClick={() => setAdjuntosAbiertoPara(r)} className={`relative p-1 transition-colors ${(adjuntosPorRegistro.get(r.id) ?? 0) > 0 ? 'text-primary' : 'text-text-secondary hover:text-primary'}`} title={t('viaticos.col_respaldo_tooltip')}>
                                    <Paperclip size={13} />
                                    {(adjuntosPorRegistro.get(r.id) ?? 0) > 0 && (
                                        <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center">{adjuntosPorRegistro.get(r.id)}</span>
                                    )}
                                </button>
                                <button type="button" onClick={() => abrirEdicion(r)} className="p-1 text-text-secondary hover:text-primary transition-colors"><Pencil size={13} /></button>
                                <button type="button" onClick={() => handleEliminar(r.id)} disabled={eliminandoId === r.id} className="p-1 text-text-secondary hover:text-error transition-colors disabled:opacity-50"><Trash2 size={13} /></button>
                            </div>
                        </div>
                    ))}
                    <div className="flex items-center justify-between px-md py-sm bg-surface rounded-lg">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">{t('viaticos.total_periodo')}</span>
                        <span className="text-body font-bold text-heading">${montoTotal.toFixed(2)}</span>
                    </div>
                </div>

                <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="text-[10px] font-bold uppercase tracking-widest text-text-secondary border-b border-border/50">
                                <th className="py-2 pr-2">{t('viaticos.col_empleado')}</th>
                                <th className="py-2 px-2">{t('viaticos.col_tipo')}</th>
                                <th className="py-2 px-2">{t('viaticos.col_concepto')}</th>
                                <th className="py-2 px-2 text-right">{t('viaticos.col_monto')}</th>
                                <th className="py-2 pl-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {registros.map((r) => (
                                <tr key={r.id} className="border-b border-border/30 last:border-b-0 align-top">
                                    <td className="py-2 pr-2 font-medium text-heading">
                                        {nombreEmpleado(r.empleado_id)}
                                        <p className="text-[11px] text-text-secondary font-mono font-normal">{codigoEmpleado(r.empleado_id)}</p>
                                    </td>
                                    <td className="py-2 px-2">
                                        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full ${r.tipo === 'fijo' ? 'bg-primary-light text-primary' : 'bg-amber-50 text-amber-700'}`}>
                                            {r.tipo === 'fijo' ? t('viaticos.tipo_fijo') : t('viaticos.tipo_variable')}
                                        </span>
                                    </td>
                                    <td className="py-2 px-2">
                                        {r.concepto}
                                        {esConceptoLavadoGasolina(r.concepto) && r.cantidad_lavados !== null && (
                                            <p className="text-[11px] text-text-secondary italic">{t('viaticos.nota_cantidad_lavados', { cantidad: r.cantidad_lavados })}</p>
                                        )}
                                    </td>
                                    <td className="py-2 px-2 text-right font-semibold text-heading">${r.monto.toFixed(2)}</td>
                                    <td className="py-2 pl-2 text-right whitespace-nowrap">
                                        <button type="button" onClick={() => setAdjuntosAbiertoPara(r)} className={`relative p-1.5 transition-colors ${(adjuntosPorRegistro.get(r.id) ?? 0) > 0 ? 'text-primary' : 'text-text-secondary hover:text-primary'}`} title={t('viaticos.col_respaldo_tooltip')}>
                                            <Paperclip size={14} />
                                            {(adjuntosPorRegistro.get(r.id) ?? 0) > 0 && (
                                                <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center">{adjuntosPorRegistro.get(r.id)}</span>
                                            )}
                                        </button>
                                        <button type="button" onClick={() => abrirEdicion(r)} className="p-1.5 text-text-secondary hover:text-primary transition-colors">
                                            <Pencil size={14} />
                                        </button>
                                        <button type="button" onClick={() => handleEliminar(r.id)} disabled={eliminandoId === r.id} className="p-1.5 text-text-secondary hover:text-error transition-colors disabled:opacity-50">
                                            <Trash2 size={14} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colSpan={3} className="py-2 pr-2 text-right text-[11px] font-bold uppercase tracking-widest text-text-secondary">{t('viaticos.total_periodo')}</td>
                                <td className="py-2 px-2 text-right font-bold text-heading">${montoTotal.toFixed(2)}</td>
                                <td />
                            </tr>
                        </tfoot>
                    </table>
                </div>
                </>
            )}

            {modalAbierto && (
                <FijosVariablesModal
                    empleados={empleados}
                    registros={registros}
                    quincenaId={quincenaId}
                    registroExistente={editTarget}
                    montoLavadoGasolinaSugerido={montoLavadoGasolinaSugerido}
                    onClose={() => { setModalAbierto(false); setEditTarget(null); }}
                    onSaved={handleSaved}
                />
            )}

            {adjuntosAbiertoPara && (
                <ViaticoAdjuntosModal
                    tipoRegistro="fijos_variables"
                    registroId={adjuntosAbiertoPara.id}
                    nombreRegistro={nombreEmpleado(adjuntosAbiertoPara.empleado_id)}
                    onClose={() => setAdjuntosAbiertoPara(null)}
                />
            )}

            {showLoteModal && (
                <ImportarFijosVariablesLoteModal
                    quincenaId={quincenaId}
                    onClose={() => setShowLoteModal(false)}
                    onImportado={handleLoteImportado}
                />
            )}
        </div>
    );
};
