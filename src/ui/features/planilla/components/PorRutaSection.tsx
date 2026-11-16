import React, { useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Pencil, Trash2, Paperclip } from 'lucide-react';

import { useToast } from '../../../../context/ToastContext';
import { planillaEmpleadosService, type Empleado } from '../../../../services/planillaEmpleadosService';
import { viaticosPorRutaService, type ViaticoPorRuta } from '../../../../services/viaticosPorRutaService';
import { viaticoDocumentosService } from '../../../../services/viaticoDocumentosService';
import { Logger } from '../../../../utils/logger';
import { getCodigoEmpleado } from '../../../../utils/empleadoCodigoUtils';
import { ViaticoAdjuntosModal } from './ViaticoAdjuntosModal';
import { PorRutaModal } from './PorRutaModal';
import { ImportarViaticosLoteModal } from './ImportarViaticosLoteModal';
import { PageLoader } from '../../../components/PageLoader';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual'>;

export interface PorRutaSectionHandle {
    abrirAlta: () => void;
    abrirLote: () => void;
}

interface PorRutaSectionProps {
    quincenaId: string;
    quincenaFechaInicio?: string;
    quincenaFechaFin?: string;
    ref?: React.Ref<PorRutaSectionHandle>;
}

function fmtFecha(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Ingreso Manual de Viático por Ruta (US-VIA-03) + Listado y Gestión del Período (US-VIA-04,
 * acotado a "Por Ruta") + Captura por IA (US-VIA-00/01/02, IMPL-31/32/33). El alta/edición
 * (incluida la Captura por IA) vive en `PorRutaModal` (IMPL-129, Observación General UAT):
 * antes era un formulario inline que empujaba la tabla hacia abajo.
 */
export const PorRutaSection: React.FC<PorRutaSectionProps> = ({ quincenaId, quincenaFechaInicio, quincenaFechaFin, ref }) => {
    const { t } = useTranslation();
    const { showToast } = useToast();

    const [empleados, setEmpleados] = useState<EmpleadoActivo[]>([]);
    const [registros, setRegistros] = useState<ViaticoPorRuta[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [eliminandoId, setEliminandoId] = useState<string | null>(null);

    const [modalAbierto, setModalAbierto] = useState(false);
    const [showLoteModal, setShowLoteModal] = useState(false);
    const [editTarget, setEditTarget] = useState<ViaticoPorRuta | null>(null);
    const [adjuntosAbiertoPara, setAdjuntosAbiertoPara] = useState<ViaticoPorRuta | null>(null);
    /** IMPL-131 (Observación General UAT) — cantidad de adjuntos por registro, mismo patrón
     * batch (sin N+1) que KilometrajeSection/IncapacidadesView. */
    const [adjuntosPorRegistro, setAdjuntosPorRegistro] = useState<Map<string, number>>(new Map());

    useEffect(() => {
        if (!quincenaId) return;
        setIsLoading(true);
        Promise.all([
            planillaEmpleadosService.getEmpleadosActivos(),
            viaticosPorRutaService.getPorQuincena(quincenaId),
        ])
            .then(([emps, regs]) => { setEmpleados(emps); setRegistros(regs); })
            .catch((err: unknown) => {
                Logger.error('Error al cargar viáticos por ruta', { quincenaId }, err);
                setError(t('viaticos.error_cargar'));
            })
            .finally(() => setIsLoading(false));
    }, [quincenaId, t]);

    useEffect(() => {
        if (registros.length === 0) {
            setAdjuntosPorRegistro(new Map());
            return;
        }
        let activo = true;
        viaticoDocumentosService.getPorRegistros('por_ruta', registros.map((r) => r.id))
            .then((docs) => {
                if (!activo) return;
                const counts = new Map<string, number>();
                for (const d of docs) counts.set(d.registro_id, (counts.get(d.registro_id) ?? 0) + 1);
                setAdjuntosPorRegistro(counts);
            })
            .catch((err: unknown) => Logger.error('Error al cargar contadores de adjuntos de por ruta', {}, err));
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

    useImperativeHandle(ref, () => ({
        abrirAlta,
        abrirLote: () => setShowLoteModal(true),
    }));

    const abrirEdicion = (registro: ViaticoPorRuta) => {
        setEditTarget(registro);
        setModalAbierto(true);
    };

    /** El modal hace el guardado y acá se actualiza el listado + toast (mismo patrón que
     * Kilometraje/Vacaciones/Incapacidades: la vista es dueña del estado del listado). */
    const handleSaved = (registro: ViaticoPorRuta, esNuevo: boolean) => {
        setRegistros((prev) => (esNuevo ? [registro, ...prev] : prev.map((r) => (r.id === registro.id ? registro : r))));
        showToast(esNuevo ? t('viaticos.toast_guardado') : t('viaticos.toast_actualizado'), 'success');
        setModalAbierto(false);
        setEditTarget(null);
    };

    const handleLoteImportado = (creados: ViaticoPorRuta[]) => {
        setRegistros((prev) => [...creados, ...prev]);
    };

    const handleEliminar = async (id: string) => {
        setEliminandoId(id);
        try {
            await viaticosPorRutaService.eliminar(id);
            setRegistros((prev) => prev.filter((r) => r.id !== id));
        } catch (err: unknown) {
            Logger.error('Error al eliminar viático por ruta', { id }, err);
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
            {registros.length === 0 && (
                <p className="text-caption text-text-secondary italic">{t('viaticos.por_ruta_empty')}</p>
            )}

            {error && <p className="text-caption text-error">{error}</p>}

            {registros.length > 0 && (
                <div className="flex items-center justify-between gap-3 bg-surface rounded-lg p-md">
                    <p className="text-caption font-semibold text-heading">{t('viaticos.total_periodo')}</p>
                    <p className="text-body font-bold text-heading">${montoTotal.toFixed(2)}</p>
                </div>
            )}

            {registros.length > 0 && (
                <div className="flex flex-col gap-2">
                    {registros.map((r) => (
                        <div key={r.id} className="bg-white rounded-xl border border-border shadow-cards p-md flex items-center gap-md">
                            <div className="w-9 h-9 rounded-full bg-primary-light flex items-center justify-center shrink-0 text-primary">
                                <MapPin size={16} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-sm flex-wrap">
                                    <p className="text-body font-semibold text-heading truncate">{r.cargo_motivo}</p>
                                    <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-full ${r.origen === 'ia' ? 'bg-primary-light text-primary' : 'bg-surface text-text-secondary border border-border'}`}>
                                        {r.origen === 'ia' ? t('viaticos.badge_origen_ia') : t('viaticos.badge_origen_manual')}
                                    </span>
                                </div>
                                <p className="text-[12px] text-text-secondary truncate">{nombreEmpleado(r.empleado_id)} <span className="font-mono">{codigoEmpleado(r.empleado_id)}</span> · {r.destino} · {fmtFecha(r.fecha)}</p>
                            </div>
                            <div className="flex flex-col items-end gap-xs shrink-0">
                                <p className="text-body font-bold text-heading">${r.monto.toFixed(2)}</p>
                                <div className="flex gap-xs">
                                    <button type="button" onClick={() => setAdjuntosAbiertoPara(r)} className={`relative p-1 transition-colors ${(adjuntosPorRegistro.get(r.id) ?? 0) > 0 ? 'text-primary' : 'text-text-secondary hover:text-primary'}`} title={t('viaticos.col_respaldo_tooltip')}>
                                        <Paperclip size={13} />
                                        {(adjuntosPorRegistro.get(r.id) ?? 0) > 0 && (
                                            <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center">{adjuntosPorRegistro.get(r.id)}</span>
                                        )}
                                    </button>
                                    <button type="button" onClick={() => abrirEdicion(r)} className="p-1 text-text-secondary hover:text-primary transition-colors">
                                        <Pencil size={13} />
                                    </button>
                                    <button type="button" onClick={() => handleEliminar(r.id)} disabled={eliminandoId === r.id} className="p-1 text-text-secondary hover:text-error transition-colors disabled:opacity-50">
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {modalAbierto && (
                <PorRutaModal
                    empleados={empleados}
                    quincenaId={quincenaId}
                    quincenaFechaInicio={quincenaFechaInicio}
                    quincenaFechaFin={quincenaFechaFin}
                    registroExistente={editTarget}
                    onClose={() => { setModalAbierto(false); setEditTarget(null); }}
                    onSaved={handleSaved}
                />
            )}

            {showLoteModal && (
                <ImportarViaticosLoteModal
                    quincenaId={quincenaId}
                    onClose={() => setShowLoteModal(false)}
                    onImportado={handleLoteImportado}
                />
            )}

            {adjuntosAbiertoPara && (
                <ViaticoAdjuntosModal
                    tipoRegistro="por_ruta"
                    registroId={adjuntosAbiertoPara.id}
                    nombreRegistro={nombreEmpleado(adjuntosAbiertoPara.empleado_id)}
                    onClose={() => setAdjuntosAbiertoPara(null)}
                />
            )}
        </div>
    );
};
