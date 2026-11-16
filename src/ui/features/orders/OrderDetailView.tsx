import React, { useEffect, useState, useCallback } from 'react';
import {
    ArrowLeft, Package, User, Calendar, Hash,
    FileText, Loader2, AlertTriangle, StickyNote, X, Trash2, Edit2,
    Download, MessageCircle, Truck, MoreVertical, Copy, PackageCheck
} from 'lucide-react';
import { useDispatcherStore } from '../../../store/dispatcherStore';
import { BRAND } from '../../../config/brand';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../../../store/authStore';
import { useOrderActions } from '../orders/hooks/useOrderActions';
import { ROLES, ORDER_STATUS, MESSAGES } from '../../../config/constants';
import { orderService } from '../../../services/orderService';
import { useOrderStore } from '../../../store/orderStore';
import type { OrderDTO, OrderItemDetail } from '../../../services/orderService';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useDispatchActions } from '../dispatch/useDispatchActions';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../context/ToastContext';

// ── Formateo ──
function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('es-SV', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function fmtMoney(value: number | null | undefined): string {
    return `$${Number(value ?? 0).toFixed(2)}`;
}

// ─────────────────────────────────────────────────────────────────
export const OrderDetailView: React.FC<{
    order?: OrderDTO;
    onBack?: () => void;
    isDispatchView?: boolean;
}> = ({ order: propOrder, onBack, isDispatchView = false }) => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { profile } = useAuthStore();

    // Acciones de Despacho (US-HIS-01 / US-ORD-07)
    const {
        handleStartPreparation,
        handleCompleteDelivery,
        isProcessingId
    } = useDispatchActions();

    const {
        handleCancelOrder,
        handleDeleteOrder,
        handleDuplicateOrder,
        fetchingDetailId,
        confirmModal,
        closeConfirmModal
    } = useOrderActions();

    const [order, setOrder] = useState<OrderDTO | null>(propOrder || null);
    const [items, setItems] = useState<OrderItemDetail[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isFetchingOrder, setIsFetchingOrder] = useState(!propOrder);
    const [error, setError] = useState<string | null>(null);

    // Estado para Confirmación de Despacho
    const [dispatchConfirm, setDispatchConfirm] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        confirmLabel: string;
        variant: 'primary' | 'success';
        onConfirm: () => void;
    }>({
        isOpen: false,
        title: '',
        message: '',
        confirmLabel: '',
        variant: 'primary',
        onConfirm: () => { }
    });

    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const [isDispatcherSelectorOpen, setIsDispatcherSelectorOpen] = useState(false);
    const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
    const { dispatchers, fetchDispatchers } = useDispatcherStore();

    useEffect(() => {
        if (profile?.tenant_id) fetchDispatchers(profile.tenant_id);
    }, [profile?.tenant_id, fetchDispatchers]);

    // Lógica robusta de roles para visibilidad de UI (multi-role support)
    const userRoles = Array.from(new Set([
        ...(Array.isArray(profile?.roles) ? profile.roles : (profile?.roles ? [profile.roles] : [])),
        ...(Array.isArray(profile?.role) ? profile.role : (profile?.role ? [profile.role] : []))
    ].map(r => String(r).toLowerCase().trim()).filter(Boolean)));

    const isAdminOrSupervisor = userRoles.includes(ROLES.ADMIN) || userRoles.includes(ROLES.SUPERVISOR);
    const isOwner = profile?.id === order?.seller_id;
    const canEdit = (isAdminOrSupervisor || isOwner) && order?.status !== ORDER_STATUS.DELIVERED && order?.status !== ORDER_STATUS.CANCELLED && !isDispatchView;
    const canCancel = (isAdminOrSupervisor || isOwner) && order?.status !== ORDER_STATUS.CANCELLED && order?.status !== ORDER_STATUS.DELIVERED;
    const canDelete = (isAdminOrSupervisor || isOwner) && order?.status === ORDER_STATUS.DRAFT && !isDispatchView;

    const handleBack = () => {
        if (onBack) onBack();
        else if (isDispatchView) navigate('/despacho');
        else navigate('/pedidos');
    };

    // ── Exportar a PDF (Documento de Pedido) ──
    const [isExporting, setIsExporting] = useState(false);

    const exportOrderPDF = async () => {
        if (!order || items.length === 0) return;
        setIsExporting(true);
        try {
            const { downloadOrderPDF } = await import('../../../utils/pdfUtils');

            await downloadOrderPDF({
                orderNumber: order.order_number,
                createdAt: order.created_at,
                customer: {
                    business_name: order.customers?.business_name ?? 'Cliente',
                    contact_name: order.customers?.contact_name ?? null,
                    phone: order.customers?.phone ?? null,
                } as any,
                sellerName: order.creator?.full_name ?? 'Vendedor',
                subtotal: Number(order.subtotal ?? order.total_amount ?? 0),
                discount_amount: Number(order.discount_amount ?? 0),
                notes: order.notes ?? undefined,
                isInternal: true, // VERSIÓN SISTEMA / VENDEDOR
                // Las descargas del sistema son internas (con notas)
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
                    unitPrice: Number(i.unit_price),
                    note: i.notes ?? undefined,
                })),
            });
        } catch (err) {
            console.error('Error generando PDF:', err);
        } finally {
            setIsExporting(false);
        }
    };

    const shareWithCustomer = async () => {
        if (!order || items.length === 0) return;
        if (!order.customers?.phone) {
            showToast('Cliente sin número de WhatsApp registrado', 'error');
            return;
        }
        setIsExporting(true); // Re-usamos el spinner de exportación
        try {
            const { generateOrderPDFBlob } = await import('../../../utils/pdfUtils');
            const { storageService } = await import('../../../services/storageService');
            const { openWhatsApp } = await import('../../../utils/whatsappUtils');

            // 1. Generar Versión Clientes (isInternal: false)
            const blob = await generateOrderPDFBlob({
                orderNumber: order.order_number,
                createdAt: order.created_at,
                customer: {
                    business_name: order.customers?.business_name ?? 'Cliente',
                } as any,
                sellerName: order.creator?.full_name ?? 'Vendedor',
                subtotal: Number(order.subtotal ?? 0),
                discount_amount: Number(order.discount_amount ?? 0),
                isInternal: false,
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
                    unitPrice: Number(i.unit_price),
                    note: i.notes ?? undefined,
                })),
            });

            // 2. Subir a Storage
            const safeCustomerName = (order.customers?.business_name ?? 'cliente')
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '');
            const fileName = `${order.order_number}_${safeCustomerName}.pdf`;
            const pdfUrl = await storageService.uploadOrderPDF(blob, fileName);

            // 3. Abrir WhatsApp con el link
            openWhatsApp(order.customers?.phone, order, items, pdfUrl, 'client');
            setIsShareModalOpen(false);
        } catch (err) {
            console.error('Error al compartir con cliente:', err);
            showToast('Error al preparar el PDF para el cliente', 'error');
        } finally {
            setIsExporting(false);
        }
    };

    const shareWithBodega = async (dispatcherPhone?: string) => {
        if (!order || items.length === 0) return;
        try {
            const { openWhatsApp } = await import('../../../utils/whatsappUtils');
            const targetPhone = dispatcherPhone || BRAND.PHONE_BODEGA;
            openWhatsApp(targetPhone, order, items, undefined, 'bodega');
            setIsShareModalOpen(false);
        } catch (err) {
            console.error('Error al compartir con despacho:', err);
            showToast('Error al enviar a despacho', 'error');
        }
    };

    const fetchOrderData = useCallback(async () => {
        if (!id && !propOrder) return;

        setIsLoading(true);
        setError(null);

        try {
            let currentOrder = propOrder;

            // Si no tenemos el objeto order, lo buscamos por ID
            if (!currentOrder && id) {
                setIsFetchingOrder(true);
                const data = await orderService.getOrderById(id);
                if (data) {
                    currentOrder = data;
                    setOrder(currentOrder);
                } else {
                    throw new Error('Pedido no encontrado');
                }
            }

            if (currentOrder) {
                const itemData = await orderService.getOrderItems(currentOrder.id);
                console.log('[DEBUG] OrderDetailView: Loaded items', itemData);
                setItems(itemData);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : MESSAGES.ERROR.FETCH_ORDER_DETAIL;
            setError(msg);
        } finally {
            setIsLoading(false);
            setIsFetchingOrder(false);
        }
    }, [id, propOrder, profile?.tenant_id]);

    useEffect(() => {
        fetchOrderData();
    }, [fetchOrderData]);

    if (isLoading && isFetchingOrder) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
                <Loader2 size={40} className="animate-spin text-primary" />
                <p className="text-body text-text-secondary">{t('orders.loading_order')}</p>
            </div>
        );
    }

    if (error || !order) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 max-w-[28rem] mx-auto text-center px-6">
                <div className="w-16 h-16 bg-error/10 text-error rounded-full flex items-center justify-center">
                    <AlertTriangle size={32} />
                </div>
                <h2 className="text-h2 text-heading">{t('orders.error_loading_order')}</h2>
                <p className="text-body text-text-secondary">{error || t('orders.order_not_found_desc')}</p>
                <Button variant="primary" onClick={handleBack} className="mt-2">
                    {t('orders.back_to_list')}
                </Button>
            </div>
        );
    }

    const isReadOnly = order.status === ORDER_STATUS.DELIVERED;

    const subtotal = Number(order.subtotal ?? order.total_amount ?? 0);
    const discount = Number(order.discount_amount ?? 0);
    const total = Number(order.total_amount ?? 0);

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">

            {/* ── Botón Volver ── */}
            <button
                onClick={handleBack}
                className="flex items-center gap-2 text-text-secondary hover:text-primary transition-colors w-fit font-medium text-body"
            >
                <ArrowLeft size={18} />
                {isDispatchView ? t('orders.back_to_dispatch') : t('orders.back_to_orders')}
            </button>

            {/* ── Banner de solo lectura (US-HIS-01 CA6) ── */}
            {isReadOnly && (
                <div className="flex items-center gap-3 p-sm bg-[#FCAA18]/10 border border-[#FCAA18]/30 rounded-lg text-[#b37a00] animate-in slide-in-from-top-1 duration-200">
                    <AlertTriangle size={18} className="shrink-0" />
                    <p className="text-caption font-semibold">
                        {t('orders.read_only_warning')}
                    </p>
                </div>
            )}

            {/* ── Header del Pedido ── */}
            <div className="bg-white rounded-xl shadow-sm border border-border overflow-hidden">
                <div className="p-lg border-b border-border bg-surface/30">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-md mb-lg">
                        <div className="flex items-center gap-md">
                            <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary shrink-0 shadow-inner">
                                <FileText size={24} />
                            </div>
                            <div>
                                <h1 className="font-display font-black text-heading text-2xl tracking-tight leading-none mb-1">
                                    {order.order_number}
                                </h1>
                                <p className="text-caption text-text-secondary font-medium">{t('orders.detail_title')}</p>
                            </div>
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-3">
                            <StatusBadge status={order.status} />
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-y-4 gap-x-2 pt-2">
                        {/* Acciones Primarias: Compartir y Estado Principal */}
                        <div className="flex items-center gap-2">
                            <div className="flex p-1 bg-surface rounded-lg border border-border shadow-inner mr-2">
                                <button
                                    onClick={exportOrderPDF}
                                    disabled={isExporting}
                                    className="p-2 text-text-secondary hover:text-primary hover:bg-white rounded-md transition-all disabled:opacity-50"
                                    title="Descargar PDF"
                                >
                                    {isExporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                                </button>
                                <div className="w-[1px] bg-border mx-1" />
                                <button
                                    onClick={() => setIsShareModalOpen(true)}
                                    className="p-2 text-[#25D366] hover:bg-[#25D366]/10 rounded-md transition-all"
                                    title="Enviar por WhatsApp"
                                >
                                    <MessageCircle size={18} />
                                </button>
                            </div>

                            {/* Botón de Acción Principal (Despacho) */}
                            {isDispatchView && order.status === ORDER_STATUS.APPROVED && (
                                <Button
                                    size="md"
                                    variant="secondary"
                                    isLoading={isProcessingId === order.id}
                                    onClick={() => setDispatchConfirm({
                                        isOpen: true,
                                        title: t('orders.start_preparation_title'),
                                        message: t('orders.start_preparation_msg', { number: order.order_number }),
                                        confirmLabel: t('orders.action_prepare'),
                                        variant: 'primary',
                                        onConfirm: () => {
                                            if (profile?.id) handleStartPreparation(order.id, profile.id).then(() => fetchOrderData());
                                        }
                                    })}
                                    className="flex items-center gap-2 px-6 shadow-sm border-primary/10"
                                >
                                    <Package size={18} />
                                    {t('orders.action_prepare')}
                                </Button>
                            )}

                            {isDispatchView && order.status === ORDER_STATUS.IN_PREPARATION && (
                                <Button
                                    variant="primary"
                                    size="md"
                                    isLoading={isProcessingId === order.id}
                                    onClick={() => setDispatchConfirm({
                                        isOpen: true,
                                        title: t('orders.delivery_confirm_title'),
                                        message: t('orders.delivery_confirm_msg', { number: order.order_number }),
                                        confirmLabel: t('orders.action_delivered'),
                                        variant: 'success',
                                        onConfirm: () => handleCompleteDelivery(order.id).then(() => fetchOrderData())
                                    })}
                                    className="flex items-center gap-2 px-6 bg-green-600 hover:bg-green-700 shadow-sm border-none"
                                >
                                    <PackageCheck size={18} />
                                    {t('orders.action_delivered')}
                                </Button>
                            )}
                        </div>

                        {/* Menú de Acciones Secundarias */}
                        <div className="relative">
                            <div className="flex items-center gap-2">
                                {canEdit && (
                                    <Button
                                        variant="outline-primary"
                                        size="sm"
                                        onClick={() => {
                                            useOrderStore.getState().prepareEditOrder(order, items);
                                            navigate('/resumen-pedido');
                                        }}
                                        className="hidden sm:flex items-center gap-1.5"
                                    >
                                        <Edit2 size={16} />
                                        {t('common.edit')}
                                    </Button>
                                )}

                                <button
                                    onClick={() => setIsActionsMenuOpen(!isActionsMenuOpen)}
                                    className={`p-2 rounded-lg transition-all border ${isActionsMenuOpen ? 'bg-primary/10 border-primary text-primary' : 'bg-surface border-border text-text-secondary hover:bg-white'
                                        }`}
                                    title="Más acciones"
                                >
                                    <MoreVertical size={20} />
                                </button>
                            </div>

                            {/* Dropdown Menu */}
                            {isActionsMenuOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setIsActionsMenuOpen(false)} />
                                    <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl shadow-modals border border-border z-50 py-2 animate-in zoom-in-95 duration-150 origin-top-right">
                                        {canEdit && (
                                            <button
                                                onClick={() => {
                                                    useOrderStore.getState().prepareEditOrder(order, items);
                                                    navigate('/resumen-pedido');
                                                }}
                                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-heading hover:bg-primary/5 sm:hidden"
                                            >
                                                <Edit2 size={16} className="text-primary" />
                                                {t('common.edit')}
                                            </button>
                                        )}
                                        <button
                                            onClick={() => {
                                                handleDuplicateOrder(order, () => navigate('/catalogo'));
                                                setIsActionsMenuOpen(false);
                                            }}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-heading hover:bg-primary/5"
                                        >
                                            <Copy size={16} className="text-primary" />
                                            {t('orders.action_duplicate')}
                                        </button>

                                        {(canCancel || canDelete) && <div className="mx-2 my-1 border-t border-border/50" />}

                                        {canCancel && (
                                            <button
                                                onClick={() => {
                                                    handleCancelOrder(order.id, handleBack);
                                                    setIsActionsMenuOpen(false);
                                                }}
                                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50"
                                            >
                                                <X size={16} />
                                                {t('orders.action_cancel')}
                                            </button>
                                        )}
                                        {canDelete && (
                                            <button
                                                onClick={() => {
                                                    handleDeleteOrder(order.id, handleBack);
                                                    setIsActionsMenuOpen(false);
                                                }}
                                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50"
                                            >
                                                <Trash2 size={16} />
                                                {t('orders.action_delete')}
                                            </button>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── Metadata del Pedido ── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 divide-x divide-border first:border-l-0">
                    {/* Cliente */}
                    <div className="p-md flex items-start gap-3">
                        <User size={16} className="text-text-secondary shrink-0 mt-0.5" />
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary mb-0.5">{t('orders.table_customer')}</p>
                            <p className="text-body font-bold text-heading leading-snug">
                                {order.customers?.business_name ?? '—'}
                            </p>
                            {order.customers?.contact_name && (
                                <p className="text-caption text-text-secondary">{order.customers.contact_name}</p>
                            )}
                        </div>
                    </div>

                    {/* Vendedor */}
                    <div className="p-md flex items-start gap-3">
                        <Hash size={16} className="text-text-secondary shrink-0 mt-0.5" />
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary mb-0.5">{t('orders.seller')}</p>
                            <p className="text-body text-heading">
                                {order.creator?.full_name ?? '—'}
                            </p>
                        </div>
                    </div>

                    {/* Despachador */}
                    <div className="p-md flex items-start gap-3">
                        <Package size={16} className="text-text-secondary shrink-0 mt-0.5" />
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary mb-0.5">{t('orders.dispatcher')}</p>
                            <p className="text-body text-heading">
                                {order.dispatcher?.full_name ?? '—'}
                            </p>
                        </div>
                    </div>

                    {/* Fecha */}
                    <div className="p-md flex items-start gap-3">
                        <Calendar size={16} className="text-text-secondary shrink-0 mt-0.5" />
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary mb-0.5">{t('orders.creation_date')}</p>
                            <p className="text-body text-heading leading-snug">
                                {formatDate(order.created_at)}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Notas del Pedido (US-ORD-05 CA3) ── */}
            {order.notes && (
                <div className="flex items-start gap-3 p-md bg-amber-50 rounded-lg border border-amber-200 shadow-sm animate-in fade-in duration-200">
                    <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 shrink-0 mt-0.5">
                        <StickyNote size={18} />
                    </div>
                    <div>
                        <p className="text-[11px] font-extrabold uppercase tracking-widest text-amber-800 mb-1">{t('orders.order_notes_label')}</p>
                        <p className="text-sm font-medium text-amber-900 whitespace-pre-wrap leading-relaxed">{order.notes}</p>
                    </div>
                </div>
            )}

            {/* ── Tabla de Ítems ── */}
            <div className="bg-white rounded-lg shadow-cards border border-border overflow-hidden">
                <div className="p-md border-b border-border flex items-center gap-2">
                    <Package size={16} className="text-text-secondary" />
                    <h2 className="text-body font-bold text-heading">{t('orders.order_products')}</h2>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center py-xl gap-3 text-text-secondary">
                        <Loader2 size={24} className="animate-spin text-primary" />
                        <span className="text-body">{t('orders.loading_order')}</span>
                    </div>
                ) : error ? (
                    <div className="p-lg text-center flex flex-col items-center gap-sm">
                        <AlertTriangle size={32} className="text-error/50" />
                        <p className="text-body text-error font-medium">{error}</p>
                        <Button variant="secondary" onClick={fetchOrderData}>Reintentar</Button>
                    </div>
                ) : items.length === 0 ? (
                    <div className="p-lg text-center text-text-secondary">
                        <p className="text-body">Este pedido no tiene productos registrados.</p>
                    </div>
                ) : (
                    <>
                        {/* Desktop: tabla */}
                        <div className="hidden sm:block overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-surface border-b border-border text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                                        <th className="p-md">Producto</th>
                                        <th className="p-md text-center w-24">Cantidad</th>
                                        <th className="p-md text-right w-28">Precio Unit.</th>
                                        <th className="p-md text-right w-24">Dto.</th>
                                        <th className="p-md text-right w-28">Subtotal</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/50">
                                    {items.map(item => (
                                        <tr key={item.id} className="hover:bg-surface/30 transition-colors">
                                            <td className="p-md">
                                                <div className="flex flex-col gap-0.5">
                                                    <p className="font-bold text-heading text-body">
                                                        {item.products?.name ?? `ID: ${(item as any).product_id?.substring(0, 8) || 'No accesible'}`}
                                                    </p>
                                                    {/* Marca y Calibre */}
                                                    {(item.products?.brand || item.products?.caliber) && (
                                                        <p className="text-[11px] text-text-secondary">
                                                            {[item.products?.brand, item.products?.caliber, item.products?.quality]
                                                                .filter(Boolean).join(' · ')}
                                                        </p>
                                                    )}
                                                    {/* Notas de Línea */}
                                                    {item.notes && (
                                                        <div className="mt-1 flex items-start gap-1 p-1 px-2 bg-primary/5 rounded border border-primary/10 w-fit">
                                                            <StickyNote size={10} className="text-primary mt-0.5" />
                                                            <p className="text-[10px] text-primary font-medium italic">{item.notes}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-md text-center">
                                                <span className="font-display font-semibold text-heading tabular-nums">{item.quantity}</span>
                                            </td>
                                            <td className="p-md text-right">
                                                <span className="font-display font-semibold text-text-secondary text-xs tabular-nums">{fmtMoney(item.unit_price)}</span>
                                            </td>
                                            <td className="p-md text-right">
                                                {item.discount_amount && item.discount_amount > 0 ? (
                                                    <span className="text-[10px] font-bold text-error bg-error/5 px-1.5 py-0.5 rounded tabular-nums">
                                                        -{fmtMoney(item.discount_amount)}
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] text-border">—</span>
                                                )}
                                            </td>
                                            <td className="p-md text-right">
                                                <span className="font-display font-bold text-heading tabular-nums">{fmtMoney(item.total_price)}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile: cards */}
                        <div className="sm:hidden divide-y divide-border/50">
                            {items.map(item => (
                                <div key={item.id} className="p-md flex flex-col gap-xs">
                                    <p className="font-bold text-heading">
                                        {item.products?.name ?? `ID: ${(item as any).product_id?.substring(0, 8) || 'No accesible'}`}
                                    </p>
                                    {(item.products?.brand || item.products?.caliber || item.products?.shipment_number) && (
                                        <p className="text-caption text-text-secondary">
                                            {[item.products?.brand, item.products?.caliber, item.products?.quality, item.products?.shipment_number].filter(Boolean).join(' · ')}
                                        </p>
                                    )}
                                    {/* Nota por línea mobile (US-ORD-05 CA3) */}
                                    {item.notes && (
                                        <p className="text-[11px] text-primary/80 italic flex items-center gap-1">
                                            <StickyNote size={10} className="shrink-0" />
                                            {item.notes}
                                        </p>
                                    )}
                                    <div className="flex justify-between items-center mt-1">
                                        <span className="text-caption text-text-secondary">
                                            {item.quantity} × {fmtMoney(item.unit_price)}
                                        </span>
                                        <span className="font-display font-bold text-heading tabular-nums">
                                            {fmtMoney(item.total_price)}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {/* ── Totales ── */}
                {!isLoading && !error && (
                    <div className="border-t border-border bg-surface/30 p-md flex flex-col items-end gap-xs">
                        {subtotal !== total && (
                            <>
                                <div className="flex items-center gap-8 text-body">
                                    <span className="text-text-secondary">Subtotal</span>
                                    <span className="font-display font-semibold text-heading tabular-nums w-28 text-right">
                                        {fmtMoney(subtotal)}
                                    </span>
                                </div>
                                {discount > 0 && (
                                    <div className="flex items-center gap-8 text-body">
                                        <span className="text-text-secondary">Descuento</span>
                                        <span className="font-display font-semibold text-error tabular-nums w-28 text-right">
                                            −{fmtMoney(discount)}
                                        </span>
                                    </div>
                                )}
                            </>
                        )}
                        <div className="flex items-center gap-8 pt-xs border-t border-border mt-xs w-full justify-end">
                            <span className="text-body font-bold text-heading uppercase tracking-wide text-sm">Total</span>
                            <span className="font-display font-bold text-primary text-2xl tabular-nums w-28 text-right">
                                {fmtMoney(total)}
                            </span>
                        </div>
                    </div>
                )}
            </div>

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

            {/* Modales de Compartir WhatsApp */}
            {isShareModalOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-md bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-lg shadow-modals w-full max-w-[400px] animate-in zoom-in-95 duration-200 overflow-hidden border border-border">
                        <div className="px-lg py-md border-b border-border bg-surface/50 flex justify-between items-center">
                            <h3 className="text-h3 text-heading">Notificar Pedido</h3>
                            <button onClick={() => setIsShareModalOpen(false)} className="text-text-secondary">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-lg flex flex-col gap-md">
                            <p className="text-caption text-text-secondary uppercase font-bold tracking-wider">{t('orders.notification_actions')}</p>

                            <button
                                onClick={shareWithCustomer}
                                className="w-full bg-[#25D366] hover:bg-[#128C7E] text-white rounded-md py-sm px-md flex justify-center items-center gap-sm font-bold transition-colors cursor-pointer"
                            >
                                <MessageCircle size={20} />
                                Enviar al Cliente
                            </button>

                            <button
                                onClick={() => {
                                    if (dispatchers.length > 0) {
                                        setIsDispatcherSelectorOpen(true);
                                    } else {
                                        shareWithBodega();
                                    }
                                }}
                                className="w-full bg-surface border border-border hover:bg-surface/70 text-heading rounded-md py-sm px-md flex justify-center items-center gap-sm font-bold transition-colors cursor-pointer"
                            >
                                <Truck size={20} className="text-primary" />
                                Enviar a Despacho
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isDispatcherSelectorOpen && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-md bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-lg shadow-modals w-full max-w-[360px] animate-in zoom-in-95 duration-200">
                        <div className="px-lg py-md border-b border-border bg-surface/50 flex justify-between items-center">
                            <h3 className="text-h3 text-heading">{t('orders.select_dispatcher')}</h3>
                            <button onClick={() => setIsDispatcherSelectorOpen(false)} className="text-text-secondary">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-sm flex flex-col gap-xs max-h-[300px] overflow-y-auto">
                            {dispatchers.map(d => (
                                <button
                                    key={d.id}
                                    onClick={() => {
                                        shareWithBodega(d.phone);
                                        setIsDispatcherSelectorOpen(false);
                                    }}
                                    className="flex items-center gap-md p-md rounded-md hover:bg-primary/5 border border-transparent hover:border-primary/20 transition-all text-left"
                                >
                                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                                        <Truck size={20} />
                                    </div>
                                    <div>
                                        <p className="font-bold text-heading text-sm">{d.name}</p>
                                        <p className="text-xs text-text-secondary">{d.phone}</p>
                                    </div>
                                </button>
                            ))}
                            <button
                                onClick={() => {
                                    shareWithBodega();
                                    setIsDispatcherSelectorOpen(false);
                                }}
                                className="flex items-center gap-md p-md rounded-md hover:bg-primary/5 border border-transparent hover:border-primary/20 transition-all text-left mt-1 border-t-border"
                            >
                                <div className="w-10 h-10 rounded-full bg-surface flex items-center justify-center text-text-secondary shrink-0">
                                    <Package size={20} />
                                </div>
                                <div>
                                    <p className="font-bold text-heading text-sm">{t('orders.default_dispatcher')}</p>
                                    <p className="text-xs text-text-secondary">{t('orders.default_dispatcher_help')}</p>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={dispatchConfirm.isOpen}
                onClose={() => setDispatchConfirm(prev => ({ ...prev, isOpen: false }))}
                onConfirm={() => {
                    dispatchConfirm.onConfirm();
                    setDispatchConfirm(prev => ({ ...prev, isOpen: false }));
                }}
                title={dispatchConfirm.title}
                message={dispatchConfirm.message}
                confirmLabel={dispatchConfirm.confirmLabel}
                variant={dispatchConfirm.variant}
                Icon={Package}
                isLoading={isProcessingId !== null}
            />
        </div>
    );
};
