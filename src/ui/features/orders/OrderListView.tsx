// [AI: BUILD_FIX_APPLIED_V1]
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../../store/authStore';
import { useOrderStore } from '../../../store/orderStore';
import { orderService } from '../../../services/orderService';
import type { OrderDTO, OrderFilters } from '../../../services/orderService';
import { useDebounce } from '../../../hooks/useDebounce';
import type { Customer } from '../../../services/customerService';
import {
    ShoppingCart, RefreshCw, FileText, Search, Loader2,
    MessageCircle, CheckCircle2, CalendarDays, X, SlidersHorizontal, Copy,
    Download, Trash2, StickyNote
} from 'lucide-react';
import { exportToExcel, formatOrdersForExcel } from '../../../utils/exportUtils';
import { ORDER_STATUS, MESSAGES, ROLES } from '../../../config/constants';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { InputField } from '../../components/InputField';
import { StatusBadge } from '../../components/StatusBadge';
import { PageHeader } from '../../components/PageHeader';
import { TableActions } from '../../components/TableActions';
import { Pagination } from '../../components/Pagination';
import { LoadMoreButton } from '../../components/LoadMoreButton';
import { PDFPreviewModal } from '../../components/orders/PDFPreviewModal';
import { WhatsAppShareModal } from './components/WhatsAppShareModal';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useOrderActions } from './hooks/useOrderActions';
import { useDispatcherStore } from '../../../store/dispatcherStore';

// ── Formateo de fecha ──────────────────────────────────────────────
function formatDateObj(dateString: string | null | undefined) {
    if (!dateString) return { date: '—', time: '—' };
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return { date: '—', time: '—' };
    return {
        date: date.toLocaleDateString('es-SV', { year: 'numeric', month: 'short', day: 'numeric' }),
        time: date.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' }),
    };
}

// El valor se maneja ahora via state en el componente para personalización

// Chips del filtro de estado: "Todos" + cada estado del enum
const STATUS_CHIPS_DATA = [
    { value: '', labelKey: 'orders.all' },
    ...Object.values(ORDER_STATUS)
        .filter(v => v !== ORDER_STATUS.PENDING)
        .map(v => ({
            value: v,
            labelKey: `status.${v.toLowerCase().replace(' ', '_')}`,
        })),
];

