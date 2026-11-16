import { useState, useCallback, useRef } from 'react';
import { Copy, Trash2, XCircle } from 'lucide-react';
import type { OrderDTO, OrderItemDetail } from '../../../../services/orderService';
import { orderService } from '../../../../services/orderService';
import { storageService } from '../../../../services/storageService';
import { useToast } from '../../../../context/ToastContext';
import { useOrderStore } from '../../../../store/orderStore';
import type { Customer } from '../../../../services/customerService';

export type PDFViewerState = 'idle' | 'previewing';

export interface ConfirmModalState {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    variant: 'primary' | 'danger' | 'warning';
    Icon: React.ElementType;
    onConfirm: () => void;
}

export interface UseOrderActionsReturn {
    // 1. Banderas de Concurrencia (UI Spinners)
    fetchingDetailId: string | null;
    isSendingWhatsAppId: string | null;

    // 2. Control de Estado Visor PDF (Desktop Modal)
    pdfState: PDFViewerState;
    pdfBlobUrl: string | null;
    pdfOrderNum: string | null;
    pdfCustomerName: string | null;

    // 3. Confirm Modal State
    confirmModal: ConfirmModalState;
    closeConfirmModal: () => void;

    // 3. Operaciones de Negocio a Nivel Fila (Row Actions)
    handleViewOrder: (order: OrderDTO, isInternal?: boolean) => Promise<void>;
    handleWhatsAppSend: (order: OrderDTO) => Promise<void>;
    handleClosePDF: () => void;
    handleDeleteOrder: (orderId: string, refreshCallback?: () => void) => Promise<void>;
    handleCancelOrder: (orderId: string, refreshCallback?: () => void) => Promise<void>;
    handleResendBodega: (order: OrderDTO, phone: string) => Promise<void>;
    handleDuplicateOrder: (order: OrderDTO, onDuplicated?: (customer: Customer) => void) => Promise<void>;
}

/**
 * @hook useOrderActions
 * Contenedor de reglas y manejo de transacciones con dependencias pesadas
 * internamente gestionadas por Dynamic Imports (lazy loading).
 */
