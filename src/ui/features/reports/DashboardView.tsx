import React, { useEffect, useState, useCallback } from 'react';
import {
    TrendingUp, ShoppingCart, DollarSign,
    Clock, Package, Users, RefreshCw, Loader2,
    ArrowUpRight, ArrowDownRight, Minus
} from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import { reportService, type DashboardKPIs } from '../../../services/reportService';
import { Button } from '../../components/Button';
import { SalesTrendChart } from './components/SalesTrendChart';

// ── Componente de Tendencia (CA4) ──────────────────────────────────
const TrendIndicator: React.FC<{ value: number; hasPrevious: boolean; currentVal?: number }> = ({ value, hasPrevious, currentVal = 0 }) => {
    // Si no hay datos previos pero hoy SÍ hay ventas (1er día de uso), mostramos +100% como tendencia positiva
    const isInitialDay = !hasPrevious && currentVal > 0;

    if (!hasPrevious && !isInitialDay) {
        return (
            <div className="flex items-center gap-1 text-text-secondary bg-surface px-2 py-0.5 rounded-full text-[10px] font-bold opacity-60" title="Información insuficiente para comparar vs ayer">
                <Minus size={10} />
                <span>N/D</span>
            </div>
        );
    }

    const effectiveValue = isInitialDay ? 100 : value;
    const isPositive = effectiveValue > 0;
    const isNegative = effectiveValue < 0;
    const absValue = Math.abs(effectiveValue).toFixed(1);

    if (isPositive) {
        return (
            <div className="flex items-center gap-1 text-success bg-success/10 px-2 py-0.5 rounded-full text-[11px] font-bold shadow-sm shadow-success/5 border border-success/10">
                <ArrowUpRight size={12} />
                <span>{absValue}%</span>
            </div>
        );
    }
    if (isNegative) {
        return (
            <div className="flex items-center gap-1 text-error bg-error/10 px-2 py-0.5 rounded-full text-[11px] font-bold shadow-sm shadow-error/5 border border-error/10">
                <ArrowDownRight size={12} />
                <span>{absValue}%</span>
            </div>
        );
    }
    return (
        <div className="flex items-center gap-1 text-text-secondary bg-surface px-2 py-0.5 rounded-full text-[11px] font-bold border border-border/50">
            <Minus size={12} />
            <span>0%</span>
        </div>
    );
};

// ── Card de KPI Individual ─────────────────────────────────────────
const KPICard: React.FC<{
    title: string;
    value: string | number;
    icon: React.ReactNode;
    trend?: number;
    hasPrevious?: boolean;
    currentRawValue?: number;
    color: 'primary' | 'success' | 'warning' | 'info';
    isLoading?: boolean;
}> = ({ title, value, icon, trend, hasPrevious, currentRawValue, color, isLoading }) => {
    const colorClasses = {
        primary: 'text-primary bg-primary/10',
        success: 'text-success bg-success/10',
        warning: 'text-warning bg-warning/10',
        info: 'text-info bg-info/10',
    };

    return (
        <div className="bg-white p-md rounded-xl border border-border shadow-sm flex flex-col gap-sm relative overflow-hidden group hover:shadow-md transition-all duration-300">
            <div className="flex justify-between items-start relative z-10">
                <div className={`p-sm rounded-lg ${colorClasses[color]} transition-transform group-hover:scale-110 duration-300 shadow-inner`}>
                    {React.cloneElement(icon as React.ReactElement<any>, { size: 20 })}
                </div>
                {trend !== undefined && !isLoading && (
                    <TrendIndicator
                        value={trend}
                        hasPrevious={!!hasPrevious}
                        currentVal={currentRawValue}
                    />
                )}
            </div>

            <div className="flex flex-col gap-0.5 relative z-10">
                <span className="text-[10px] text-text-secondary font-bold uppercase tracking-wider opacity-70">{title}</span>
                {isLoading ? (
                    <div className="h-8 w-24 bg-surface animate-pulse rounded-md" />
                ) : (
                    <h2 className="text-2xl font-display font-bold text-heading">{value}</h2>
                )}
            </div>

            {/* Subtle background decoration */}
            <div className={`absolute -right-3 -bottom-3 opacity-[0.03] ${colorClasses[color].split(' ')[0]} group-hover:scale-125 transition-transform duration-500 pointer-events-none`}>
                {React.cloneElement(icon as any, { size: 80 })}
            </div>
        </div>
    );
};

