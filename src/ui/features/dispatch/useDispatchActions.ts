import { useState, useCallback, useRef } from 'react';
import { useAuthStore } from '../../../store/authStore';
import { orderService } from '../../../services/orderService';
import type { OrderDTO, OrderFilters } from '../../../services/orderService';
import { ORDER_STATUS } from '../../../config/constants';
import { Logger } from '../../../utils/logger';

export function useDispatchActions() {
    const { profile } = useAuthStore();
    const [orders, setOrders] = useState<OrderDTO[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isFetchingMore, setIsFetchingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);

    // Filtros y Sorting
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [dateFrom, setDateFrom] = useState<string>('');
    const [dateTo, setDateTo] = useState<string>('');
    const [sortBy, setSortBy] = useState<string>('created_at');
    const [ascending, setAscending] = useState<boolean>(false);

    // Referencia para filtros actuales (evita re-renders circulares si se usa en efectos)
    const filtersRef = useRef<OrderFilters>({});
    filtersRef.current = {
        status: statusFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined
    };

    // Estado específico de línea (bloquante por row)
    const [isProcessingId, setIsProcessingId] = useState<string | null>(null);
    const [fetchingDetailId, setFetchingDetailId] = useState<string | null>(null);

    const PAGE_SIZE = 20;

    const fetchOrders = useCallback(async (
        targetPage: number = 1,
        searchTerm: string = '',
        append: boolean = false
    ) => {
        if (!profile?.tenant_id) return;

        try {
            if (!append) setIsLoading(true);
            else setIsFetchingMore(true);

            setError(null);

            const { data, count } = await orderService.fetchOrdersForDispatch(
                profile.tenant_id,
                targetPage,
                searchTerm,
                PAGE_SIZE,
                filtersRef.current,
                sortBy,
                ascending
            );

            if (append) {
                setOrders(prev => {
                    const existingIds = new Set(prev.map(o => o.id));
                    const newUnique = data.filter(d => !existingIds.has(d.id));
                    return [...prev, ...newUnique];
                });
            } else {
                setOrders(data);
            }

            setTotalCount(count);
            setTotalPages(Math.ceil(count / PAGE_SIZE));
            setPage(targetPage);

        } catch (err: any) {
            Logger.error('Error al cargar pedidos de despacho', { tenantId: profile.tenant_id, page: targetPage, searchTerm }, err);
            setError('Error al conectar con la base de datos de despacho.');
        } finally {
            setIsLoading(false);
            setIsFetchingMore(false);
        }
    }, [profile?.tenant_id, sortBy, ascending]);

    const handleStartPreparation = async (orderId: string, userId: string) => {
        try {
            setIsProcessingId(orderId);
            setError(null);

            await orderService.startPreparation(orderId, userId);

            // Actualización optimista local
            setOrders(prev => prev.map(o =>
                o.id === orderId
                    ? { ...o, status: ORDER_STATUS.IN_PREPARATION }
                    : o
            ));

        } catch (err: any) {
            Logger.error('Error al iniciar preparación de pedido', { orderId, userId }, err);
            setError('Fallo al iniciar la preparación. Refresca la tabla.');
        } finally {
            setIsProcessingId(null);
        }
    };

    const handleCompleteDelivery = async (orderId: string) => {
        try {
            setIsProcessingId(orderId);
            setError(null);

            await orderService.completeDelivery(orderId);

            // Actualización optimista: lo movemos o lo cambiamos de estado visualmente. 
            setOrders(prev => prev.map(o =>
                o.id === orderId
                    ? { ...o, status: ORDER_STATUS.DELIVERED }
                    : o
            ));

        } catch (err: any) {
            Logger.error('Error al completar despacho de pedido', { orderId }, err);
            setError('Fallo al marcar como entregado. Refresca la tabla.');
        } finally {
            setIsProcessingId(null);
        }
    };

    const fetchOrderItemsLocal = async (orderId: string) => {
        try {
            setFetchingDetailId(orderId);
            setError(null);
            return await orderService.getOrderItems(orderId);
        } catch (err: any) {
            Logger.error('Error al cargar items de pedido (Despacho)', { orderId }, err);
            setError('Error al cargar los detalles del pedido.');
            return [];
        } finally {
            setFetchingDetailId(null);
        }
    };

    const handleSort = (field: string) => {
        if (sortBy === field) {
            setAscending(!ascending);
        } else {
            setSortBy(field);
            setAscending(false);
        }
        setPage(1);
    };

    return {
        orders,
        isLoading,
        isFetchingMore,
        error,
        page,
        totalPages,
        totalCount,
        PAGE_SIZE,
        isProcessingId,
        fetchingDetailId,
        // Filtros
        statusFilter,
        setStatusFilter,
        dateFrom,
        setDateFrom,
        dateTo,
        setDateTo,
        sortBy,
        ascending,
        handleSort,
        // Métodos
        setPage,
        fetchOrders,
        handleStartPreparation,
        handleCompleteDelivery,
        handleCancelOrder: async (orderId: string) => {
            try {
                setIsProcessingId(orderId);
                setError(null);
                await orderService.cancelOrder(orderId);
                setOrders(prev => prev.map(o =>
                    o.id === orderId ? { ...o, status: ORDER_STATUS.CANCELLED } : o
                ));
            } catch (err: any) {
                Logger.error('Error al cancelar pedido (Despacho)', { orderId }, err);
                setError('Fallo al cancelar el pedido.');
            } finally {
                setIsProcessingId(null);
            }
        },
        fetchOrderItems: fetchOrderItemsLocal
    };
}
