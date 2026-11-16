import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { ChevronRight, Gift } from 'lucide-react';

import { useQuincenasStore } from '../../../store/quincenasStore';
import { usePlanillaEmpleadosStore } from '../../../store/planillaEmpleadosStore';
import { getEstadoVisual } from '../../../services/quincenasService';
import { calculoPlanillaService } from '../../../services/calculoPlanillaService';
import { TIPO_QUINCENA_LABEL, resolverEmpleadosCount } from '../../../utils/quincenaUtils';
import { PageLoader } from '../../components/PageLoader';
import { EstadoQuincenaBadge } from './components/EstadoQuincenaBadge';
import { Logger } from '../../../utils/logger';

function fmtFecha(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Historial de Quincenas Cerradas (US-QNA-07 / IMPL-17). CA4: componente compartido —
 * pensado para que la vista de Aprobador (IMPL-18, no existe todavía) lo reuse igual.
 * "# correlativo" (CA1) no es una columna propia — se calcula por posición cronológica
 * (fecha_inicio ascendente) ya que la tabla no tiene DELETE, así que el orden es estable.
 * Bugfix (7ma pasada QA, hallazgo MINOR #5): el correlativo se asigna DESPUÉS de filtrar a
 * `aprobada_cerrada`, no antes — asignarlo sobre la lista completa (cualquier tipo/estado) y
 * filtrar recién después dejaba huecos visibles (ej. "#1", "#3", sin "#2") cuando una quincena
 * abierta/rechazada quedaba cronológicamente entre dos cerradas.
 */
export const HistorialQuincenasView: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();

    const { quincenas, isLoading, fetchQuincenas } = useQuincenasStore(
        useShallow((state) => ({ quincenas: state.quincenas, isLoading: state.isLoading, fetchQuincenas: state.fetchQuincenas }))
    );
    const { indicadores, fetchIndicadores } = usePlanillaEmpleadosStore(
        useShallow((state) => ({ indicadores: state.indicadores, fetchIndicadores: state.fetchIndicadores }))
    );

    useEffect(() => { fetchQuincenas(); fetchIndicadores(); }, [fetchQuincenas, fetchIndicadores]);

    const cerradasConCorrelativo = useMemo(() => {
        const cerradas = quincenas.filter((q) => q.estado === 'aprobada_cerrada');
        const ascendente = [...cerradas].sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
        const conCorrelativo = ascendente.map((q, i) => ({ ...q, correlativo: i + 1 }));
        return conCorrelativo.sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio));
    }, [quincenas]);

    // "# Empleados" (CA1) — RESUELTO (revisión épica por épica, post-IMPL-85): conteo real por
    // quincena en vez del proxy fijo de "activos totales" para todas. Una sola consulta batch.
    const [conteoPorQuincena, setConteoPorQuincena] = useState<Record<string, number>>({});
    useEffect(() => {
        const ids = cerradasConCorrelativo.map((q) => q.id);
        if (ids.length === 0) { setConteoPorQuincena({}); return; }
        calculoPlanillaService.getConteoPorQuincenas(ids)
            .then(setConteoPorQuincena)
            .catch((err: unknown) => Logger.error('Error al cargar conteo de empleados por quincena', {}, err));
    }, [cerradasConCorrelativo]);

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            {isLoading ? (
                <PageLoader label={t('common.loading')} />
            ) : cerradasConCorrelativo.length === 0 ? (
                <div className="bg-white rounded-lg shadow-cards border border-border p-xl text-center">
                    <p className="text-body text-text-secondary">{t('quincenas.historial_empty')}</p>
                </div>
            ) : (
                <div className="flex flex-col gap-sm">
                    {cerradasConCorrelativo.map((q) => (
                        <button
                            key={q.id}
                            onClick={() => navigate(`/planilla/historial/${q.id}`)}
                            className="w-full text-left bg-white rounded-xl border border-border shadow-cards px-lg py-md flex items-center gap-md hover:border-border/80 transition-colors group"
                        >
                            <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center text-[12px] font-bold text-text-secondary shrink-0">
                                {q.correlativo}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <p className="font-semibold text-heading truncate">{q.etiqueta_estandar}</p>
                                    {q.tipo === 'aguinaldo' && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-secondary-light text-secondary-dark">
                                            <Gift size={10} /> {TIPO_QUINCENA_LABEL.aguinaldo}
                                        </span>
                                    )}
                                </div>
                                <p className="text-caption text-text-secondary mt-0.5">
                                    {fmtFecha(q.fecha_inicio)} – {fmtFecha(q.fecha_fin)} · {t('quincenas.dias_habiles_label')}: {q.dias_habiles} · {resolverEmpleadosCount(conteoPorQuincena[q.id] ?? 0, indicadores?.activos)} {t('quincenas.empleados_label')}
                                </p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                                <EstadoQuincenaBadge estado={getEstadoVisual(q)} />
                                <ChevronRight size={16} className="text-text-secondary/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