export const DashboardView: React.FC = () => {
    const { profile } = useAuthStore();
    const [stats, setStats] = useState<DashboardKPIs | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

    const loadData = useCallback(async () => {
        if (!profile?.tenant_id || !profile?.id) return;
        setIsLoading(true);
        try {
            const roles = Array.from(new Set([
                ...(Array.isArray(profile?.roles) ? profile.roles : (profile?.role ? [profile.role] : []))
            ].map(r => String(r).toLowerCase().trim())));

            const data = await reportService.getDashboardStats(
                profile.tenant_id,
                profile.id,
                roles
            );
            setStats(data);
            setLastUpdated(new Date());
        } catch (error) {
            console.error('Error loading dashboard stats:', error);
        } finally {
            setIsLoading(false);
        }
    }, [profile]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const formatCurrency = (val: number) =>
        `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return (
        <div className="flex flex-col gap-lg p-md md:p-lg animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-md border-b border-border pb-lg">
                <div className="flex items-center gap-md">
                    <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary shadow-sm border border-primary/20">
                        <TrendingUp size={28} />
                    </div>
                    <div>
                        <h1 className="text-h2 md:text-h1 text-heading">Panel de Rendimiento</h1>
                        <p className="text-caption text-text-secondary flex items-center gap-1.5 mt-1">
                            <Clock size={12} />
                            Actualizado: {lastUpdated.toLocaleTimeString()}
                        </p>
                    </div>
                </div>
                <Button
                    variant="outline-secondary"
                    onClick={loadData}
                    disabled={isLoading}
                    className="flex items-center gap-2 h-11"
                >
                    <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
                    Refrescar
                </Button>
            </div>

            {/* KPIs Grid (CA1, CA4) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
                <KPICard
                    title="Ventas del Día"
                    value={formatCurrency(stats?.today.total_sales || 0)}
                    icon={<DollarSign size={24} />}
                    trend={stats?.comparison.sales_trend}
                    hasPrevious={(stats?.comparison.previous_sales || 0) > 0}
                    currentRawValue={stats?.today.total_sales}
                    color="success"
                    isLoading={isLoading}
                />
                <KPICard
                    title="Pedidos del Día"
                    value={stats?.today.orders_count || 0}
                    icon={<ShoppingCart size={24} />}
                    trend={stats?.comparison.orders_trend}
                    hasPrevious={(stats?.comparison.previous_orders || 0) > 0}
                    currentRawValue={stats?.today.orders_count}
                    color="primary"
                    isLoading={isLoading}
                />
                <KPICard
                    title="Pedidos Pendientes"
                    value={stats?.today.pending_orders || 0}
                    icon={<Clock size={24} />}
                    color="warning"
                    isLoading={isLoading}
                />
            </div>

            {/* Gráfico de Tendencia Comercial (US-REP-02) */}
            <div className="w-full min-h-[440px]">
                <SalesTrendChart />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg mt-md">
                {/* Top 5 Productos (CA1) */}
                <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden flex flex-col">
                    <div className="p-lg border-b border-border bg-surface/50 flex justify-between items-center">
                        <h3 className="text-h3 text-heading flex items-center gap-2">
                            <Package size={20} className="text-primary" />
                            Top 5 Productos (Hoy)
                        </h3>
                    </div>
                    <div className="p-0">
                        {isLoading ? (
                            <div className="p-xl flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
                        ) : stats?.top_products.length === 0 ? (
                            <div className="p-xl text-center text-text-secondary italic">No hay ventas registradas hoy.</div>
                        ) : (
                            <div className="divide-y divide-border">
                                {stats?.top_products.map((prod, i) => (
                                    <div key={i} className="flex items-center justify-between p-md hover:bg-surface/30 transition-colors">
                                        <div className="flex items-center gap-md">
                                            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-caption">
                                                {i + 1}
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-body font-bold text-heading">{prod.name}</span>
                                                <span className="text-caption text-text-secondary">{prod.quantity} unidades vendidas</span>
                                            </div>
                                        </div>
                                        <span className="font-display font-bold text-primary">{formatCurrency(prod.total)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Top 5 Clientes (CA1) */}
                <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden flex flex-col">
                    <div className="p-lg border-b border-border bg-surface/50 flex justify-between items-center">
                        <h3 className="text-h3 text-heading flex items-center gap-2">
                            <Users size={20} className="text-success" />
                            Top 5 Clientes (Hoy)
                        </h3>
                    </div>
                    <div className="p-0">
                        {isLoading ? (
                            <div className="p-xl flex justify-center"><Loader2 className="animate-spin text-primary" /></div>
                        ) : stats?.top_customers.length === 0 ? (
                            <div className="p-xl text-center text-text-secondary italic">No hay actividad de clientes hoy.</div>
                        ) : (
                            <div className="divide-y divide-border">
                                {stats?.top_customers.map((cust, i) => (
                                    <div key={i} className="flex items-center justify-between p-md hover:bg-surface/30 transition-colors">
                                        <div className="flex items-center gap-md">
                                            <div className="w-8 h-8 rounded-full bg-success/10 text-success flex items-center justify-center font-bold text-caption">
                                                {i + 1}
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-body font-bold text-heading">{cust.name}</span>
                                                <span className="text-caption text-text-secondary">{cust.orders_count} pedidos</span>
                                            </div>
                                        </div>
                                        <span className="font-display font-bold text-success">{formatCurrency(cust.total)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
