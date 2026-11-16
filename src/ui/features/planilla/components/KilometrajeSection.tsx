import React, { useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2, Paperclip } from 'lucide-react';

import { useToast } from '../../../../context/ToastContext';
import { planillaEmpleadosService, type Empleado } from '../../../../services/planillaEmpleadosService';
import { tarifasKmService } from '../../../../services/tarifasKmService';
import { viaticosKilometrajeService, type ViaticoKilometraje } from '../../../../services/viaticosKilometrajeService';
import { viaticoDocumentosService } from '../../../../services/viaticoDocumentosService';
import { PageLoader } from '../../../components/PageLoader';
import { Logger } from '../../../../utils/logger';
import { ViaticoAdjuntosModal } from './ViaticoAdjuntosModal';
import { KilometrajeModal } from './KilometrajeModal';
import { ImportarKilometrajeLoteModal } from './ImportarKilometrajeLoteModal';
import { getCodigoEmpleado } from '../../../../utils/empleadoCodigoUtils';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual'>;

export interface KilometrajeSectionHandle {
    abrirAlta: () => void;
    abrirLote: () => void;
}

interface KilometrajeSectionProps {
    quincenaId: string;
    quincenaFechaInicio?: string;
    quincenaFechaFin?: string;
    ref?: React.Ref<KilometrajeSectionHandle>;
}