// ─────────────────────────────────────────────────────────────────
export const OrderListView: React.FC<{
    onResumeDraft?: (customer: Customer) => void;
    onViewDetail?: (order: OrderDTO) => void;
}> = ({ onResumeDraft, onViewDetail }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { profile } = useAuthStore();
    const [searchParams, setSearchParams] = useSearchParams();
    const customerIdParam = searchParams.get('customer_id');

    // Cargar el customer desde la fila del Draft y navegar al catálogo
    const handleResumeDraft = useCallback((order: OrderDTO) => {
        if (!order.customers || !order.customer_id) return;
        // Pre-cargar el estado del borrador específico para evitar búsquedas genéricas fallidas
        useOrderStore.getState().prepareResumeDraft(order);

        if (onResumeDraft) {
            // Pasamos el cliente para compatibilidad con la navegación de App.tsx
            const minimalCustomer = {
                id: order.customer_id,
                business_name: order.customers.business_name,
                contact_name: order.customers.contact_name ?? null,
                phone: order.customers.phone ?? null,
            } as Customer;
            onResumeDraft(minimalCustomer);
        } else {
            navigate('/catalogo');
        }
    }, [onResumeDraft, navigate]);

    // ── Lista de pedidos ─────────────────────────────────────────
    const [orders, setOrders] = useState<OrderDTO[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isFetchingMore, setIsFetchingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [pageSize, setPageSize] = useState(20);
    const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];
    const [isExporting, setIsExporting] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // ── Filtros (US-HIS-01 CA2) ──────────────────────────────────
    const [selectedStatus, setSelectedStatus] = useState('');
    const [showDateFilters, setShowDateFilters] = useState(false);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    const debouncedSearch = useDebounce(searchQuery, 300);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    const [sharingOrder, setSharingOrder] = useState<OrderDTO | null>(null);
    const { dispatchers, fetchDispatchers } = useDispatcherStore();

    // Lógica robusta de roles para visibilidad de UI
    const userRoles = Array.from(new Set([
        ...(Array.isArray(profile?.roles) ? profile.roles : (profile?.roles ? [profile.roles] : [])),
        ...(Array.isArray(profile?.role) ? profile.role : (profile?.role ? [profile.role] : []))
    ].map(r => String(r).toLowerCase().trim()).filter(Boolean)));

    useEffect(() => {
        if (profile?.tenant_id) {
            fetchDispatchers(profile.tenant_id);
        }
    }, [profile?.tenant_id, fetchDispatchers]);

    // Ref para acceder a filtros actuales en el callback sin re-crearlo
    const filtersRef = useRef<OrderFilters>({});
    filtersRef.current = {
        status: selectedStatus || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        customerId: customerIdParam || undefined,
    };

    // ── Custom Hook con Lógica Fila (JIT, PDF, WhatsApp) ─────────────
    const {
        fetchingDetailId,
        isSendingWhatsAppId,
        pdfState,
        pdfBlobUrl,
        pdfOrderNum,
        pdfCustomerName,
        handleViewOrder,
        handleWhatsAppSend,
        handleClosePDF,
        handleDeleteOrder,
        handleCancelOrder,
        handleResendBodega,
        handleDuplicateOrder,
        confirmModal,
        closeConfirmModal,
    } = useOrderActions();

    const handleOpenShareOptions = (order: OrderDTO) => {
        setSharingOrder(order);
    };

    // ── Fetch lista ───────────────────────────────────────────────
    const fetchOrders = useCallback(async (
        currentPage: number,
        search: string,
        isLoadMore = false,
        limit = pageSize
    ) => {
        if (!profile?.tenant_id) return;
        isLoadMore ? setIsFetchingMore(true) : setIsLoading(true);
        setError(null);

        try {
            const { data, count } = await orderService.getOrders(
                profile.tenant_id, currentPage, search, filtersRef.current, limit
            );
            setOrders(prev =>
                isLoadMore
                    ? [...prev, ...data.filter(d => !prev.some(p => p.id === d.id))]
                    : data
            );
            setTotalCount(count);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : MESSAGES.ERROR.FETCH_ORDERS;
            setError(msg);
        } finally {
            setIsLoading(false);
            setIsFetchingMore(false);
        }
    }, [profile?.tenant_id]); // filtersRef.current se accede via ref, no en deps

    // Re-fetch al cambiar búsqueda, cualquier filtro o el límite de página
    useEffect(() => {
        setPage(1);
        fetchOrders(1, debouncedSearch, false, pageSize);
    }, [debouncedSearch, fetchOrders, selectedStatus, dateFrom, dateTo, customerIdParam, pageSize]);

    const handleExportExcel = async () => {
        if (!profile?.tenant_id) return;
        setIsExporting(true);
        try {
            const allOrders = await orderService.getAllOrders(
                profile.tenant_id,
                debouncedSearch,
                filtersRef.current
            );
            if (allOrders.length === 0) {
                setError('No hay pedidos para exportar con los filtros actuales.');
                return;
            }
            const formatted = formatOrdersForExcel(allOrders);
            const dateStr = new Date().toISOString().split('T')[0];
            exportToExcel(formatted, `pedidos_teknergy_${dateStr}`);

            // Auditoría de Reportes (US-AUD-01)
            import('../../../services/auditService').then(({ auditService }) => {
                auditService.logAction('EXPORT', 'orders_excel');
            });
        } catch (err) {
            console.error('Error al exportar Excel:', err);
            setError('Error al exportar los datos a Excel.');
        } finally {
            setIsExporting(false);
        }
    };

    // ── Navegación ────────────────────────────────────────────────
    const handlePageChange = useCallback((newPage: number) => {
        setPage(newPage);
        fetchOrders(newPage, debouncedSearch, false);
        document.getElementById('orders-table-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [fetchOrders, debouncedSearch]);

    const handleLoadMore = useCallback(() => {
        const next = page + 1;
        setPage(next);
        fetchOrders(next, debouncedSearch, true);
    }, [fetchOrders, page, debouncedSearch]);

    // ── Limpiar todos los filtros ─────────────────────────────────
    const handleResetFilters = useCallback(() => {
        setSelectedStatus('');
        setDateFrom('');
        setDateTo('');
        setShowDateFilters(false);
        if (customerIdParam) {
            const newParams = new URLSearchParams(searchParams);
            newParams.delete('customer_id');
            setSearchParams(newParams);
        }
    }, [customerIdParam, searchParams, setSearchParams]);

    const hasActiveFilters = selectedStatus !== '' || dateFrom !== '' || dateTo !== '' || !!customerIdParam;

    // ─────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">

            <PageHeader
                icon={FileText}
                title={t('orders.header_title')}
                description={t('orders.header_desc')}
                className="mb-0 pb-md"
            />

            {error && (
                <div className="p-sm bg-error/10 border border-error/20 rounded-md text-error text-caption font-medium">
                    {error}
                </div>
            )}

            <div className="bg-white rounded-lg shadow-cards border border-border overflow-hidden flex flex-col w-full flex-1">

                {/* ── Toolbar: Búsqueda + Botón Filtros + Actualizar ── */}
                {(orders.length > 0 || searchQuery || isLoading || hasActiveFilters) && (
                    <div className="sticky top-0 z-20 bg-surface/80 backdrop-blur-sm border-b border-border p-md flex flex-row gap-sm items-center justify-between animate-in fade-in slide-in-from-top-2 duration-300">
                        <InputField
                            isSearch
                            placeholder={t('orders.search_placeholder')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onClear={() => { setSearchQuery(''); setPage(1); }}
                            className="flex-1 min-w-0"
                        />
                        <button
                            onClick={() => setShowDateFilters(v => !v)}
                            title="Filtros de fecha"
                            className={`flex items-center gap-1.5 h-[42px] px-3 rounded-lg border text-caption font-semibold transition-all shrink-0
                                ${showDateFilters
                                    ? 'bg-primary/10 border-primary text-primary'
                                    : 'border-border text-text-secondary hover:border-primary hover:text-primary hover:bg-primary/5'
                                }`}
                        >
                            <CalendarDays size={16} />
                            <span className="hidden sm:inline">Fechas</span>
                        </button>

                        {(userRoles.includes(ROLES.ADMIN) || userRoles.includes(ROLES.SUPERVISOR)) && (
                            <button
                                onClick={handleExportExcel}
                                disabled={isExporting || orders.length === 0}
                                title="Exportar a Excel"
                                className="flex items-center gap-1.5 h-[42px] px-3 rounded-lg border border-success/30 text-success bg-success/5 hover:bg-success/10 hover:border-success text-caption font-semibold transition-all shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                                <span className="hidden sm:inline">Exportar</span>
                            </button>
                        )}

                        <Button
                            onClick={() => { setPage(1); fetchOrders(1, debouncedSearch, false); }}
                            className="flex items-center justify-center p-sm md:px-md shadow-sm shrink-0 h-[42px] w-auto"
                            disabled={isLoading}
                        >
                            <RefreshCw size={20} className={isLoading ? 'animate-spin sm:mr-2' : 'sm:mr-2'} />
                            <span className="hidden sm:inline-block">{t('common.refresh')}</span>
                        </Button>
                    </div>
                )}

                {/* ── Barra de Chips de Estados (Filtro Rápido) ── */}
                <div className="bg-surface/30 border-b border-border py-2 relative flex items-center">
                    <div className="flex-1 overflow-x-auto no-scrollbar scroll-smooth flex items-center gap-2 px-md pr-32">
                        {STATUS_CHIPS_DATA.map((chip) => {
                            const isActive = selectedStatus === chip.value;
                            return (
                                <button
                                    key={chip.value}
                                    onClick={() => { setSelectedStatus(chip.value); setPage(1); }}
                                    className={`px-4 py-1.5 rounded-full text-[13px] font-bold whitespace-nowrap transition-all border shrink-0
                                        ${isActive
                                            ? 'bg-primary border-primary text-white shadow-sm'
                                            : 'bg-white border-border text-text-secondary hover:border-primary/40 hover:text-primary'
                                        }`}
                                >
                                    {t(chip.labelKey as any)}
                                </button>
                            );
                        })}
                    </div>

                    {/* Botón de limpiar anclado (Efecto cristal) */}
                    {(hasActiveFilters || searchQuery) && (
                        <div className="absolute right-0 top-0 bottom-0 flex items-center pr-md pl-12 bg-gradient-to-l from-surface/90 via-surface/70 to-transparent pointer-events-none">
                            <button
                                onClick={handleResetFilters}
                                className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-border shadow-sm text-caption font-bold text-error hover:bg-error/5 hover:border-error/30 transition-all animate-in fade-in slide-in-from-right-2 duration-300"
                            >
                                <X size={14} />
                                {t('orders.clear_all')}
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Filtros de Fecha (colapsable) ── */}
                {showDateFilters && (
                    <div className="border-b border-border bg-surface/20 px-md py-3 animate-in slide-in-from-top-1 duration-200">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                            <SlidersHorizontal size={15} className="text-text-secondary shrink-0 mt-0.5 sm:mt-0" />
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-1">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <label className="text-caption text-text-secondary font-medium shrink-0 w-12">{t('orders.from')}</label>
                                    <input
                                        type="date"
                                        value={dateFrom}
                                        max={dateTo || undefined}
                                        onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                                        className="flex-1 min-w-0 border border-border rounded-lg px-3 py-1.5 text-body text-heading focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white transition-all"
                                    />
                                </div>
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <label className="text-caption text-text-secondary font-medium shrink-0 w-12">{t('orders.to')}</label>
                                    <input
                                        type="date"
                                        value={dateTo}
                                        min={dateFrom || undefined}
                                        onChange={e => { setDateTo(e.target.value); setPage(1); }}
                                        className="flex-1 min-w-0 border border-border rounded-lg px-3 py-1.5 text-body text-heading focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white transition-all"
                                    />
                                </div>
                                {(dateFrom || dateTo) && (
                                    <button
                                        onClick={() => { setDateFrom(''); setDateTo(''); }}
                                        className="sm:ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-error border border-error/20 bg-error/5 hover:bg-error/10 transition-all active:scale-95 shrink-0"
                                    >
                                        <X size={14} />
                                        <span>{t('orders.clear_dates')}</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Contenido ── */}
                {
                    isLoading && orders.length === 0 ? (
                        /* Skeletons */
                        <>
                            <div className="grid grid-cols-1 gap-md lg:hidden w-full p-md animate-pulse">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="bg-white rounded-lg shadow-cards border border-border p-md flex flex-col gap-sm">
                                        <div className="flex justify-between items-start">
                                            <div className="flex flex-col gap-2 w-1/2">
                                                <div className="h-5 bg-surface rounded w-3/4"></div>
                                                <div className="h-3 bg-surface rounded w-1/2"></div>
                                            </div>
                                            <div className="h-5 bg-surface rounded w-16"></div>
                                        </div>
                                        <div className="h-16 bg-surface rounded-md"></div>
                                        <div className="flex justify-between items-center pt-sm border-t border-border">
                                            <div className="h-3 bg-surface rounded w-8"></div>
                                            <div className="h-5 bg-surface rounded w-20"></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="hidden lg:flex flex-col animate-pulse w-full">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-surface border-b border-border">
                                            {['w-40', 'w-28', 'w-36', 'w-28', 'w-24', 'w-24', 'w-20'].map((w, i) => (
                                                <th key={i} className="p-md">
                                                    <div className={`h-3 bg-border/50 rounded ${w}`}></div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/50">
                                        {[1, 2, 3, 4, 5].map(i => (
                                            <tr key={i}>
                                                <td className="p-md"><div className="h-4 bg-surface rounded w-36"></div></td>
                                                <td className="p-md"><div className="h-4 bg-surface rounded w-24"></div></td>
                                                <td className="p-md"><div className="h-4 bg-surface rounded w-32"></div></td>
                                                <td className="p-md"><div className="h-4 bg-surface rounded w-24"></div></td>
                                                <td className="p-md"><div className="h-5 bg-surface rounded w-16"></div></td>
                                                <td className="p-md"><div className="h-5 bg-surface rounded w-16 ml-auto"></div></td>
                                                <td className="p-md"><div className="h-8 bg-surface rounded w-16 ml-auto"></div></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    ) : orders.length === 0 ? (
                        /* Estado vacío */
                        <div className="p-xl text-center flex flex-col items-center justify-center min-h-[400px]">
                            <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mb-md">
                                {searchQuery || hasActiveFilters
                                    ? <Search size={32} className="text-text-secondary/50" />
                                    : <ShoppingCart size={32} className="text-text-secondary/50" />}
                            </div>
                            <h3 className="text-h3 text-heading">
                                {searchQuery ? `${t('common.no_results')} "${searchQuery}"` : hasActiveFilters ? t('orders.no_results_filters') : t('orders.no_orders')}
                            </h3>
                            <p className="text-body text-text-secondary mt-xs max-w-[300px]">
                                {searchQuery
                                    ? t('orders.no_orders_desc_search')
                                    : hasActiveFilters
                                        ? t('orders.no_orders_desc_filters')
                                        : t('orders.no_orders_desc_empty')}
                            </p>
                            {(searchQuery || hasActiveFilters) && (
                                <Button variant="secondary" className="mt-md"
                                    onClick={() => { setSearchQuery(''); handleResetFilters(); }}>
                                    {t('orders.clear_all')}
                                </Button>
                            )}
                        </div>
                    ) : (
                        <>
                            {/* ════════════════  MOBILE — Cards  ════════════════ */}
                            <div className="lg:hidden">
                                <div className="grid grid-cols-1 gap-md p-md bg-surface/10">
                                    {orders.map(order => {
                                        const { date, time } = formatDateObj(order.created_at);
                                        const isLoadingItem = fetchingDetailId === order.id;
                                        const isWABusy = isSendingWhatsAppId === order.id;
                                        const isOrderDraft = order.status === ORDER_STATUS.DRAFT;
                                        return (
                                            <div key={order.id} className="bg-white rounded-lg shadow-cards border border-border p-md flex flex-col gap-sm">
                                                <div className="flex justify-between items-start">
                                                    {/* Folio clickeable (US-HIS-01 CA4) */}
                                                    <div className="flex flex-col">
                                                        <button
                                                            onClick={() => {
                                                                if (onViewDetail) onViewDetail(order);
                                                                else navigate(`/pedidos/${order.id}`);
                                                            }}
                                                            className="font-display font-bold text-heading text-lg leading-tight text-left hover:text-primary transition-colors"
                                                        >
                                                            <span translate="no">{order.order_number}</span>
                                                        </button>
                                                        <span className="text-caption text-text-secondary truncate pr-2">{date} · {time}</span>
                                                    </div>
                                                    <StatusBadge status={order.status} />
                                                </div>

                                                {/* Notas rápidas en el card (ESTÉTICA VIBRANTE) */}
                                                {order.notes && (
                                                    <div className="bg-amber-50/50 border border-amber-100 rounded-md p-2 flex items-start gap-2 animate-in fade-in slide-in-from-top-1 duration-300">
                                                        <StickyNote size={12} className="text-amber-600 shrink-0 mt-0.5" />
                                                        <p className="text-[10px] text-amber-900 leading-tight line-clamp-2 italic">
                                                            {order.notes}
                                                        </p>
                                                    </div>
                                                )}

                                                <div className="bg-surface rounded-md p-sm border border-border flex flex-col gap-xs">
                                                    <div className="flex justify-between items-center text-caption">
                                                        <span className="text-text-secondary font-medium">{t('orders.table_customer')}:</span>
                                                        <span className="font-bold text-heading truncate max-w-[200px]">{order.customers?.business_name || t('common.unknown')}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-caption">
                                                        <span className="text-text-secondary font-medium">{t('orders.table_seller')}:</span>
                                                        <span className="text-text-secondary truncate max-w-[200px]">{order.creator?.full_name || t('common.not_available')}</span>
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-center pt-sm border-t border-border">
                                                    <span className="text-body text-text-secondary uppercase text-[10px] tracking-wider font-bold">{t('common.total')}</span>
                                                    <span className="font-display font-bold text-primary text-xl">${Number(order.total_amount || 0).toFixed(2)}</span>
                                                </div>
                                                {/* Acciones mobile - GRID para llenado horizontal */}
                                                <div className="grid grid-cols-2 gap-2 pt-xs">
                                                    {isOrderDraft ? (
                                                        <>
                                                            <Button
                                                                variant="primary"
                                                                size="sm"
                                                                onClick={() => handleResumeDraft(order)}
                                                                className="flex items-center justify-center gap-1.5"
                                                            >
                                                                <CheckCircle2 size={13} strokeWidth={2.5} />
                                                                Finalizar
                                                            </Button>
                                                            <Button
                                                                variant="outline-danger"
                                                                size="sm"
                                                                disabled={isLoadingItem}
                                                                onClick={() => handleDeleteOrder(order.id, () => fetchOrders(page, debouncedSearch))}
                                                                className="flex items-center justify-center gap-1.5"
                                                            >
                                                                <Trash2 size={13} />
                                                                Eliminar
                                                            </Button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Button
                                                                variant="outline-secondary"
                                                                size="sm"
                                                                disabled={isLoadingItem}
                                                                onClick={() => handleViewOrder(order)}
                                                                className="flex items-center justify-center gap-1.5"
                                                            >
                                                                {isLoadingItem ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                                                                {t('orders.action_view_pdf')}
                                                            </Button>
                                                            <Button
                                                                variant="outline-primary"
                                                                size="sm"
                                                                disabled={isLoadingItem || isWABusy}
                                                                onClick={async () => {
                                                                    await handleWhatsAppSend(order);
                                                                }}
                                                                className="flex items-center justify-center gap-1.5"
                                                            >
                                                                {(isLoadingItem || isWABusy) ? <Loader2 size={13} className="animate-spin" /> : <MessageCircle size={13} />}
                                                                {isWABusy ? '...' : t('orders.action_whatsapp')}
                                                            </Button>
                                                            <Button
                                                                variant="outline-secondary"
                                                                size="sm"
                                                                disabled={isLoadingItem}
                                                                onClick={() => handleDuplicateOrder(order, onResumeDraft)}
                                                                className="flex items-center justify-center gap-1.5"
                                                            >
                                                                {isLoadingItem ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
                                                                Duplicar
                                                            </Button>
                                                            {/* Cancelar (Solo Admin/Supervisor + Pedido Confirmado No Entregado) */}
                                                            {(userRoles.includes(ROLES.ADMIN) || userRoles.includes(ROLES.SUPERVISOR)) && order.status !== ORDER_STATUS.CANCELLED && order.status !== ORDER_STATUS.DELIVERED && (
                                                                <Button
                                                                    variant="outline-danger"
                                                                    size="sm"
                                                                    disabled={isLoadingItem}
                                                                    onClick={() => handleCancelOrder(order.id, () => fetchOrders(page, debouncedSearch))}
                                                                    className="flex items-center justify-center gap-1.5"
                                                                >
                                                                    <X size={13} />
                                                                    Cancelar
                                                                </Button>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {page < totalPages && (
                                    <LoadMoreButton
                                        onClick={handleLoadMore}
                                        isLoading={isFetchingMore}
                                        label={t('orders.load_more')}
                                        loadingLabel={t('common.loading')}
                                    />
                                )}
                            </div>

                            {/* ════════════════  DESKTOP — Tabla  ════════════════ */}
                            <div className="hidden lg:flex flex-col overflow-hidden w-full">
                                <div id="orders-table-top" />

                                <div className="relative">
                                    {isLoading && orders.length > 0 && (
                                        <div className="absolute inset-0 z-10 bg-white/70 flex items-center justify-center">
                                            <RefreshCw size={28} className="animate-spin text-primary" />
                                        </div>
                                    )}
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="bg-surface border-b border-border text-caption text-text-secondary uppercase tracking-wider">
                                                    <th className="p-md font-semibold w-48">{t('orders.table_order_num')}</th>
                                                    <th className="p-md font-semibold">{t('orders.table_date')}</th>
                                                    <th className="p-md font-semibold">{t('orders.table_customer')}</th>
                                                    <th className="p-md font-semibold">{t('orders.table_seller')}</th>
                                                    <th className="p-md font-semibold text-center w-28">{t('orders.table_status')}</th>
                                                    <th className="p-md font-semibold text-right w-32">{t('common.total')}</th>
                                                    <th className="p-md font-semibold text-right w-28">{t('orders.table_actions')}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/50">
                                                {orders.map(order => {
                                                    const { date, time } = formatDateObj(order.created_at);
                                                    const isDraft = order.status === ORDER_STATUS.DRAFT;
                                                    const isLoadingItem = fetchingDetailId === order.id;
                                                    const isWABusy = isSendingWhatsAppId === order.id;
                                                    return (
                                                        <tr key={order.id} className="hover:bg-surface/50 transition-colors">
                                                            <td className="p-md">
                                                                {/* Folio clickeable para ver detalle (US-HIS-01 CA4) */}
                                                                <button
                                                                    onClick={() => {
                                                                        if (onViewDetail) onViewDetail(order);
                                                                        else navigate(`/pedidos/${order.id}`);
                                                                    }}
                                                                    className="font-display font-bold text-heading hover:text-primary transition-colors text-left"
                                                                >
                                                                    <span translate="no">{order.order_number}</span>
                                                                </button>
                                                            </td>
                                                            <td className="p-md">
                                                                <div className="flex flex-col">
                                                                    <span className="text-body text-heading font-medium">{date}</span>
                                                                    <span className="text-caption text-text-secondary opacity-75">{time}</span>
                                                                </div>
                                                            </td>
                                                            <td className="p-md">
                                                                <span className="font-bold text-heading">{order.customers?.business_name || t('common.unknown')}</span>
                                                            </td>
                                                            <td className="p-md text-body text-text-secondary">
                                                                {order.creator?.full_name || t('common.not_available')}
                                                            </td>
                                                            <td className="p-md text-center">
                                                                <div className="flex justify-center">
                                                                    <StatusBadge status={order.status} />
                                                                </div>
                                                            </td>
                                                            <td className="p-md text-right">
                                                                <span className="font-display font-bold text-primary">
                                                                    ${Number(order.total_amount || 0).toFixed(2)}
                                                                </span>
                                                            </td>
                                                            {/* ── Acciones con JIT spinner ── */}
                                                            <td className="p-md text-right">
                                                                <div className="flex justify-end">
                                                                    {isLoadingItem ? (
                                                                        <Loader2 size={18} className="animate-spin text-primary" />
                                                                    ) : (
                                                                        <TableActions
                                                                            visibleActions={[
                                                                                {
                                                                                    type: 'view',
                                                                                    onClick: () => handleViewOrder(order),
                                                                                    disabled: isLoadingItem,
                                                                                },
                                                                                ...(!isDraft ? [{
                                                                                    type: 'resend' as const,
                                                                                    onClick: () => handleOpenShareOptions(order),
                                                                                    disabled: isLoadingItem || isWABusy,
                                                                                }] : [{
                                                                                    type: 'finalize' as const,
                                                                                    onClick: () => handleResumeDraft(order),
                                                                                    disabled: isLoadingItem,
                                                                                }]),
                                                                                {
                                                                                    type: 'duplicate' as const,
                                                                                    onClick: () => handleDuplicateOrder(order, onResumeDraft),
                                                                                    disabled: isLoadingItem,
                                                                                },
                                                                                {
                                                                                    type: 'delete',
                                                                                    onClick: () => handleDeleteOrder(order.id, () => fetchOrders(page, debouncedSearch)),
                                                                                    disabled: order.status !== ORDER_STATUS.DRAFT,
                                                                                },
                                                                                ...((profile?.role === ROLES.ADMIN || profile?.role === ROLES.SUPERVISOR) && order.status !== ORDER_STATUS.CANCELLED && order.status !== ORDER_STATUS.DELIVERED ? [{
                                                                                    type: 'cancel' as const,
                                                                                    onClick: () => handleCancelOrder(order.id, () => fetchOrders(page, debouncedSearch)),
                                                                                    disabled: isLoadingItem,
                                                                                }] : []),
                                                                            ]}
                                                                        />
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <div className="border-t border-border p-md flex flex-col sm:flex-row items-center justify-between gap-md">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] uppercase font-bold text-text-secondary tracking-widest whitespace-nowrap">Mostrar</span>
                                        <select
                                            value={pageSize}
                                            onChange={(e) => setPageSize(Number(e.target.value))}
                                            className="bg-surface border border-border rounded px-2 py-0.5 text-xs font-bold text-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                                        >
                                            {PAGE_SIZE_OPTIONS.map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                        <span className="text-[10px] uppercase font-bold text-text-secondary tracking-widest whitespace-nowrap ml-1">por pág.</span>
                                    </div>
                                    <Pagination
                                        currentPage={page}
                                        totalPages={totalPages}
                                        totalItems={totalCount}
                                        pageSize={pageSize}
                                        onPageChange={handlePageChange}
                                    />
                                </div>
                            </div>
                        </>
                    )
                }
            </div>

            {/* ── Modal PDF (solo Desktop) ── */}
            {pdfState === 'previewing' && pdfBlobUrl && (
                <PDFPreviewModal
                    blobUrl={pdfBlobUrl}
                    orderNumber={pdfOrderNum || ''}
                    customerName={pdfCustomerName || undefined}
                    onClose={handleClosePDF}
                />
            )}

            {sharingOrder && (
                <WhatsAppShareModal
                    isOpen={!!sharingOrder}
                    onClose={() => setSharingOrder(null)}
                    order={sharingOrder}
                    dispatchers={dispatchers}
                    onSendToClient={async (o) => {
                        await handleWhatsAppSend(o);
                        setSharingOrder(null);
                    }}
                    onSendToBodega={async (o, phone) => {
                        await handleResendBodega(o, phone);
                        setSharingOrder(null);
                    }}
                    isLoading={!!isSendingWhatsAppId}
                />
            )}

            <ConfirmModal
                isOpen={confirmModal.isOpen}
                onClose={closeConfirmModal}
                onConfirm={confirmModal.onConfirm}
                title={confirmModal.title}
                message={confirmModal.message}
                confirmLabel={confirmModal.confirmLabel}
                variant={confirmModal.variant}
                Icon={confirmModal.Icon}
                isLoading={fetchingDetailId !== null}
            />
        </div>
    );
};
