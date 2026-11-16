import React, { useState, useEffect } from 'react';
import { X, History, ShoppingCart, TrendingUp, Calendar, CreditCard, ChevronRight, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { orderService, type OrderDTO } from '../../../../services/orderService';
import type { Customer } from '../../../../services/customerService';
import { Button } from '../../../components/Button';
import { StatusBadge } from '../../../components/StatusBadge';

interface CustomerHistoryModalProps {
    customer: Customer | null;
    isOpen: boolean;
    onClose: () => void;
}

export const CustomerHistoryModal: React.FC<CustomerHistoryModalProps> = ({
    customer,
    isOpen,
    onClose
}) => {
    const navigate = useNavigate();
    const [stats, setStats] = useState<{ total_orders: number; total_amount: number; avg_ticket: number } | null>(null);
    const [lastOrders, setLastOrders] = useState<OrderDTO[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (isOpen && customer?.id) {
            loadHistory();
        }
    }, [isOpen, customer?.id]);

    const loadHistory = async () => {
        if (!customer?.id) return;
        setIsLoading(true);
        try {
            const [statsRes, ordersRes] = await Promise.all([
                orderService.getCustomerStats(customer.id),
                orderService.getOrders(customer.tenant_id, 1, '', { customerId: customer.id }, 5)
            ]);
            setStats(statsRes);
            setLastOrders(ordersRes.data);
        } catch (error) {
            console.error('Error loading customer history:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleViewAllOrders = () => {
        onClose();
        navigate(`/pedidos?customer_id=${customer?.id}`);
    };

    const handleViewOrderDetail = (orderId: string) => {
        onClose();
        navigate(`/pedidos/${orderId}`);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-md bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                className="bg-white rounded-lg shadow-modals w-[95vw] md:w-[600px] max-w-full flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex justify-between items-center px-lg py-md border-b border-border bg-surface/50">
                    <div className="flex items-center gap-sm text-heading">
                        <div className="w-8 h-8 bg-primary/10 rounded-md flex items-center justify-center text-primary">
                            <History size={18} />
                        </div>
                        <div className="flex flex-col">
                            <h2 className="text-h2 leading-none">Historial del Cliente</h2>
                            <span className="text-caption text-text-secondary mt-1">{customer?.business_name}</span>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-xs text-text-secondary hover:bg-white hover:text-error rounded-sm transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-lg">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-xl gap-md">
                            <Loader2 size={40} className="animate-spin text-primary" />
                            <p className="text-body text-text-secondary">Cargando historial...</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-xl">
                            {/* Stats Grid (CA1) */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-md">
                                <div className="bg-surface rounded-xl p-md border border-border flex flex-col gap-1 items-center text-center">
                                    <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center text-primary mb-1">
                                        <ShoppingCart size={18} />
                                    </div>
                                    <span className="text-h2 font-display text-heading">{stats?.total_orders || 0}</span>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Pedidos Totales</span>
                                </div>
                                <div className="bg-surface rounded-xl p-md border border-border flex flex-col gap-1 items-center text-center">
                                    <div className="w-10 h-10 bg-success/10 rounded-full flex items-center justify-center text-success mb-1">
                                        <CreditCard size={18} />
                                    </div>
                                    <span className="text-h2 font-display text-heading">${Number(stats?.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Monto Histórico</span>
                                </div>
                                <div className="bg-surface rounded-xl p-md border border-border flex flex-col gap-1 items-center text-center">
                                    <div className="w-10 h-10 bg-accent/10 rounded-full flex items-center justify-center text-accent mb-1">
                                        <TrendingUp size={18} />
                                    </div>
                                    <span className="text-h2 font-display text-heading">${Number(stats?.avg_ticket || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Ticket Promedio</span>
                                </div>
                            </div>

                            {/* Last Orders List (CA2) */}
                            <div className="flex flex-col gap-md">
                                <h3 className="text-caption font-bold uppercase tracking-[0.1em] text-text-secondary flex items-center gap-2">
                                    <Calendar size={14} /> Últimos 5 Pedidos
                                </h3>

                                {lastOrders.length === 0 ? (
                                    <div className="text-center py-lg bg-surface/50 rounded-lg border border-dashed border-border flex flex-col items-center gap-2 text-text-secondary">
                                        <ShoppingCart size={24} className="opacity-20" />
                                        <p className="text-body italic">No se encontraron pedidos confirmados.</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col divide-y divide-border border border-border rounded-xl overflow-hidden shadow-sm bg-white">
                                        {lastOrders.map((order) => {
                                            const dateStr = new Date(order.created_at).toLocaleDateString('es-SV', {
                                                day: 'numeric',
                                                month: 'short',
                                                year: 'numeric'
                                            });
                                            return (
                                                <div
                                                    key={order.id}
                                                    className="p-md hover:bg-surface/50 transition-colors flex items-center justify-between group cursor-pointer"
                                                    onClick={() => handleViewOrderDetail(order.id)}
                                                >
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="text-heading font-medium truncate">{order.order_number}</span>
                                                        <span className="text-caption text-text-secondary">{dateStr}</span>
                                                    </div>
                                                    <div className="flex items-center gap-md">
                                                        <div className="flex flex-col items-end">
                                                            <span className="font-display font-bold text-primary">
                                                                ${Number(order.total_amount).toFixed(2)}
                                                            </span>
                                                            <StatusBadge status={order.status} />
                                                        </div>
                                                        <ChevronRight size={18} className="text-border group-hover:text-primary group-hover:translate-x-1 transition-all" />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer (CA3) */}
                <div className="p-md md:p-lg bg-surface/30 border-t border-border flex justify-between items-center shrink-0">
                    <Button variant="ghost" onClick={onClose}>
                        Cerrar
                    </Button>
                    <Button
                        onClick={handleViewAllOrders}
                        className="flex items-center gap-2"
                        disabled={isLoading || lastOrders.length === 0}
                    >
                        Ver todos los pedidos
                        <ChevronRight size={18} />
                    </Button>
                </div>
            </div>
        </div>
    );
};
