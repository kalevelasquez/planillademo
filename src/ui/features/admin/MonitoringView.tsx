/**
 * src/ui/features/admin/MonitoringView.tsx
 * ─────────────────────────────────────────────────────────────────
 * Panel de monitoreo técnico y de salud (US-OBS-02).
 * Muestra métricas críticas, estado de servicios y tendencias de error.
 */

import React, { useEffect, useState } from 'react';
import {
    Activity,
    AlertCircle,
    Users,
    ShoppingBag,
    TrendingUp,
    RefreshCw,
    Clock,
    ShieldCheck,
    Info
} from 'lucide-react';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { IaMonitoringSection } from './components/IaMonitoringSection';
import { monitoringService } from '../../../services/monitoringService';
import type { AdminMetrics, HealthReport } from '../../../services/monitoringService';
import { useAuthStore } from '../../../store/authStore';
import { useTranslation } from 'react-i18next';

export const MonitoringView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
    const [health, setHealth] = useState<HealthReport | null>(null);
    const [errorTrends, setErrorTrends] = useState<any[]>([]);
    const [techErrors, setTechErrors] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // Helpers para formateo de fecha sin date-fns
    const formatTime = (dateStr: string) => {
        const d = new Date(dateStr);
        return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    };

    const fetchData = async () => {
        if (!profile?.tenant_id) return;
        setRefreshing(true);
        try {
            const [m, h, t, te] = await Promise.all([
                monitoringService.getSystemMetrics(profile.tenant_id),
                monitoringService.getSystemHealth(),
                monitoringService.getErrorTrends(profile.tenant_id),
                monitoringService.getRecentTechErrors(10)
            ]);
            setMetrics(m);
            setHealth(h);
            setTechErrors(te || []);

            console.log('[Monitoring] Raw error trends:', t);

            // US-OBS-02: Normalizar tendencias para mostrar las últimas 24h completas
            const last24h = Array.from({ length: 24 }, (_, i) => {
                const date = new Date();
                date.setHours(date.getHours() - (23 - i), 0, 0, 0);
                const isoStr = date.toISOString();
                const match = t?.find((item: any) => {
                    const itemDate = new Date(item.hour_timestamp);
                    // Match por hora y fecha (más seguro)
                    return itemDate.getHours() === date.getHours() && itemDate.getDate() === date.getDate();
                });
                return {
                    hour_timestamp: isoStr,
                    error_count: match ? match.error_count : 0
                };
            });
            console.log('[Monitoring] Normalized error trends:', last24h);
            setErrorTrends(last24h);
        } catch (error) {
            console.error('Error fetching monitoring data:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 5 * 60 * 1000); // Polling cada 5 min
        return () => clearInterval(interval);
    }, [profile?.tenant_id]);

    if (loading) {
        return (
            <div className="flex-1 min-h-[60vh] flex flex-col items-center justify-center p-xl">
                <RefreshCw className="animate-spin text-primary mb-md" size={48} />
                <span className="text-h3 text-text-secondary">{t('monitoring.loading_metrics')}</span>
            </div>
        );
    }

    const errorCounts = errorTrends.map(t => t.error_count);
    const maxErrors = Math.max(...(errorCounts.length > 0 ? errorCounts : [0]), 5);

    return (
        <div className="flex flex-col gap-xl max-w-[1200px] mx-auto p-md md:p-lg animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-md border-b border-border pb-lg">
                <div>
                    <h1 className="text-h1 text-heading">{t('monitoring.header_title')}</h1>
                    <p className="text-body text-text-secondary">{t('monitoring.header_desc')}</p>
                </div>
                <Button
                    variant="primary"
                    onClick={fetchData}
                    isLoading={refreshing}
                    className="w-full md:w-auto"
                >
                    <RefreshCw size={18} className="mr-2" />
                    {t('monitoring.refresh_now')}
                </Button>
            </div>

            {/* Health Status Bar */}
            <Card className={`p-lg border-l-4 ${health?.status === 'UP' ? 'border-success bg-success/5' : 'border-error bg-error/5'}`}>
                <div className="flex items-center justify-between flex-wrap gap-md">
                    <div className="flex items-center gap-md">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${health?.status === 'UP' ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}`}>
                            {health?.status === 'UP' ? <ShieldCheck size={28} /> : <AlertCircle size={28} />}
                        </div>
                        <div>
                            <p className="text-[10px] uppercase tracking-wider font-bold opacity-70">{t('monitoring.system_status')}</p>
                            <h3 className="text-h3 text-heading flex items-center gap-2">
                                {health?.status === 'UP' ? t('monitoring.operational') : t('monitoring.degraded')}
                                <span className="text-[10px] font-mono bg-white/50 px-2 rounded border border-border">v{health?.version}</span>
                            </h3>
                        </div>
                    </div>
                    <div className="flex items-center gap-xl md:gap-2xl">
                        <div className="text-right">
                            <p className="text-[10px] text-text-secondary uppercase">{t('monitoring.db_latency')}</p>
                            <p className="font-mono text-h4 text-primary">{health?.services.database.latency_ms ?? '--'} ms</p>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] text-text-secondary uppercase">{t('monitoring.last_check')}</p>
                            <p className="font-mono text-body text-heading">{health ? formatTime(health.timestamp) : '--:--'}</p>
                        </div>
                    </div>
                </div>
            </Card>

            {/* Stat Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-lg">
                <StatCard
                    title={t('monitoring.orders_today')}
                    value={metrics?.orders_today ?? 0}
                    icon={<ShoppingBag size={24} />}
                    color="primary"
                    liveText={t('monitoring.live')}
                />
                <StatCard
                    title={t('monitoring.revenue_today')}
                    value={`$${(metrics?.revenue_today ?? 0).toLocaleString()}`}
                    icon={<TrendingUp size={24} />}
                    color="success"
                    liveText={t('monitoring.live')}
                />
                <StatCard
                    title={t('monitoring.active_users_24h')}
                    value={metrics?.active_users_24h ?? 0}
                    icon={<Users size={24} />}
                    color="info"
                    liveText={t('monitoring.live')}
                />
                <StatCard
                    title={t('monitoring.errors_24h')}
                    value={metrics?.errors_last_24h ?? 0}
                    icon={<AlertCircle size={24} />}
                    color={metrics?.errors_last_24h && metrics.errors_last_24h > 10 ? 'danger' : 'warning'}
                    liveText={t('monitoring.live')}
                />
            </div>

            {/* Trend Graph Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-lg">
                <Card className="lg:col-span-2 p-lg flex flex-col gap-lg h-full min-h-[400px]">
                    <div className="flex items-center justify-between border-b border-border pb-md">
                        <div className="flex items-center gap-2">
                            <Activity size={20} className="text-primary" />
                            <h2 className="text-h3 text-heading">{t('monitoring.error_trends_title')}</h2>
                        </div>
                        <span className="text-xs text-text-secondary flex items-center gap-1">
                            <Clock size={14} /> {t('monitoring.hourly_frequency')}
                        </span>
                    </div>

                    <div className="flex-1 flex items-end gap-1 md:gap-1.5 pt-xxl pb-lg relative h-full min-h-[200px]">
                        {/* Grid Lines */}
                        <div className="absolute inset-x-0 bottom-0 top-0 flex flex-col justify-between pointer-events-none z-0">
                            {[0.2, 0.4, 0.6, 0.8, 1].map(i => (
                                <div key={i} className="w-full border-t border-slate-200" style={{ height: '1px' }} />
                            ))}
                        </div>

                        {errorTrends.length > 0 ? (
                            errorTrends.map((t, idx) => {
                                const heightPc = (t.error_count / maxErrors) * 100;
                                // Mostrar hora solo cada 4 horas para no saturar
                                const hour = new Date(t.hour_timestamp).getHours();
                                const showLabel = hour % 4 === 0 || idx === 0 || idx === errorTrends.length - 1;

                                return (
                                    <div key={idx} className="flex-1 group relative flex flex-col justify-end h-full z-10 hover:bg-slate-50/50 transition-colors">
                                        <div
                                            className={`w-full transition-all duration-300 rounded-t-sm shadow-[0_-2px_4px_rgba(0,0,0,0.05)] ${t.error_count > 0 ? 'bg-error group-hover:bg-error-dark' : 'bg-slate-100/80 hover:bg-slate-200'
                                                }`}
                                            style={{ height: t.error_count > 0 ? `${Math.max(5, heightPc)}%` : '4px' }}
                                        >
                                            <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-heading text-white text-[10px] px-2.5 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 whitespace-nowrap z-50 shadow-xl border border-white/10 flex flex-col items-center">
                                                <span className="font-bold text-xs">{t.error_count} {t.error_count === 1 ? 'error' : 'errores'}</span>
                                                <span className="opacity-70">{formatTime(t.hour_timestamp)}</span>
                                                {/* Tooltip Arrow */}
                                                <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-top-[6px] border-t-heading" />
                                            </div>
                                        </div>
                                        {showLabel && (
                                            <div className="absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 text-[9px] font-bold text-text-secondary whitespace-nowrap rotate-minus-45 sm:rotate-0">
                                                {formatTime(t.hour_timestamp)}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-text-secondary/30 italic">
                                {t('monitoring.no_data_graph')}
                            </div>
                        )}
                    </div>
                    <div className="h-4" /> {/* Spacer for labels */}
                </Card>

                <Card className="p-lg flex flex-col gap-md">
                    <h3 className="text-h3 text-heading border-b border-border pb-md">{t('monitoring.service_checks')}</h3>
                    <ServiceStatus label={t('monitoring.svc_db')} status={health?.services.database.status === 'online' ? 'online' : 'critical'} stableText={t('monitoring.stable')} unstableText={t('monitoring.unstable')} failureText={t('monitoring.failure')} />
                    <ServiceStatus label={t('monitoring.svc_edge')} status="online" stableText={t('monitoring.stable')} unstableText={t('monitoring.unstable')} failureText={t('monitoring.failure')} />
                    <ServiceStatus label={t('monitoring.svc_auth')} status="online" stableText={t('monitoring.stable')} unstableText={t('monitoring.unstable')} failureText={t('monitoring.failure')} />
                    <ServiceStatus label={t('monitoring.svc_storage')} status="online" stableText={t('monitoring.stable')} unstableText={t('monitoring.unstable')} failureText={t('monitoring.failure')} />
                    <ServiceStatus label={t('monitoring.svc_billing')} status="online" stableText={t('monitoring.stable')} unstableText={t('monitoring.unstable')} failureText={t('monitoring.failure')} />

                    <div className="mt-auto pt-lg border-t border-border">
                        <div className="bg-surface p-md rounded flex items-center gap-md border border-border">
                            <Info size={20} className="text-info shrink-0" />
                            <p className="text-xs text-text-secondary leading-normal italic">
                                {t('monitoring.proactive_msg')}
                            </p>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Recent Technical Logs (US-OBS-03) (Full Width) */}
            <Card className="p-sm md:p-lg border-t-4 border-error/20">
                <div className="flex items-center justify-between border-b border-border pb-md mb-md">
                    <div className="flex items-center gap-2 text-error">
                        <AlertCircle size={20} />
                        <h2 className="text-h3 font-bold uppercase tracking-wider">{t('monitoring.tech_logs_title')}</h2>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="text-[10px] uppercase text-text-secondary border-b border-border">
                            <tr>
                                <th className="pb-sm font-bold min-w-[150px]">{t('monitoring.log_timestamp')}</th>
                                <th className="pb-sm font-bold">{t('monitoring.log_message')}</th>
                                <th className="pb-sm font-bold">{t('monitoring.log_context')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {techErrors.length > 0 ? techErrors.map((log) => (
                                <tr key={log.id} className="hover:bg-error/[0.02] transition-colors group">
                                    <td className="py-md font-mono text-xs whitespace-nowrap align-top text-text-secondary group-hover:text-heading">
                                        {new Date(log.created_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                    <td className="py-md align-top pr-md">
                                        <div className="font-bold text-heading group-hover:text-error transition-colors">{log.message}</div>
                                        {log.stack && (
                                            <div className="mt-1 text-[10px] text-text-secondary line-clamp-3 font-mono bg-surface p-1 rounded max-w-[32rem] overflow-hidden border border-border/50 group-hover:border-error/20 transition-all">
                                                {log.stack}
                                            </div>
                                        )}
                                    </td>
                                    <td className="py-md align-top">
                                        <div className="flex flex-wrap gap-1">
                                            {log.context && Object.entries(log.context).map(([k, v]) => (
                                                <span key={k} className="text-[9px] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 font-mono">
                                                    <strong className="opacity-60">{k}:</strong> {String(v)}
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan={3} className="py-xl text-center text-text-secondary italic">
                                        {t('monitoring.no_tech_errors_desc')}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>

            <IaMonitoringSection />
        </div>
    );
};

const StatCard = ({ title, value, icon, color, liveText }: { title: string, value: any, icon: any, color: 'primary' | 'success' | 'info' | 'danger' | 'warning', liveText: string }) => {
    const colorClasses = {
        primary: 'bg-primary/5 text-primary border-primary/20',
        success: 'bg-success/5 text-success border-success/20',
        info: 'bg-info/5 text-info border-info/20',
        danger: 'bg-error/5 text-error border-error/20',
        warning: 'bg-warning/5 text-amber-700 border-warning/20',
    };

    return (
        <Card className={`p-lg flex flex-col gap-sm border-b-2 shadow-sm ${colorClasses[color]}`}>
            <div className="flex items-center justify-between">
                <span className="opacity-80">{icon}</span>
                <span className="text-[8px] uppercase font-bold tracking-widest opacity-60">{liveText}</span>
            </div>
            <div>
                <p className="text-h2 font-display">{value}</p>
                <p className="text-caption font-bold opacity-80">{title}</p>
            </div>
        </Card>
    );
};

const ServiceStatus = ({ label, status, stableText, unstableText, failureText }: { label: string, status: 'online' | 'degraded' | 'critical', stableText: string, unstableText: string, failureText: string }) => {
    return (
        <div className="flex items-center justify-between p-sm rounded bg-surface/50 border border-border/50">
            <span className="text-sm font-semibold text-text-secondary">{label}</span>
            <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-bold tracking-tighter hidden md:inline">
                    {status === 'online' ? stableText : status === 'degraded' ? unstableText : failureText}
                </span>
                <div className={`w-2.5 h-2.5 rounded-full animate-pulse ${status === 'online' ? 'bg-success' : status === 'degraded' ? 'bg-warning' : 'bg-error'}`} />
            </div>
        </div>
    );
};
