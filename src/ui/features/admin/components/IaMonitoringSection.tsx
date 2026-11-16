import React, { useEffect, useState } from 'react';
import { Bot, AlertTriangle } from 'lucide-react';
import { Card } from '../../../components/Card';
import { iaMonitoringService, type MetricasIaPlanilla } from '../../../../services/iaMonitoringService';
import { Logger } from '../../../../utils/logger';

/**
 * Monitoreo de extracción por IA de Anticipos/Viáticos (US-OBS-03 / IMPL-107). Sección
 * autocontenida dentro de MonitoringView.tsx — no comparte estado con el resto del panel
 * (que monitorea Pedidos) para no arriesgar su flujo de fetch ya existente.
 */
export const IaMonitoringSection: React.FC = () => {
    const [metricas, setMetricas] = useState<MetricasIaPlanilla | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        iaMonitoringService.getMetricas(30)
            .then(setMetricas)
            .catch((err: unknown) => Logger.error('Error al cargar métricas de IA de Planilla', {}, err))
            .finally(() => setIsLoading(false));
    }, []);

    const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

    return (
        <Card className="p-lg flex flex-col gap-4">
            <div className="flex items-center gap-2">
                <Bot size={16} className="text-primary" />
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                    Extracción por IA — Anticipos y Viáticos (últimos 30 días)
                </h3>
            </div>

            {isLoading ? (
                <div className="h-16 bg-surface rounded animate-pulse" />
            ) : (
                <>
                    {metricas?.fallback_hoy_supera_umbral && (
                        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm font-medium">
                            <AlertTriangle size={16} />
                            La tasa de fallback a ingreso manual de hoy superó el 30% — puede indicar degradación del servicio o un cambio en el formato del formulario físico.
                        </div>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-md">
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Invocaciones</p>
                            <p className="text-h3 font-bold text-heading">{metricas?.total_invocaciones ?? 0}</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Tasa de Éxito</p>
                            <p className="text-h3 font-bold text-heading">{pct(metricas?.tasa_exito ?? null)}</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Tasa de Fallback</p>
                            <p className="text-h3 font-bold text-heading">{pct(metricas?.tasa_fallback ?? null)}</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Timeouts</p>
                            <p className="text-h3 font-bold text-heading">{metricas?.timeouts ?? 0}</p>
                        </div>
                    </div>
                </>
            )}
        </Card>
    );
};
