import React, { useEffect, useState } from 'react';
import { useDispatchActions } from './useDispatchActions';
import { ORDER_STATUS, ROLES } from '../../../config/constants';
import type { OrderDTO, OrderItemDetail } from '../../../services/orderService';
import { StatusBadge } from '../../components/StatusBadge';
import { ReadOnlyOrderItemsTable } from '../../components/orders/ReadOnlyOrderItemsTable';
import { Button } from '../../components/Button';
import { InputField } from '../../components/InputField';
import { Pagination } from '../../components/Pagination';
import { PageHeader } from '../../components/PageHeader';
import { useDebounce } from '../../../hooks/useDebounce';
import {
    Package, PackageCheck, Loader2, RefreshCw, ChevronDown, ChevronUp, StickyNote,
    MapPin, User, Phone, ExternalLink, CalendarDays, SlidersHorizontal, X,
    ArrowUp, ArrowDown, Download, Eye
} from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import { ORDER_STATUS_CONFIG } from '../../../config/constants';
import { supabase } from '../../../services/authService';
import { useToast } from '../../../context/ToastContext';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CONFIG } from '../../../config';
import { useOrderActions } from '../orders/hooks/useOrderActions';
import { PDFPreviewModal } from '../../components/orders/PDFPreviewModal';

export const DispatcherDashboard: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const {
        orders, isLoading, error, page, totalPages, totalCount, PAGE_SIZE,
        isProcessingId, setPage, fetchOrders, handleStartPreparation, handleCompleteDelivery, handleCancelOrder,
        fetchOrderItems, fetchingDetailId,
        // Filtros y Sorting
        statusFilter, setStatusFilter,
        dateFrom, setDateFrom,
        dateTo, setDateTo,
        sortBy, ascending, handleSort
    } = useDispatchActions();
    const navigate = useNavigate();
    const { showToast } = useToast();

    const [searchQuery, setSearchQuery] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const debouncedSearch = useDebounce(searchQuery, 300);

    // US-INT-04: Visor de PDF (Igual a pedidos)
    const {
        pdfState,
        pdfBlobUrl,
        pdfOrderNum,
        pdfCustomerName,
        handleViewOrder,
        handleClosePDF,
        fetchingDetailId: pdfFetchingId
    } = useOrderActions();

    // Lógica robusta de roles para visibilidad de UI
    const userRoles = Array.from(new Set([
        ...(Array.isArray(profile?.roles) ? profile.roles : (profile?.roles ? [profile.roles] : [])),
        ...(Array.isArray(profile?.role) ? profile.role : (profile?.role ? [profile.role] : []))
    ].map(r => String(r).toLowerCase().trim()).filter(Boolean)));

    // Estado local para los items expandidos (Accordion)
    const [expandedRows, setExpandedRows] = useState<Record<string, OrderItemDetail[]>>({});

    // Estado para Confirmación de Estados (US-HIS-01 / US-ORD-07 CA5)
    const [confirmState, setConfirmState] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        confirmLabel: string;
        variant: 'primary' | 'danger' | 'warning' | 'success';
        onConfirm: () => void;
    }>({
        isOpen: false,
        title: '',
        message: '',
        confirmLabel: '',
        variant: 'primary',
        onConfirm: () => { }
    });

    useEffect(() => {
        fetchOrders(page, debouncedSearch);
    }, [page, debouncedSearch, fetchOrders, statusFilter, dateFrom, dateTo, sortBy, ascending]);

    // Suscripción en Tiempo Real (Notificación para Bodeguero)
    useEffect(() => {
        const channel = supabase
            .channel('dispatch-updates')
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'orders',
                    filter: `status=eq.${ORDER_STATUS.CANCELLED}`
                },
                (payload) => {
                    const cancelledOrder = payload.new as OrderDTO;
                    showToast(`¡ATENCIÓN! El pedido ${cancelledOrder.order_number} ha sido CANCELADO por administración.`, 'warning');
                    // Refrescar para limpiar la lista
                    fetchOrders(page, debouncedSearch, false);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [page, debouncedSearch, fetchOrders, showToast]);

    const handleExpandRow = async (order: OrderDTO) => {
        // Si ya está expandido, lo cerramos
        if (expandedRows[order.id]) {
            const newRows = { ...expandedRows };
            delete newRows[order.id];
            setExpandedRows(newRows);
            return;
        }

        // Si el pedido ya trae los ítems (eager loading), los usamos directamente
        if (order.order_items && order.order_items.length > 0) {
            setExpandedRows(prev => ({
                ...prev,
                [order.id]: order.order_items!
            }));
            return;
        }

        // Fallback: Si no están cargados, fetchear items
        const items = await fetchOrderItems(order.id);
        setExpandedRows(prev => ({
            ...prev,
            [order.id]: items
        }));
    };

    const handlePageChange = (newPage: number) => {
        setPage(newPage);
        // Opcional: hacer scroll al inicio de la tabla
        document.getElementById('dispatcher-table-top')?.scrollIntoView({ behavior: 'smooth' });
    };


    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            <PageHeader
                icon={Package}
                title={t('dispatch.header_title')}
                description={t('dispatch.header_desc')}
            />

            <ConfirmModal
                isOpen={confirmState.isOpen}
                onClose={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
                onConfirm={() => {
                    confirmState.onConfirm();
                    setConfirmState(prev => ({ ...prev, isOpen: false }));
                }}
                title={confirmState.title}
                message={confirmState.message}
                confirmLabel={confirmState.confirmLabel}
                variant={confirmState.variant as any}
                Icon={Package}
                isLoading={isProcessingId !== null}
            />

            {error && (
                <div className="p-sm bg-error/10 border border-error/20 rounded-md text-error text-caption font-medium">
                    {error}
                </div>
            )}

            <div className="bg-white rounded-lg shadow-cards border border-border overflow-hidden flex flex-col w-full flex-1">
                {/* ── Toolbar ── */}
                <div className="bg-surface/80 border-b border-border p-md flex flex-row gap-sm items-center justify-between">
                    <InputField
                        isSearch
                        placeholder={t('dispatch.search_placeholder', { prefix: CONFIG.ORDER_PREFIX.replace('-', '') })}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onClear={() => { setSearchQuery(''); setPage(1); }}
                        className="flex-1 min-w-0"
                    />

                    <button
                        onClick={() => setShowFilters(v => !v)}
                        title={t('common.filters')}
                        className={`flex items-center gap-1.5 h-[42px] px-3 rounded-lg border text-caption font-semibold transition-all shrink-0
                            ${showFilters
                                ? 'bg-primary/10 border-primary text-primary'
                                : 'border-border text-text-secondary hover:border-primary hover:text-primary hover:bg-primary/5'
                            }`}
                    >
                        <SlidersHorizontal size={16} />
                        <span className="hidden sm:inline">{t('common.filters')}</span>
                        {(statusFilter || dateFrom || dateTo) && (
                            <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                        )}
                    </button>

                    <Button
                        onClick={() => fetchOrders(1, debouncedSearch, false)}
                        className="flex items-center justify-center p-sm md:px-md shadow-sm shrink-0"
                        disabled={isLoading}
                        title={t('dispatch.btn_refresh')}
                    >
                        <RefreshCw size={20} className={isLoading ? 'animate-spin sm:mr-2' : 'sm:mr-2'} />
                        <span className="hidden sm:inline-block">{t('dispatch.btn_refresh')}</span>
                    </Button>
                </div>

                {/* ── Filtros Expandibles ── */}
                {showFilters && (
                    <div className="border-b border-border bg-surface/30 p-md flex flex-col gap-md animate-in slide-in-from-top-1 duration-200">
                        {/* Status Chips */}
                        <div className="flex flex-col gap-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">{t('dispatch.filter_status')}</p>
                            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                                {[
                                    { value: '', label: t('orders.all') },
                                    { value: ORDER_STATUS.APPROVED, label: t('status.approved') },
                                    { value: ORDER_STATUS.IN_PREPARATION, label: t('status.in_preparation') },
                                    { value: ORDER_STATUS.DELIVERED, label: t('status.delivered') },
                                    { value: ORDER_STATUS.CANCELLED, label: t('status.cancelled') }
                                ].map(chip => (
                                    <button
                                        key={chip.value}
                                        onClick={() => { setStatusFilter(chip.value); setPage(1); }}
                                        className={`shrink-0 inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide border transition-all duration-200
                                            ${statusFilter === chip.value
                                                ? (chip.value ? `${ORDER_STATUS_CONFIG[chip.value].chipBg} ${ORDER_STATUS_CONFIG[chip.value].chipText} ${ORDER_STATUS_CONFIG[chip.value].activeBorder}` : 'bg-primary/10 text-primary border-primary')
                                                : 'bg-white text-text-secondary border-border hover:border-primary hover:text-primary hover:bg-primary/5'
                                            }`}
                                    >
                                        {statusFilter === chip.value && chip.value && (
                                            <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${ORDER_STATUS_CONFIG[chip.value].chipText.replace('text-', 'bg-')}`} />
                                        )}
                                        {chip.label}
                                    </button>
                                ))}
                                {(statusFilter || dateFrom || dateTo) && (
                                    <button
                                        onClick={() => { setStatusFilter(''); setDateFrom(''); setDateTo(''); }}
                                        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold text-error border border-error/30 bg-error/5 hover:bg-error/10 transition-all duration-200 ml-auto"
                                    >
                                        <X size={11} /> {t('common.clear')}
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Date Range */}
                        <div className="flex flex-col sm:flex-row gap-3">
                            <div className="flex flex-col gap-1.5 flex-1">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary flex items-center gap-1">
                                    <CalendarDays size={10} /> Desde
                                </p>
                                <input
                                    type="date"
                                    value={dateFrom}
                                    onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                                    className="border border-border rounded-lg px-3 py-1.5 text-body text-heading focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white transition-all w-full"
                                />
                            </div>
                            <div className="flex flex-col gap-1.5 flex-1">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary flex items-center gap-1">
                                    <CalendarDays size={10} /> Hasta
                                </p>
                                <input
                                    type="date"
                                    value={dateTo}
                                    onChange={e => { setDateTo(e.target.value); setPage(1); }}
                                    className="border border-border rounded-lg px-3 py-1.5 text-body text-heading focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white transition-all w-full"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Desktop UI (Table) ── */}
                <div className="hidden lg:flex flex-col w-full">
                    <div id="dispatcher-table-top" />
                    <div className="relative">
                        {isLoading && orders.length > 0 && (
                            <div className="absolute inset-0 z-10 bg-white/70 flex items-center justify-center">
                                <RefreshCw size={28} className="animate-spin text-primary" />
                            </div>
                        )}
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-surface border-b border-border text-caption text-text-secondary uppercase tracking-wider">
                                    <th className="p-md font-semibold w-12"></th>
                                    <th className="p-md font-semibold w-64 cursor-pointer hover:text-primary transition-colors" onClick={() => handleSort('order_number')}>
                                        <div className="flex items-center gap-1">
                                            Pedido / Fecha
                                            {sortBy === 'order_number' ? (ascending ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : (sortBy === 'created_at' && (ascending ? <ArrowUp size={12} /> : <ArrowDown size={12} />))}
                                        </div>
                                    </th>
                                    <th className="p-md font-semibold cursor-pointer hover:text-primary transition-colors" onClick={() => handleSort('customer_id')}>
                                        <div className="flex items-center gap-1">
                                            {t('dispatch.card_customer')}
                                            {sortBy === 'customer_id' && (ascending ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                                        </div>
                                    </th>
                                    <th className="p-md font-semibold">{t('dispatch.card_items')}</th>
                                    <th className="p-md font-semibold text-center w-32 cursor-pointer hover:text-primary transition-colors" onClick={() => handleSort('status')}>
                                        <div className="flex items-center justify-center gap-1">
                                            {t('common.status')}
                                            {sortBy === 'status' && (ascending ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                                        </div>
                                    </th>
                                    <th className="p-md font-semibold text-right w-44 cursor-pointer hover:text-primary transition-colors" onClick={() => handleSort('total_amount')}>
                                        <div className="flex items-center justify-end gap-1">
                                            Total
                                            {sortBy === 'total_amount' && (ascending ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                                        </div>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {orders.map(order => {
                                    const isExpanded = !!expandedRows[order.id];
                                    const items = expandedRows[order.id];
                                    const dateObj = new Date(order.created_at);
                                    const isRowLoadingItems = fetchingDetailId === order.id;
                                    const isRowProcessing = isProcessingId === order.id;

                                    const isCancelled = order.status === ORDER_STATUS.CANCELLED;

                                    return (
                                        <React.Fragment key={order.id}>
                                            <tr className={`hover:bg-surface/50 transition-colors ${isExpanded ? 'bg-surface/30' : ''} ${isCancelled ? 'opacity-60 bg-gray-50' : ''}`}>
                                                <td className="p-md text-center">
                                                    <button onClick={() => handleExpandRow(order)} className="p-1 text-text-secondary hover:text-heading transition-colors" disabled={isRowLoadingItems}>
                                                        {isRowLoadingItems ? <Loader2 size={18} className="animate-spin" /> : (isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />)}
                                                    </button>
                                                </td>
                                                <td className="p-md">
                                                    <div className="flex flex-col gap-0.5">
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={() => navigate(`/despacho/${order.id}`)}
                                                                className="font-display font-bold text-heading hover:text-primary transition-colors text-left flex items-center gap-1.5 group"
                                                                title="Ver detalle completo"
                                                            >
                                                                {order.order_number}
                                                                <ExternalLink size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                                            </button>
                                                            <Button
                                                                size="sm"
                                                                variant="outline-secondary"
                                                                isLoading={pdfFetchingId === order.id}
                                                                onClick={(e) => { e.stopPropagation(); handleViewOrder(order); }}
                                                                title="Download/Preview PDF"
                                                                className="h-[36px] w-[36px] p-0 flex items-center justify-center shrink-0 ml-2"
                                                            >
                                                                <Download size={16} />
                                                            </Button>
                                                        </div>
                                                        <span className="text-caption text-text-secondary">
                                                            {dateObj.toLocaleDateString('es-SV', { month: 'short', day: 'numeric' })} · {dateObj.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="p-md">
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="font-bold text-heading text-sm">{order.customers?.business_name || 'Desconocido'}</span>
                                                        {order.creator && (
                                                            <span className="text-xs text-text-secondary">Vendedor: {order.creator.full_name}</span>
                                                        )}
                                                        {order.dispatcher && (
                                                            <span className="text-xs text-text-secondary">Despachador: {order.dispatcher.full_name}</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-md">
                                                    <div className="flex flex-wrap gap-1 max-w-[300px]">
                                                        {order.order_items && order.order_items.length > 0 ? (
                                                            order.order_items.slice(0, 3).map((item, i) => (
                                                                <span key={i} className="text-[10px] bg-primary/5 text-primary border border-primary/10 px-1.5 py-0.5 rounded font-bold uppercase truncate max-w-[150px] flex items-center gap-1">
                                                                    <span>{item.quantity}x {item.products?.name}</span>
                                                                    {item.products?.shipment_number && (
                                                                        <span className="opacity-60 text-[9px] font-mono">#{item.products.shipment_number}</span>
                                                                    )}
                                                                </span>
                                                            ))
                                                        ) : (
                                                            <span className="text-caption text-text-secondary italic">{t('dispatch.no_orders')}</span>
                                                        )}
                                                        {order.order_items && order.order_items.length > 3 && (
                                                            <span className="text-[10px] text-text-secondary font-bold">+{order.order_items.length - 3} más</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-md text-center">
                                                    <div className="flex justify-center flex-wrap">
                                                        <StatusBadge status={order.status} />
                                                    </div>
                                                </td>
                                                <td className="p-md text-right">
                                                    <div className="flex justify-end pr-2">
                                                        {order.status === ORDER_STATUS.APPROVED && (
                                                            <Button
                                                                size="sm"
                                                                variant="secondary"
                                                                isLoading={isRowProcessing}
                                                                onClick={() => setConfirmState({
                                                                    isOpen: true,
                                                                    title: t('dispatch.modal_start_prep_title', { folio: order.order_number }),
                                                                    message: t('dispatch.success_prep_started'),
                                                                    confirmLabel: t('common.yes'),
                                                                    variant: 'primary',
                                                                    onConfirm: () => {
                                                                        if (profile?.id) handleStartPreparation(order.id, profile.id);
                                                                    }
                                                                })}
                                                                className="flex items-center gap-1.5 min-w-[130px] border-primary/20 hover:bg-primary/5 text-primary"
                                                            >
                                                                <Package size={16} />
                                                                {t('dispatch.btn_start_prep')}
                                                            </Button>
                                                        )}
                                                        {order.status === ORDER_STATUS.IN_PREPARATION && (
                                                            <Button
                                                                variant="primary"
                                                                size="sm"
                                                                isLoading={isRowProcessing}
                                                                onClick={() => setConfirmState({
                                                                    isOpen: true,
                                                                    title: t('dispatch.modal_deliver_title', { folio: order.order_number }),
                                                                    message: t('dispatch.success_delivered'),
                                                                    confirmLabel: t('common.yes'),
                                                                    variant: 'success',
                                                                    onConfirm: () => handleCompleteDelivery(order.id)
                                                                })}
                                                                className="flex items-center gap-1.5 min-w-[130px] bg-green-600 hover:bg-green-700 border-green-600 shadow-sm"
                                                            >
                                                                <PackageCheck size={16} />
                                                                {t('dispatch.btn_confirm_delivery')}
                                                            </Button>
                                                        )}
                                                        {/* Acción: Cancelar (Admin/Supervisor sobre pedidos activos) */}
                                                        {(userRoles.includes(ROLES.ADMIN) || userRoles.includes(ROLES.SUPERVISOR)) &&
                                                            (order.status === ORDER_STATUS.APPROVED || order.status === ORDER_STATUS.IN_PREPARATION) && (
                                                                <Button
                                                                    variant="outline-danger"
                                                                    size="sm"
                                                                    isLoading={isRowProcessing}
                                                                    onClick={() => setConfirmState({
                                                                        isOpen: true,
                                                                        title: t('orders.action_cancel'),
                                                                        message: `¿Estás seguro que deseas cancelar el pedido ${order.order_number}? Esta acción devolverá los productos al inventario.`,
                                                                        confirmLabel: t('common.yes'),
                                                                        variant: 'danger',
                                                                        onConfirm: () => handleCancelOrder(order.id)
                                                                    })}
                                                                    className="flex items-center gap-1.5 ml-2"
                                                                >
                                                                    <X size={16} />
                                                                    {t('common.cancel')}
                                                                </Button>
                                                            )
                                                        }
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && items && (
                                                <tr className="bg-surface/20 border-b border-border">
                                                    <td colSpan={6} className="p-0 border-0">
                                                        <div className="p-md border-l-4 border-l-primary/60 ml-md mr-md my-sm bg-white rounded shadow-sm flex flex-col gap-md">
                                                            {/* Información Logística del Cliente */}
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-md bg-surface/50 p-md rounded-lg border border-border/50">
                                                                <div className="flex flex-col gap-xs">
                                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">{t('customers.input_address')}</p>
                                                                    <div className="flex items-start gap-2">
                                                                        <div className="p-1.5 bg-white rounded border border-border text-primary shrink-0">
                                                                            <MapPin size={14} />
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-sm font-bold text-heading leading-tight">{order.customers?.address || t('common.not_available')}</p>
                                                                            {order.customers?.department && (
                                                                                <p className="text-xs text-text-secondary mt-0.5">
                                                                                    {order.customers.department}
                                                                                    {order.customers.municipality && ` / ${order.customers.municipality}`}
                                                                                </p>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex flex-col gap-xs">
                                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">{t('customers.table_contact')} & {t('customers.table_phone')}</p>
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="p-1.5 bg-white rounded border border-border text-primary shrink-0">
                                                                            <User size={14} />
                                                                        </div>
                                                                        <div className="min-w-0">
                                                                            <p className="text-sm font-bold text-heading truncate">{order.customers?.contact_name || t('common.contact_unavailable')}</p>
                                                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                                                <Phone size={12} className="text-primary" />
                                                                                <p className="text-sm text-primary font-display font-bold tabular-nums">{order.customers?.phone || t('common.phone_unavailable')}</p>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {order.notes && (
                                                                <div className="bg-primary/5 p-sm rounded border border-primary/10 flex items-start gap-3">
                                                                    <StickyNote size={16} className="text-primary shrink-0 mt-0.5" />
                                                                    <div>
                                                                        <p className="text-[10px] font-bold uppercase tracking-wider text-primary mb-1">{t('orders.order_notes_label')}</p>
                                                                        <p className="text-sm text-heading whitespace-pre-wrap">{order.notes}</p>
                                                                    </div>
                                                                </div>
                                                            )}
                                                            <ReadOnlyOrderItemsTable items={items} />
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}

                                {orders.length === 0 && !isLoading && (
                                    <tr>
                                        <td colSpan={5} className="p-xl text-center">
                                            <div className="flex flex-col items-center justify-center opacity-70">
                                                <PackageCheck size={48} className="text-text-secondary mb-md" />
                                                <span className="text-h3 text-heading">{t('dispatch.no_orders')}</span>
                                                <span className="text-body text-text-secondary mt-1 max-w-[300px]">{t('dispatch.no_orders_desc')}</span>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* ── Mobile UI (Cards) ── */}
                <div className="lg:hidden">
                    <div className="grid grid-cols-1 gap-md p-md bg-surface/10">
                        {orders.map(order => {
                            const isExpanded = !!expandedRows[order.id];
                            const items = expandedRows[order.id];
                            const dateObj = new Date(order.created_at);
                            const isRowProcessing = isProcessingId === order.id;
                            const isCancelled = order.status === ORDER_STATUS.CANCELLED;

                            return (
                                <div key={order.id} className={`bg-white rounded-lg shadow-cards border border-border flex flex-col pb-sm overflow-hidden ${isCancelled ? 'opacity-60 grayscale-[0.3] bg-gray-50' : ''}`}>
                                    <div className="p-sm flex justify-between items-start border-b border-border/50">
                                        <div className="flex flex-col gap-1">
                                            <button
                                                onClick={() => navigate(`/despacho/${order.id}`)}
                                                className="font-display font-bold text-heading text-lg hover:text-primary transition-colors text-left flex items-center gap-1.5"
                                            >
                                                {order.order_number}
                                                <ExternalLink size={14} className="text-text-secondary/50" />
                                            </button>
                                            <span className="text-caption text-text-secondary">
                                                {dateObj.toLocaleDateString('es-SV', { month: 'short', day: 'numeric' })} · {dateObj.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        <StatusBadge status={order.status} />
                                    </div>

                                    <div className="p-sm flex flex-col gap-2 border-b border-border/50">
                                        <div className="text-sm">
                                            <span className="text-text-secondary mr-2">{t('dispatch.card_customer')}:</span>
                                            <span className="font-bold text-heading">{order.customers?.business_name || t('common.unknown')}</span>
                                        </div>
                                        {order.creator && (
                                            <div className="text-xs">
                                                <span className="text-text-secondary mr-2">{t('users.role_seller')}:</span>
                                                <span className="text-heading">{order.creator.full_name}</span>
                                            </div>
                                        )}
                                        {order.dispatcher && (
                                            <div className="text-xs">
                                                <span className="text-text-secondary mr-2">{t('users.role_dispatcher')}:</span>
                                                <span className="text-heading">{order.dispatcher.full_name}</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="px-sm pb-2 pt-1 flex flex-col gap-sm">
                                        {/* Fila 1: Acción de Workflow (Primaria) */}
                                        {order.status === ORDER_STATUS.APPROVED && (
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                isLoading={isRowProcessing}
                                                className="w-full h-11 flex items-center justify-center gap-2 border-primary/20 text-primary font-bold shadow-sm"
                                                onClick={() => setConfirmState({
                                                    isOpen: true,
                                                    title: t('dispatch.modal_start_prep_title', { folio: order.order_number }),
                                                    message: t('dispatch.success_prep_started'),
                                                    confirmLabel: t('common.yes'),
                                                    variant: 'primary',
                                                    onConfirm: () => {
                                                        if (profile?.id) handleStartPreparation(order.id, profile.id);
                                                    }
                                                })}
                                            >
                                                <Package size={20} /> {t('dispatch.btn_start_prep')}
                                            </Button>
                                        )}
                                        {order.status === ORDER_STATUS.IN_PREPARATION && (
                                            <Button
                                                variant="primary"
                                                size="sm"
                                                isLoading={isRowProcessing}
                                                className="w-full h-11 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 border-green-600 font-bold shadow-sm"
                                                onClick={() => setConfirmState({
                                                    isOpen: true,
                                                    title: '¿Confirmar Entrega?',
                                                    message: t('dispatch.success_delivered'),
                                                    confirmLabel: t('common.yes'),
                                                    variant: 'success',
                                                    onConfirm: () => handleCompleteDelivery(order.id)
                                                })}
                                            >
                                                <PackageCheck size={20} /> {t('dispatch.btn_confirm_delivery')}
                                            </Button>
                                        )}

                                        {/* Fila 2: Cancelación */}
                                        {(userRoles.includes(ROLES.ADMIN) || userRoles.includes(ROLES.SUPERVISOR)) &&
                                            (order.status === ORDER_STATUS.APPROVED || order.status === ORDER_STATUS.IN_PREPARATION) && (
                                                <Button
                                                    variant="outline-danger"
                                                    size="sm"
                                                    isLoading={isRowProcessing}
                                                    className="w-full h-10 flex items-center justify-center gap-2 font-bold"
                                                    onClick={() => setConfirmState({
                                                        isOpen: true,
                                                        title: t('orders.action_cancel'),
                                                        message: `¿Cancelar el pedido ${order.order_number}? El inventario será restaurado.`,
                                                        confirmLabel: t('common.yes'),
                                                        variant: 'danger',
                                                        onConfirm: () => handleCancelOrder(order.id)
                                                    })}
                                                >
                                                    <X size={18} /> {t('common.cancel')}
                                                </Button>
                                            )
                                        }

                                        {/* Fila 3: Acciones de Consulta (Secundarias) */}
                                        <div className="flex gap-sm">
                                            <Button
                                                variant="outline-secondary"
                                                size="sm"
                                                className="flex-1 h-10 flex items-center justify-center gap-2 font-medium"
                                                onClick={() => navigate(`/despacho/${order.id}`)}
                                            >
                                                <ExternalLink size={18} />
                                                <span className="whitespace-nowrap">{t('common.view_details')}</span>
                                            </Button>
                                            <Button
                                                variant="outline-secondary"
                                                size="sm"
                                                className="flex-1 h-10 flex items-center justify-center gap-2 font-bold"
                                                onClick={() => handleViewOrder(order)}
                                                isLoading={pdfFetchingId === order.id}
                                            >
                                                <Eye size={18} />
                                                <span>PDF</span>
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Mobile Expanded Details */}
                                    {isExpanded && items && (
                                        <div className="bg-surface/30 px-sm py-md border-t border-border flex flex-col gap-md">
                                            <div className="bg-white p-sm rounded border border-border flex flex-col gap-sm shadow-sm">
                                                <div>
                                                    <p className="text-[9px] font-bold uppercase tracking-wider text-text-secondary mb-1">{t('customers.input_address')}</p>
                                                    <p className="text-xs font-bold text-heading leading-tight">{order.customers?.address || t('common.not_available')}</p>
                                                    {order.customers?.department && (
                                                        <p className="text-[10px] text-primary font-bold mt-1">
                                                            {order.customers.department}{order.customers.municipality && ` / ${order.customers.municipality}`}
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="flex justify-between items-center pt-2 border-t border-border/50">
                                                    <div>
                                                        <p className="text-[9px] font-bold uppercase tracking-wider text-text-secondary mb-0.5">{t('customers.table_contact')}</p>
                                                        <p className="text-xs text-heading font-medium truncate max-w-[120px]">{order.customers?.contact_name || '—'}</p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-[9px] font-bold uppercase tracking-wider text-text-secondary mb-0.5">{t('customers.table_phone')}</p>
                                                        <p className="text-xs text-primary font-bold tabular-nums">{order.customers?.phone || '—'}</p>
                                                    </div>
                                                </div>
                                            </div>

                                            {order.notes && (
                                                <div className="bg-white p-sm rounded border border-border flex items-start gap-2">
                                                    <StickyNote size={14} className="text-primary shrink-0 mt-0.5" />
                                                    <div className="flex-1">
                                                        <p className="text-[9px] font-bold uppercase tracking-wider text-text-secondary mb-1">{t('orders.order_notes_label')}</p>
                                                        <p className="text-xs text-heading leading-tight">{order.notes}</p>
                                                    </div>
                                                </div>
                                            )}
                                            <ReadOnlyOrderItemsTable items={items} />
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {orders.length === 0 && !isLoading && (
                            <div className="p-xl text-center flex flex-col items-center opacity-70">
                                <PackageCheck size={48} className="text-text-secondary mb-md" />
                                <span className="font-bold text-heading">{t('dispatch.no_orders')}</span>
                            </div>
                        )}

                        {isLoading && orders.length === 0 && (
                            <div className="p-xl text-center flex flex-col items-center">
                                <Loader2 size={32} className="animate-spin text-primary mb-md" />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {totalPages > 1 && (
                <div className="border-t border-border p-md">
                    <Pagination
                        currentPage={page}
                        totalPages={totalPages}
                        totalItems={totalCount}
                        pageSize={PAGE_SIZE}
                        onPageChange={handlePageChange}
                    />
                </div>
            )}
            {/* 6. PDF Viewer Modal (US-INT-04) */}
            {pdfState === 'previewing' && pdfBlobUrl && (
                <PDFPreviewModal
                    blobUrl={pdfBlobUrl}
                    orderNumber={pdfOrderNum || 'PDF'}
                    customerName={pdfCustomerName || undefined}
                    onClose={handleClosePDF}
                />
            )}
        </div>
    );
};