function fmtFecha(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Viático por Kilometraje (US-VIA-06) — formulario completamente separado de "Por Ruta" (CA3),
 * sin lógica compartida. El alta/edición vive en `KilometrajeModal` (CA2 exige modal
 * explícitamente — "Modal 'Agregar registro de km'", defecto UAT corregido): la tarifa por KM
 * se precarga según el cargo del empleado seleccionado (editable puntualmente) y el monto se
 * calcula automáticamente (KM × tarifa), no es editable a mano. La columna "Respaldo" (CA4)
 * abre el mismo mecanismo de múltiples adjuntos de US-VIA-08 (IMPL-39) que Por Ruta y Fijos y
 * Variables. Empleado es un `<select>` nativo (no combobox de búsqueda) — fidelidad exacta al
 * DEMO, a diferencia de Por Ruta que sí usa combobox.
 */
export const KilometrajeSection: React.FC<KilometrajeSectionProps> = ({ quincenaId, quincenaFechaInicio, quincenaFechaFin, ref }) => {
    const { t } = useTranslation();
    const { showToast } = useToast();

    const [empleados, setEmpleados] = useState<EmpleadoActivo[]>([]);
    const [tarifasPorCargo, setTarifasPorCargo] = useState<Map<string, number>>(new Map());
    const [registros, setRegistros] = useState<ViaticoKilometraje[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [eliminandoId, setEliminandoId] = useState<string | null>(null);
    const [modalAbierto, setModalAbierto] = useState(false);
    const [showLoteModal, setShowLoteModal] = useState(false);
    const [editTarget, setEditTarget] = useState<ViaticoKilometraje | null>(null);
    const [adjuntosAbiertoPara, setAdjuntosAbiertoPara] = useState<ViaticoKilometraje | null>(null);
    /** CA3 (defecto UAT) — cantidad de adjuntos por registro, para mostrarlos en la tabla
     * (batch, sin N+1). El clip se resalta y muestra el contador si el registro tiene archivos. */
    const [adjuntosPorRegistro, setAdjuntosPorRegistro] = useState<Map<string, number>>(new Map());

    useEffect(() => {
        if (!quincenaId) return;
        setIsLoading(true);
        Promise.all([
            planillaEmpleadosService.getEmpleadosActivos(),
            tarifasKmService.getTarifas(),
            viaticosKilometrajeService.getPorQuincena(quincenaId),
        ])
            .then(([emps, tarifas, regs]) => {
                setEmpleados(emps);
                setTarifasPorCargo(new Map(tarifas.map((tk) => [tk.cargo, tk.tarifa_km])));
                setRegistros(regs);
            })
            .catch((err: unknown) => {
                Logger.error('Error al cargar viáticos por kilometraje', { quincenaId }, err);
                showToast(t('viaticos.error_cargar'), 'error');
            })
            .finally(() => setIsLoading(false));
    }, [quincenaId, t, showToast]);

    const nombreEmpleado = (empleadoId: string): string => empleados.find((e) => e.id === empleadoId)?.nombre_completo ?? empleadoId;
    const codigoEmpleado = (empleadoId: string): string => {
        const emp = empleados.find((e) => e.id === empleadoId);
        return emp ? getCodigoEmpleado(emp) : '';
    };

    useEffect(() => {
        if (registros.length === 0) {
            setAdjuntosPorRegistro(new Map());
            return;
        }
        let activo = true;
        viaticoDocumentosService.getPorRegistros('kilometraje', registros.map((r) => r.id))
            .then((docs) => {
                if (!activo) return;
                const counts = new Map<string, number>();
                for (const d of docs) counts.set(d.registro_id, (counts.get(d.registro_id) ?? 0) + 1);
                setAdjuntosPorRegistro(counts);
            })
            .catch((err: unknown) => Logger.error('Error al cargar contadores de adjuntos de kilometraje', {}, err));
        return () => { activo = false; };
    }, [registros]);

    const { totalKm, totalMonto } = useMemo(() => ({
        totalKm: registros.reduce((sum, r) => sum + r.km_recorridos, 0),
        totalMonto: registros.reduce((sum, r) => sum + r.monto, 0),
    }), [registros]);

    const abrirAlta = () => {
        setEditTarget(null);
        setModalAbierto(true);
    };

    useImperativeHandle(ref, () => ({ abrirAlta, abrirLote: () => setShowLoteModal(true) }));

    const handleLoteImportado = (creados: ViaticoKilometraje[]) => {
        setRegistros((prev) => [...creados, ...prev]);
    };

    const abrirEdicion = (registro: ViaticoKilometraje) => {
        setEditTarget(registro);
        setModalAbierto(true);
    };

    /** CA2 — el modal hace el guardado y acá se actualiza el listado + toast (mismo patrón que
     * Vacaciones/Incapacidades: la vista es dueña del estado del listado). */
    const handleSaved = (registro: ViaticoKilometraje, esNuevo: boolean) => {
        setRegistros((prev) => (esNuevo ? [registro, ...prev] : prev.map((r) => (r.id === registro.id ? registro : r))));
        showToast(esNuevo ? t('viaticos.toast_guardado') : t('viaticos.toast_actualizado'), 'success');
        setModalAbierto(false);
        setEditTarget(null);
    };

    const handleEliminar = async (id: string) => {
        setEliminandoId(id);
        try {
            await viaticosKilometrajeService.eliminar(id);
            setRegistros((prev) => prev.filter((r) => r.id !== id));
        } catch (err: unknown) {
            Logger.error('Error al eliminar viático por kilometraje', { id }, err);
            showToast(t('viaticos.error_eliminar'), 'error');
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
                {t('viaticos.resumen_kilometraje', { count: registros.length, km: totalKm, total: `$${totalMonto.toFixed(2)}` })}
            </p>

            {registros.length === 0 ? (
                <p className="text-caption text-text-secondary italic">{t('viaticos.kilometraje_empty')}</p>
            ) : (
                <>
                <div className="flex flex-col gap-sm sm:hidden">
                    {registros.map((r) => (
                        <div key={r.id} className="bg-white rounded-xl border border-border shadow-cards p-md flex items-center gap-md">
                            <div className="flex-1 min-w-0">
                                <p className="text-body font-semibold text-heading truncate">{nombreEmpleado(r.empleado_id)}</p>
                                <p className="text-[11px] text-text-secondary font-mono">{codigoEmpleado(r.empleado_id)}</p>
                                <p className="text-[12px] text-text-secondary">{fmtFecha(r.fecha)} · {r.km_recorridos} km · ${r.tarifa_km.toFixed(2)}/km</p>
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
                        <span className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">{t('viaticos.total_km_monto')}</span>
                        <span className="text-body font-bold text-heading">{totalKm} km · ${totalMonto.toFixed(2)}</span>
                    </div>
                </div>

                <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="text-[10px] font-bold uppercase tracking-widest text-text-secondary border-b border-border/50">
                                <th className="py-2 pr-2">{t('viaticos.col_empleado')}</th>
                                <th className="py-2 px-2">{t('viaticos.col_fecha')}</th>
                                <th className="py-2 px-2 text-right">{t('viaticos.col_km')}</th>
                                <th className="py-2 px-2 text-right">{t('viaticos.field_tarifa_km')}</th>
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
                                    <td className="py-2 px-2">{fmtFecha(r.fecha)}</td>
                                    <td className="py-2 px-2 text-right">{r.km_recorridos}</td>
                                    <td className="py-2 px-2 text-right">${r.tarifa_km.toFixed(2)}</td>
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
                                <td colSpan={2} className="py-2 pr-2 text-right text-[11px] font-bold uppercase tracking-widest text-text-secondary">{t('viaticos.total_km_monto')}</td>
                                <td className="py-2 px-2 text-right font-bold text-heading">{totalKm}</td>
                                <td />
                                <td className="py-2 px-2 text-right font-bold text-heading">${totalMonto.toFixed(2)}</td>
                                <td />
                            </tr>
                        </tfoot>
                    </table>
                </div>
                </>
            )}

            {modalAbierto && (
                <KilometrajeModal
                    empleados={empleados}
                    tarifasPorCargo={tarifasPorCargo}
                    registros={registros}
                    quincenaId={quincenaId}
                    quincenaFechaInicio={quincenaFechaInicio}
                    quincenaFechaFin={quincenaFechaFin}
                    registroExistente={editTarget}
                    onClose={() => { setModalAbierto(false); setEditTarget(null); }}
                    onSaved={handleSaved}
                />
            )}

            {adjuntosAbiertoPara && (
                <ViaticoAdjuntosModal
                    tipoRegistro="kilometraje"
                    registroId={adjuntosAbiertoPara.id}
                    nombreRegistro={nombreEmpleado(adjuntosAbiertoPara.empleado_id)}
                    onClose={() => setAdjuntosAbiertoPara(null)}
                />
            )}

            {showLoteModal && (
                <ImportarKilometrajeLoteModal
                    quincenaId={quincenaId}
                    tarifasPorCargo={tarifasPorCargo}
                    onClose={() => setShowLoteModal(false)}
                    onImportado={handleLoteImportado}
                />
            )}
        </div>
    );
};
