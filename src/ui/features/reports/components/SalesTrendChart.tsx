import React, { useEffect, useState, useCallback } from 'react';
import { reportService, type SalesTrendPoint } from '../../../../services/reportService';
import { useAuthStore } from '../../../../store/authStore';
import { Loader2, RefreshCw, TrendingUp } from 'lucide-react';

const PERIODS = [7, 30, 90];

export const SalesTrendChart: React.FC = () => {
    const { profile } = useAuthStore();
    const [days, setDays] = useState(7);
    const [data, setData] = useState<SalesTrendPoint[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [ChartComponents, setChartComponents] = useState<any>(null);

    // Dynamic Import per tech-stack.md (§1.3)
    useEffect(() => {
        const loadRecharts = async () => {
            try {
                const mod = await import('recharts');
                setChartComponents(mod);
            } catch (err) {
                console.error('Failed to load recharts:', err);
            }
        };
        loadRecharts();
    }, []);

    const fetchData = useCallback(async () => {
        if (!profile?.tenant_id || !profile?.id) return;
        setIsLoading(true);
        try {
            const roles = Array.from(new Set([
                ...(Array.isArray(profile?.roles) ? profile.roles : (profile?.role ? [profile.role] : []))
            ].map(r => String(r).toLowerCase().trim())));

            const result = await reportService.getSalesTrend(
                profile.tenant_id,
                profile.id,
                roles,
                days
            );
            setData(result);
        } catch (error) {
            console.error('Error fetching trend data:', error);
        } finally {
            setIsLoading(false);
        }
    }, [profile, days]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    if (!ChartComponents) {
        return (
            <div className="bg-white rounded-xl border border-border shadow-sm p-lg flex items-center justify-center min-h-[400px]">
                <div className="flex flex-col items-center gap-2">
                    <Loader2 className="animate-spin text-primary" size={32} />
                    <span className="text-caption text-text-secondary">Cargando visualización...</span>
                </div>
            </div>
        );
    }

    const {
        AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
        ResponsiveContainer
    } = ChartComponents;

    const formatCurrency = (val: number) =>
        `$${val.toLocaleString('en-US', { minimumFractionDigits: 0 })}`;

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const current = payload.find((p: any) => p.dataKey === 'current')?.value || 0;
            const previous = payload.find((p: any) => p.dataKey === 'previous')?.value || 0;
            const diff = previous > 0 ? ((current - previous) / previous) * 100 : 0;

            return (
                <div className="bg-white p-md border border-border shadow-modals rounded-lg flex flex-col gap-1 ring-1 ring-black/5">
                    <p className="text-caption font-bold text-heading mb-1">{label}</p>
                    <div className="flex items-center justify-between gap-xl">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-primary" />
                            <span className="text-[11px] text-text-secondary">Actual:</span>
                        </div>
                        <span className="text-[11px] font-bold text-heading">{formatCurrency(current)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-xl">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-text-secondary opacity-40" />
                            <span className="text-[11px] text-text-secondary">Anterior:</span>
                        </div>
                        <span className="text-[11px] font-bold text-text-secondary opacity-70">{formatCurrency(previous)}</span>
                    </div>
                    {previous > 0 && (
                        <div className={`text-[10px] font-bold mt-1 text-right pt-1 border-t border-border/50 ${diff >= 0 ? 'text-success' : 'text-error'}`}>
                            {diff >= 0 ? '▲' : '▼'} {Math.abs(diff).toFixed(1)}% vs anterior
                        </div>
                    )}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="bg-white rounded-2xl border border-border shadow-sm flex flex-col p-lg w-full min-w-0 min-h-[440px] overflow-hidden relative group">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-md mb-lg">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
                        <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
                    </div>
                    <div>
                        <h3 className="text-h3 text-heading">Tendencia Comercial</h3>
                        <p className="text-caption text-text-secondary">Ventas actuales vs periodo espejo</p>
                    </div>
                </div>

                <div className="flex items-center bg-surface p-1 rounded-lg border border-border shrink-0">
                    {PERIODS.map(p => (
                        <button
                            key={p}
                            onClick={() => setDays(p)}
                            disabled={isLoading}
                            className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all relative
                                ${days === p
                                    ? 'bg-white text-primary shadow-sm ring-1 ring-black/5'
                                    : 'text-text-secondary hover:text-heading hover:bg-white/50'
                                } ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                            {p === 7 ? 'Semana' : p === 30 ? 'Mes' : '90 días'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Chart Area */}
            <div className="flex-1 min-h-[320px] w-full relative mt-2">
                {isLoading && (
                    <div className="absolute inset-0 z-10 bg-white/40 backdrop-blur-[1px] flex items-center justify-center rounded-lg">
                        <Loader2 className="animate-spin text-primary" size={32} />
                    </div>
                )}

                {!isLoading && data.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-[350px] bg-surface/30 rounded-xl border border-dashed border-border gap-3">
                        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center text-primary/40">
                            <TrendingUp size={24} />
                        </div>
                        <div className="text-center">
                            <p className="text-body font-bold text-text-secondary">Sin datos comerciales</p>
                            <p className="text-[11px] text-text-secondary opacity-70">No hay registros suficientes para este periodo.</p>
                        </div>
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height={350} minWidth={0}>
                        <AreaChart
                            data={data}
                            margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
                        >
                            <defs>
                                <linearGradient id="colorCurrent" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#02B446" stopOpacity={0.15} />
                                    <stop offset="95%" stopColor="#02B446" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorPrevious" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#5A5A7A" stopOpacity={0.05} />
                                    <stop offset="95%" stopColor="#5A5A7A" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#E0E0E0" />
                            <XAxis
                                dataKey="label"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fill: '#5A5A7A', fontWeight: 500 }}
                                dy={10}
                                interval={days === 90 ? 14 : days === 30 ? 4 : 0}
                            />
                            <YAxis
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fill: '#5A5A7A', fontWeight: 500 }}
                                tickFormatter={(v: any) => `$${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v}`}
                            />
                            <Tooltip
                                content={<CustomTooltip />}
                                cursor={{ stroke: '#02B446', strokeWidth: 1, strokeDasharray: '3 3' }}
                            />
                            <Area
                                type="monotone"
                                dataKey="previous"
                                stroke="#5A5A7A"
                                strokeWidth={2.5}
                                strokeDasharray="8 5"
                                fillOpacity={1}
                                fill="url(#colorPrevious)"
                                opacity={0.6}
                                animationDuration={1500}
                            />
                            <Area
                                type="monotone"
                                dataKey="current"
                                stroke="#02B446"
                                strokeWidth={4}
                                fillOpacity={1}
                                fill="url(#colorCurrent)"
                                animationDuration={1500}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>

            {/* Legend Section */}
            <div className="mt-xl flex flex-wrap items-center justify-center gap-x-xl gap-y-sm pt-md border-t border-border/50">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-primary" />
                    <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Ventas Actuales</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-text-secondary opacity-40 border border-dashed border-text-secondary" />
                    <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Periodo Anterior</span>
                </div>
                <div className="hidden sm:flex items-center gap-2 ml-auto">
                    <span className="text-[9px] text-text-secondary italic">Valores expresados en USD</span>
                </div>
            </div>
        </div>
    );
};