export const useOrderActions = (): UseOrderActionsReturn => {
    const { showToast } = useToast();

    const [fetchingDetailId, setFetchingDetailId] = useState<string | null>(null);
    const [isSendingWhatsAppId, setIsSendingWhatsAppId] = useState<string | null>(null);

    const [pdfState, setPdfState] = useState<PDFViewerState>('idle');
    const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
    const [pdfOrderNum, setPdfOrderNum] = useState<string>('');
    const [pdfCustomerName, setPdfCustomerName] = useState<string | null>(null);

    const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
        isOpen: false,
        title: '',
        message: '',
        confirmLabel: '',
        variant: 'primary',
        Icon: Copy,
        onConfirm: () => { },
    });

    // JIT Cache Ref to avoid re-rendering merely for caching
    const orderItemsCache = useRef<Record<string, OrderItemDetail[]>>({});

    const fetchItemsJIT = useCallback(async (orderId: string): Promise<OrderItemDetail[]> => {
        // Cache hit
        if (orderItemsCache.current[orderId]) return orderItemsCache.current[orderId];

        setFetchingDetailId(orderId);
        try {
            const items = await orderService.getOrderItems(orderId);
            orderItemsCache.current[orderId] = items;
            return items;
        } finally {
            setFetchingDetailId(null);
        }
    }, []);

    const handleWhatsAppSend = useCallback(async (order: OrderDTO) => {
        if (!order.customers?.phone) {
            showToast('Cliente sin número de WhatsApp registrado', 'error');
            return;
        }

        setIsSendingWhatsAppId(order.id);
        try {
            const items = await fetchItemsJIT(order.id);

            const { generateOrderPDFBlob } = await import('../../../../utils/pdfUtils');
            const blob = await generateOrderPDFBlob({
                orderNumber: order.order_number,
                createdAt: order.created_at,
                customer: {
                    business_name: order.customers?.business_name ?? 'N/A',
                    contact_name: order.customers?.contact_name ?? null,
                    phone: order.customers?.phone ?? null,
                } as any,
                sellerName: order.creator?.full_name ?? 'N/A',
                subtotal: Number(order.subtotal ?? order.total_amount ?? 0),
                discount_amount: Number(order.discount_amount ?? 0),
                items: items.map(i => ({
                    product: {
                        id: i.products?.id ?? '',
                        name: i.products?.name ?? 'Producto',
                        brand: i.products?.brand ?? '',
                        caliber: i.products?.caliber ?? '',
                        quality: i.products?.quality ?? '',
                        shipment_number: i.products?.shipment_number ?? '',
                        price: Number(i.unit_price),
                        tenant_id: '', status: 'active' as const,
                        category_id: '', available_quantity: 0, created_at: '',
                    },
                    quantity: i.quantity,
                    note: i.notes ?? undefined,
                })),
                notes: order.notes ?? undefined,
                isInternal: false, // Cliente NO ve notas ni modo despacho
            });

            const safeCustomerName = (order.customers?.business_name ?? 'cliente')
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '');

            const fileName = `${order.order_number}_${safeCustomerName}.pdf`;
            const pdfUrl = await storageService.uploadOrderPDF(blob, fileName);

            const { openWhatsApp } = await import('../../../../utils/whatsappUtils');
            openWhatsApp(order.customers.phone, order, items, pdfUrl);

            // Auditoría de Compartir (US-AUD-01)
            import('../../../../services/auditService').then(({ auditService }) => {
                auditService.logAction('SHARE', 'orders', order.id);
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Error al enviar por WhatsApp';
            showToast(msg, 'error');
        } finally {
            setIsSendingWhatsAppId(null);
        }
    }, [fetchItemsJIT, showToast]);

    const handleViewOrder = useCallback(async (order: OrderDTO, isInternal: boolean = true) => {
        try {
            const items = await fetchItemsJIT(order.id);

            const { generateOrderPDFBlob } = await import('../../../../utils/pdfUtils');
            const blob = await generateOrderPDFBlob({
                orderNumber: order.order_number,
                createdAt: order.created_at,
                customer: {
                    business_name: order.customers?.business_name ?? 'N/A',
                    contact_name: order.customers?.contact_name ?? null,
                    phone: order.customers?.phone ?? null,
                } as any,
                sellerName: order.creator?.full_name ?? 'N/A',
                subtotal: Number(order.subtotal ?? order.total_amount ?? 0),
                discount_amount: Number(order.discount_amount ?? 0),
                items: items.map(i => ({
                    product: {
                        id: i.products?.id ?? '',
                        name: i.products?.name ?? 'Producto',
                        brand: i.products?.brand ?? '',
                        caliber: i.products?.caliber ?? '',
                        quality: i.products?.quality ?? '',
                        shipment_number: i.products?.shipment_number ?? '',
                        price: Number(i.unit_price),
                        tenant_id: '', status: 'active' as const,
                        category_id: '', available_quantity: 0, created_at: '',
                    },
                    quantity: i.quantity,
                    note: i.notes ?? undefined,
                })),
                notes: order.notes ?? undefined,
                isInternal: isInternal, // Determina si se ven lotes/negritas/embarques
            });

            const url = URL.createObjectURL(blob);

            if (window.innerWidth < 1024) {
                const tab = window.open(url, '_blank');
                if (!tab) {
                    const link = document.createElement('a');
                    link.href = url;
                    const safeCustomerName = (order.customers?.business_name ?? 'cliente')
                        .toLowerCase()
                        .replace(/[^a-z0-9]/g, '_')
                        .replace(/_+/g, '_')
                        .replace(/^_|_$/g, '');
                    link.download = `${order.order_number}_${safeCustomerName}.pdf`;
                    link.click();
                }
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
            } else {
                setPdfBlobUrl(url);
                setPdfOrderNum(order.order_number);
                setPdfCustomerName(order.customers?.business_name ?? null);
                setPdfState('previewing');
            }

            // Auditoría de Reportes (US-AUD-01)
            import('../../../../services/auditService').then(({ auditService }) => {
                auditService.logAction('EXPORT', 'orders_pdf', order.id);
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Error al generar el PDF';
            showToast(msg, 'error');
        }
    }, [fetchItemsJIT, showToast]);

    const handleClosePDF = useCallback(() => {
        setPdfState('idle');
        setPdfBlobUrl(null);
        setPdfCustomerName(null);
    }, []);

    const closeConfirmModal = useCallback(() => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
    }, []);

    const handleDeleteOrder = useCallback(async (orderId: string, refreshCallback?: () => void) => {
        setConfirmModal({
            isOpen: true,
            title: '¿Eliminar pedido?',
            message: 'Esta acción es irreversible y el stock se recuperará automáticamente en el sistema.',
            confirmLabel: 'Sí, Eliminar',
            variant: 'danger',
            Icon: Trash2,
            onConfirm: async () => {
                closeConfirmModal();
                setFetchingDetailId(orderId);
                try {
                    await orderService.deleteOrder(orderId);
                    showToast('Pedido eliminado permanentemente.', 'success');
                    if (refreshCallback) refreshCallback();
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : 'Error al eliminar el pedido';
                    showToast(msg, 'error');
                } finally {
                    setFetchingDetailId(null);
                }
            }
        });
    }, [showToast, closeConfirmModal]);

    const handleCancelOrder = useCallback(async (orderId: string, refreshCallback?: () => void) => {
        setConfirmModal({
            isOpen: true,
            title: '¿Cancelar este pedido?',
            message: 'Esta acción devolverá los productos al inventario y no se puede deshacer.',
            confirmLabel: 'Sí, Cancelar',
            variant: 'danger',
            Icon: XCircle,
            onConfirm: async () => {
                closeConfirmModal();
                setFetchingDetailId(orderId);
                try {
                    await orderService.cancelOrder(orderId);
                    showToast('Pedido cancelado exitosamente. El inventario ha sido restaurado.', 'success');
                    if (refreshCallback) refreshCallback();
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : 'Error al cancelar el pedido';
                    showToast(msg, 'error');
                } finally {
                    setFetchingDetailId(null);
                }
            }
        });
    }, [showToast, closeConfirmModal]);

    const handleResendBodega = useCallback(async (order: OrderDTO, phone: string) => {
        setIsSendingWhatsAppId(order.id);
        try {
            const items = await fetchItemsJIT(order.id);

            // Generar PDF interno exclusivo para bodega (US-INT-03)
            const { generateOrderPDFBlob } = await import('../../../../utils/pdfUtils');
            const blob = await generateOrderPDFBlob({
                orderNumber: order.order_number,
                createdAt: order.created_at,
                customer: {
                    business_name: order.customers?.business_name ?? 'N/A',
                } as any,
                sellerName: order.creator?.full_name ?? 'N/A',
                subtotal: Number(order.subtotal ?? order.total_amount ?? 0),
                discount_amount: Number(order.discount_amount ?? 0),
                items: items.map(i => ({
                    product: {
                        name: i.products?.name ?? 'Producto',
                        brand: i.products?.brand ?? '',
                        caliber: i.products?.caliber ?? '',
                        quality: i.products?.quality ?? '',
                        shipment_number: i.products?.shipment_number ?? '',
                        price: Number(i.unit_price),
                    } as any,
                    quantity: i.quantity,
                    note: i.notes ?? undefined,
                })),
                notes: order.notes ?? undefined,
                isInternal: true, // SIEMPRE INTERNO PARA BODEGA
            });

            // Guardar como archivo diferente para no sobrescribir la versión del cliente
             const safeCustomerName = (order.customers?.business_name ?? 'cliente')
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '');
            const fileName = `${order.order_number}_interno_${safeCustomerName}.pdf`;
            const pdfUrl = await storageService.uploadOrderPDF(blob, fileName);

            const { openWhatsApp } = await import('../../../../utils/whatsappUtils');
            openWhatsApp(phone, order, items, pdfUrl, 'bodega');

            // Auditoría de Compartir (Bodega) (US-AUD-01)
            import('../../../../services/auditService').then(({ auditService }) => {
                auditService.logAction('SHARE', 'orders_bodega', order.id);
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Error al enviar a bodega';
            showToast(msg, 'error');
        } finally {
            setIsSendingWhatsAppId(null);
        }
    }, [fetchItemsJIT, showToast]);

    const handleDuplicateOrder = useCallback(async (order: OrderDTO, onDuplicated?: (customer: Customer) => void) => {
        setConfirmModal({
            isOpen: true,
            title: `¿Duplicar pedido ${order.order_number}?`,
            message: 'Se creará un nuevo borrador con los mismos productos, notas, descuentos y precios negociados del pedido original.',
            confirmLabel: 'Sí, Duplicar',
            variant: 'primary',
            Icon: Copy,
            onConfirm: async () => {
                closeConfirmModal();
                setFetchingDetailId(order.id);
                try {
                    await useOrderStore.getState().duplicateSpecificOrder(order);

                    if (onDuplicated) {
                        const storeCustomer = useOrderStore.getState().selectedCustomer;
                        if (storeCustomer) {
                            onDuplicated(storeCustomer);
                            showToast('Pedido duplicado. Redirigiendo al borrador...', 'success');
                        } else if (order.customers) {
                            // Fallback si por alguna razón el store no se actualizó inmediatamente
                            const fallbackCustomer = {
                                id: order.customer_id!,
                                business_name: order.customers.business_name,
                                contact_name: order.customers.contact_name ?? null,
                                phone: order.customers.phone ?? null,
                            } as Customer;
                            onDuplicated(fallbackCustomer);
                            showToast('Pedido duplicado.', 'success');
                        } else {
                            showToast('Pedido duplicado, pero no se pudo identificar al cliente.', 'warning');
                        }
                    }
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : 'Error al duplicar el pedido';
                    showToast(msg, 'error');
                } finally {
                    setFetchingDetailId(null);
                }
            }
        });
    }, [showToast, closeConfirmModal]);

    return {
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
    };
}
