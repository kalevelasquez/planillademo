import React, { useState, useEffect } from 'react';
import { useOrderStore } from '../../../store/orderStore';
import { useAuthStore } from '../../../store/authStore';
import { orderService } from '../../../services/orderService';
import { MESSAGES } from '../../../config/constants';
import { CONFIG } from '../../../config';
import { useTranslation } from 'react-i18next';
import { useDraftAutosave } from '../../../hooks/useDraftAutosave';
import { BRAND } from '../../../config/brand';
import { useOrderCalculations } from './hooks/useOrderCalculations';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/ConfirmModal';
import {
    ArrowLeft, Trash2, CheckCircle2, MessageCircle,
    Tag, FileText, Loader2, StickyNote, Truck, X, User, Settings, AlertCircle,
} from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import { useDispatcherStore } from '../../../store/dispatcherStore';


export const OrderSummaryView: React.FC<{
    onBack: () => void;
    onHome: () => void;
    onNewOrder?: () => void;
}> = ({ onBack, onHome, onNewOrder }) => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const { profile } = useAuthStore();
    const {
        updateQuantity, updateUnitPrice, setItemNote, updateItemDiscount,
        selectedCustomer, activeDraftId, isRehydrating, clearOrder, toggleItemOverride,
        draftNotes, initializeDraft, editingOrderNumber, editingOrderStatus
    } = useOrderStore();

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDiscarding, setIsDiscarding] = useState(false);
    const [showDiscardModal, setShowDiscardModal] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // ── Notas (US-ORD-05) ──────────────────────────────────────────
    const [orderNotes, setOrderNotes] = useState('');
    const [activeNoteProductId, setActiveNoteProductId] = useState<string | null>(null);

    // ── Autosave Draft (US-ORD-07) ────────────────────────────────
    const [isSavingDraft] = useState(false); // Mantener para evitar errores si se usa en otros lugares, pero el valor real viene del hook

    const [successOrder, setSuccessOrder] = useState<{
        number: string;
        total: number;
        phone: string;
        pdfUrl: string;
        items: any[];
        notes?: string;
        customer: any;
        sellerName: string;
        subtotal: number;
        discountAmount: number;
    } | null>(null);

    const { orderItemsDetails, hasItems, subtotal, totalDiscount } = useOrderCalculations();
    const totalFinal = Math.max(0, subtotal - totalDiscount);

    useEffect(() => {
        console.log('[DEBUG] OrderSummaryView: Component Mounted', {
            items: useOrderStore.getState().items,
            customer: selectedCustomer?.id
        });
    }, []);

    useEffect(() => {
        console.log('[DEBUG] OrderSummaryView: Render state updated', {
            hasItems,
            detailsCount: orderItemsDetails.length,
            rawItemsCount: Object.keys(useOrderStore.getState().items).length,
            customer: selectedCustomer?.business_name,
            isRehydrating
        });
    }, [hasItems, orderItemsDetails.length, selectedCustomer, isRehydrating]);

    const [isDispatcherSelectorOpen, setIsDispatcherSelectorOpen] = useState(false);
    const { dispatchers, fetchDispatchers } = useDispatcherStore();

    useEffect(() => {
        if (profile?.tenant_id) {
            fetchDispatchers(profile.tenant_id);
        }
    }, [profile?.tenant_id, fetchDispatchers]);


    // ── Draft Recovery + Rehidratación ────────────────────────────
    useEffect(() => {
        if (!profile?.id || !selectedCustomer?.id || !profile?.tenant_id) return;
        initializeDraft(profile.id, selectedCustomer.id, profile.tenant_id);
    }, [profile?.id, selectedCustomer?.id, profile?.tenant_id, initializeDraft]);

    // ── Sincronizar nota del borrador al estado local (US-ORD-05 fix) ──
    useEffect(() => {
        if (draftNotes && !orderNotes) {
            setOrderNotes(draftNotes);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draftNotes]);


    // ── Autosave: Persiste el Borrador (Hook centralizado) ──
    const { isSaving: isSavingAutosave } = useDraftAutosave(isSubmitting);
    const isSavingDraftFinal = isSavingDraft || isSavingAutosave;

    // ── Descartar Pedido ──────────────────────────────────────────
    const handleDiscardOrder = async () => {
        // Protección extra: No borrar si estamos en modo edición de confirmados
        if (editingOrderNumber) {
            clearOrder();
            onHome();
            return;
        }

        setIsDiscarding(true);
        try {
            if (activeDraftId) {
                await orderService.deleteOrder(activeDraftId);
            }
            clearOrder();
            onHome();
        } catch (err) {
            console.error('Error al descartar:', err);
            setError('No se pudo descartar el pedido.');
        } finally {
            setIsDiscarding(false);
            setShowDiscardModal(false);
        }
    };

    // ── Confirmar Pedido (Confirmar Pedido VIEW) ──────────────────────────
    const handleConfirmOrder = async () => {
        if (isSubmitting) return;

        if (!selectedCustomer || !hasItems || !profile?.tenant_id) {
            setError('No es posible confirmar un pedido vacío o sin cliente.');
            return;
        }

        setIsSubmitting(true);
        setError(null);

        // US-ORD-03: Bloquear si hay insuficiencia de stock sin confirmación explícita
        // Usamos isInsufficientStock precalculado por el hook que ya mira stock en vivo
        const itemWithError = orderItemsDetails.find(i => i.isInsufficientStock && !i.isOverridden);
        if (itemWithError) {
            setError(`Stock insuficiente en ${itemWithError.product.name}. Por favor confirma el sobrepaso en la lista de productos.`);
            setIsSubmitting(false);
            return;
        }

        try {
            const processedItems = orderItemsDetails.map(item => ({
                product_id: item.product.id,
                quantity: item.quantity,
                unit_price: item.unitPrice,
                total_price: item.total,
                notes: item.note || undefined,
                discount_type: item.discountType || 'fixed',
                discount_amount: item.discount_amount || 0,
            }));

            let order_number: string;

            if (editingOrderNumber && activeDraftId && editingOrderStatus !== 'Draft') {
                // Caso: Editando un pedido CONFIRMADO (reutilizamos número)
                await orderService.updateOrder(activeDraftId, {
                    subtotal,
                    discount_type: 'fixed',
                    discount_amount: totalDiscount,
                    total_amount: totalFinal,
                    notes: orderNotes || undefined,
                    items: processedItems,
                });
                order_number = editingOrderNumber;
            } else if (activeDraftId) {
                // Caso: Promoviendo un BORRADOR a CONFIRMADO
                const result = await orderService.promoteDraftToConfirmed(activeDraftId, {
                    subtotal,
                    discount_type: 'fixed',
                    discount_amount: totalDiscount,
                    total_amount: totalFinal,
                    notes: orderNotes || undefined,
                    items: processedItems,
                });
                order_number = result.order_number;
            } else {
                // Caso: Pedido nuevo desde cero (sin borrador previo)
                const result = await orderService.createOrder({
                    tenant_id: profile.tenant_id,
                    customer_id: selectedCustomer.id,
                    seller_id: profile.id,
                    subtotal,
                    discount_type: 'fixed',
                    discount_amount: totalDiscount,
                    total_amount: totalFinal,
                    notes: orderNotes || undefined,
                    items: processedItems,
                });
                order_number = result.order_number;
            }

            // ── Generación de PDF y Notificación ──
            let pdfUrl = '';
            try {
                const [{ generateOrderPDFBlob }, { storageService }] = await Promise.all([
                    import('../../../utils/pdfUtils'),
                    import('../../../services/storageService'),
                ]);

                const blob = await generateOrderPDFBlob({
                    orderNumber: order_number,
                    createdAt: new Date().toISOString(),
                    customer: {
                        business_name: selectedCustomer.business_name,
                        contact_name: selectedCustomer.contact_name ?? null,
                        phone: selectedCustomer.phone ?? null,
                    } as any,
                    sellerName: profile.full_name ?? 'Vendedor',
                    subtotal,
                    discount_amount: totalDiscount,
                    items: orderItemsDetails.map(item => ({
                        product: {
                            ...item.product, // Enviamos el objeto completo para evitar campos faltantes
                        },
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        total: item.total,
                        note: item.note || undefined,
                    })) as any,
                    notes: orderNotes || undefined,
                    isInternal: false, // VERSIÓN CLIENTE PARA EL LINK PUBLICO
                });

                const safeCustomerName = (selectedCustomer.business_name ?? 'cliente')
                    .toLowerCase()
                    .replace(/[^a-z0-9]/g, '_')
                    .replace(/_+/g, '_')
                    .replace(/^_|_$/g, '');
                const fileName = `${order_number}_${safeCustomerName}.pdf`;
                pdfUrl = await storageService.uploadOrderPDF(blob, fileName);
            } catch (pdfErr) {
                console.warn('Error no crítico en generación/carga de PDF:', pdfErr);
                // Si falla, notificamos pero permitimos continuar con el éxito de la DB
                if (typeof showToast === 'function') {
                    showToast('No se pudo subir el PDF a la nube. El link será omitido en WhatsApp.', 'warning');
                }
            }

            setSuccessOrder({
                number: order_number,
                total: totalFinal,
                phone: selectedCustomer.phone || '',
                pdfUrl,
                items: orderItemsDetails.map(item => ({
                    product_id: item.product.id,
                    products: { 
                        name: item.product.name,
                        brand: item.product.brand || '',
                        caliber: item.product.caliber || '',
                        quality: item.product.quality || '',
                    },
                    quantity: item.quantity,
                    unit_price: item.unitPrice,
                    total_price: item.total,
                    notes: item.note || undefined,
                })) as any,
                notes: orderNotes || undefined,
                customer: {
                    id: selectedCustomer.id,
                    business_name: selectedCustomer.business_name,
                    contact_name: selectedCustomer.contact_name ?? null,
                    phone: selectedCustomer.phone ?? null,
                },
                sellerName: profile?.full_name ?? 'Vendedor',
                subtotal: subtotal,
                discountAmount: totalDiscount,
            });

            clearOrder();

        } catch (err: any) {
            console.error('Error confirmando pedido:', err);
            const errMsg = (err.message || '').toLowerCase();
            const errCode = String(err.code || '');

            // US-ORD-03: Detectar si el error viene de la base de datos (check constraint o similar)
            if (errCode === '23514' || errMsg.includes('check_stock_positive') || errMsg.includes('available_quantity') || errMsg.includes('check_stock')) {
                setError('Error Crítico de Inventario: La base de datos no permitió el descuento (Stock Negativo bloqueado). Contacte a soporte para ajustar las reglas de inventario.');
            } else if (errMsg.includes('insufficient_stock') || errMsg.includes('stock insuficiente')) {
                setError(MESSAGES.ERROR.INSUFFICIENT_INVENTORY);
            } else if (errMsg.includes('duplicate') || errCode === '23505') {
                setError('Error de duplicidad: Este pedido ya fue procesado. Verifique su historial antes de intentar de nuevo.');
            } else {
                setError(MESSAGES.ERROR.ORDER_SAVE + ' (Detalle: ' + (err.message || 'Error de conexión') + ')');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    // ── Pantalla de Éxito ─────────────────────────────────────────
    if (successOrder) {
        return (
            <div className="flex flex-col items-center justify-center p-xl min-h-[50vh] animate-in fade-in duration-300">
                <div className="w-20 h-20 bg-primary/10 rounded-pill flex items-center justify-center mb-md scale-in">
                    <CheckCircle2 className="text-primary w-10 h-10" />
                </div>
                <h1 className="text-h1 text-heading mb-xs">{t('orders.success_title')}</h1>
                <p className="text-body text-text-secondary mb-lg">
                    {t('orders.success_message', { number: successOrder.number })}
                </p>

                <div className="bg-white p-lg rounded-lg shadow-cards border border-border w-full max-w-[400px] flex flex-col gap-md">
                    <p className="text-caption text-text-secondary uppercase text-center font-bold tracking-wider mb-sm">{t('orders.notification_actions')}</p>

                    <button
                        onClick={async () => {
                            const { openWhatsApp } = await import('../../../utils/whatsappUtils');
                            try {
                                openWhatsApp(successOrder.phone, { order_number: successOrder.number } as any, [], successOrder.pdfUrl, 'client');
                            } catch (err: any) {
                                showToast(err.message || 'Error al enviar WhatsApp', 'error');
                            }
                        }}
                        className="w-full bg-[#25D366] hover:bg-[#128C7E] text-white rounded-md py-sm px-md flex justify-center items-center gap-sm font-bold transition-colors cursor-pointer"
                    >
                        <span translate="no"><MessageCircle size={20} /></span>
                        <span>{t('orders.send_to_client')}</span>
                    </button>

                    {successOrder.number && (
                        <button
                            onClick={async () => {
                                if (!successOrder) return;
                                const { downloadOrderPDF } = await import('../../../utils/pdfUtils');
                                await downloadOrderPDF({
                                    orderNumber: successOrder.number,
                                    createdAt: new Date().toISOString(),
                                    customer: successOrder.customer,
                                    sellerName: successOrder.sellerName,
                                    subtotal: successOrder.subtotal,
                                    discount_amount: successOrder.discountAmount,
                                    items: successOrder.items.map((i: any) => ({
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
                                    notes: successOrder.notes,
                                    isInternal: true,
                                });
                            }}
                            className="w-full bg-surface border border-border hover:bg-surface/70 text-heading rounded-md py-sm px-md flex justify-center items-center gap-sm font-bold transition-colors cursor-pointer"
                        >
                            <span translate="no"><FileText size={18} className="text-primary" /></span>
                            <span>{t('orders.action_view_pdf')}</span>
                        </button>
                    )}

                    <button
                        onClick={async () => {
                            const { openWhatsApp } = await import('../../../utils/whatsappUtils');
                            if (dispatchers.length > 0) {
                                setIsDispatcherSelectorOpen(true);
                            } else {
                                try {
                                    openWhatsApp(BRAND.PHONE_BODEGA, { order_number: successOrder.number, customers: successOrder.customer, total_amount: successOrder.total, discount_amount: successOrder.discountAmount, notes: successOrder.notes } as any, successOrder.items, undefined, 'bodega');
                                } catch (err: any) {
                                    showToast(err.message || 'Error al enviar WhatsApp', 'error');
                                }
                            }
                        }}
                        className="w-full bg-surface border border-border hover:bg-surface/70 text-heading rounded-md py-sm px-md flex justify-center items-center gap-sm font-bold transition-colors cursor-pointer"
                    >
                        <span translate="no"><Truck size={20} className="text-primary" /></span>
                        <span>{t('orders.send_to_dispatch')}</span>
                    </button>
                </div>

                {/* Modal de Selección de Despachador */}
                {
                    isDispatcherSelectorOpen && (
                        <div className="fixed inset-0 z-[60] flex items-center justify-center p-md bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
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
                                            onClick={async () => {
                                                const { openWhatsApp } = await import('../../../utils/whatsappUtils');
                                                try {
                                                    openWhatsApp(d.phone, { order_number: successOrder.number, customers: successOrder.customer, total_amount: successOrder.total, discount_amount: successOrder.discountAmount, notes: successOrder.notes } as any, successOrder.items, undefined, 'bodega');
                                                } catch (err: any) {
                                                    showToast(err.message || 'Error al enviar WhatsApp', 'error');
                                                }
                                                setIsDispatcherSelectorOpen(false);
                                            }}
                                            className="flex items-center gap-md p-md rounded-md hover:bg-primary/5 border border-transparent hover:border-primary/20 transition-all text-left"
                                        >
                                            <span className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                                                <User size={20} />
                                            </span>
                                            <span className="min-w-0 block">
                                                <span className="text-body font-bold text-heading truncate block">{d.name}</span>
                                                <span className="text-caption text-text-secondary block">{d.phone}</span>
                                            </span>
                                        </button>
                                    ))}
                                    <div className="h-px bg-border my-xs" />
                                    <button
                                        onClick={async () => {
                                            const { openWhatsApp } = await import('../../../utils/whatsappUtils');
                                            try {
                                                openWhatsApp(BRAND.PHONE_BODEGA, { order_number: successOrder.number, customers: successOrder.customer, total_amount: successOrder.total, discount_amount: successOrder.discountAmount, notes: successOrder.notes } as any, successOrder.items, undefined, 'bodega');
                                            } catch (err: any) {
                                                showToast(err.message || 'Error al enviar WhatsApp', 'error');
                                            }
                                            setIsDispatcherSelectorOpen(false);
                                        }}
                                        className="flex items-center gap-md p-md rounded-md hover:bg-surface border border-dashed border-border transition-all text-left"
                                    >
                                        <span className="w-10 h-10 rounded-full bg-surface flex items-center justify-center text-text-secondary shrink-0">
                                            <Settings size={20} />
                                        </span>
                                        <span className="min-w-0 block">
                                            <span className="text-body font-bold text-text-secondary truncate block">{t('orders.default_dispatcher')}</span>
                                            <span className="text-caption text-text-secondary opacity-60 block">{t('orders.default_dispatcher_help')}</span>
                                        </span>
                                    </button>
                                </div>
                                <div className="p-md bg-surface/10 border-t border-border">
                                    <Button variant="ghost" onClick={() => setIsDispatcherSelectorOpen(false)} className="w-full">{t('common.cancel')}</Button>
                                </div>
                            </div>
                        </div>
                    )
                }

                <div className="flex flex-col gap-sm mt-xl w-full max-w-[400px]">
                    <Button variant="primary" onClick={() => { clearOrder(); if (onNewOrder) onNewOrder(); }} className="w-full justify-center">
                        {t('orders.new_order_button')}
                    </Button>
                    <Button variant="secondary" onClick={onHome} className="w-full justify-center">
                        {t('orders.back_to_home')}
                    </Button>
                </div>
            </div >
        );
    }

    if (!selectedCustomer) {
        return <div className="p-xl text-center">Cliente no seleccionado.</div>;
    }

    const todayDate = new Date().toLocaleDateString('es-SV', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-[100px] md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8">

            {/* ── Toolbar fijo ── */}
            <div className="flex justify-between items-center sticky top-0 bg-surface/90 backdrop-blur-md z-10 py-md border-b border-border">
                <div className="flex items-center gap-sm">
                    <button onClick={onBack} className="p-xs text-text-secondary w-[40px] h-[40px] flex items-center justify-center hover:bg-white rounded-sm transition-colors">
                        <ArrowLeft size={24} />
                    </button>
                    <div>
                        <h1 className="text-h2 text-heading">{t('orders.summary_title')}</h1>
                        <div className="flex items-center gap-2">
                            <p className="text-caption text-text-secondary capitalize">{todayDate}</p>
                            <span className="text-border">•</span>
                            <button
                                onClick={onBack}
                                className="text-[11px] font-bold text-primary hover:underline uppercase tracking-tight"
                            >
                                {t('orders.add_products')}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-md">
                    {isSavingDraftFinal && (
                        <div className="hidden sm:flex items-center gap-xs text-caption text-text-secondary animate-in fade-in duration-200">
                            <Loader2 size={12} className="animate-spin" />
                            <span>{t('orders.saving_draft')}</span>
                        </div>
                    )}

                    {/* Botón de descarte accesible en móvil en el toolbar (US-ORD-11 FIX) */}
                    <button
                        onClick={() => {
                            if (editingOrderNumber && editingOrderStatus !== 'Draft') {
                                onBack();
                            } else {
                                setShowDiscardModal(true);
                            }
                        }}
                        className={`p-2 transition-all lg:hidden ${editingOrderNumber && editingOrderStatus !== 'Draft' ? 'text-text-secondary' : 'text-text-secondary hover:text-error'}`}
                        disabled={isSubmitting || isDiscarding}
                        title={editingOrderNumber && editingOrderStatus !== 'Draft' ? 'Cancelar Edición' : t('orders.discard_order')}
                    >
                        {editingOrderNumber && editingOrderStatus !== 'Draft' ? <ArrowLeft size={22} /> : <Trash2 size={22} />}
                    </button>
                </div>
            </div>

            {/* ── Grid principal ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-lg">

                {/* ══ Columna principal: productos + notas ══ */}
                <div className="lg:col-span-2 flex flex-col gap-md">

                    {/* Tarjeta de productos */}
                    <div className="bg-white rounded-lg shadow-cards border border-border overflow-hidden">
                        <h2 className="text-h3 font-display text-heading px-md pt-md pb-sm border-b border-border/50">Productos Seleccionados</h2>

                        {!hasItems ? (
                            isRehydrating ? (
                                <div className="p-md animate-pulse flex flex-col gap-3">
                                    {[1, 2].map(i => (
                                        <div key={i} className="flex justify-between items-center">
                                            <div className="flex flex-col gap-1 w-1/2">
                                                <div className="h-4 bg-surface rounded w-3/4" />
                                                <div className="h-3 bg-surface rounded w-1/2" />
                                            </div>
                                            <div className="h-5 bg-surface rounded w-16" />
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-body text-text-secondary py-lg text-center px-md">Tu carrito está vacío.</p>
                            )
                        ) : (
                            <>
                                {/* ── MOBILE CARD LAYOUT ── */}
                                <div className="md:hidden divide-y divide-border/50">
                                    {orderItemsDetails.map(item => (
                                        <div
                                            key={item.product.id}
                                            className={`p-4 transition-all ${item.isInsufficientStock && !item.isOverridden
                                                ? 'bg-error/5 border-l-4 border-l-error shadow-inner'
                                                : item.isInsufficientStock && item.isOverridden
                                                    ? 'bg-success/5 border-l-4 border-l-success/40'
                                                    : 'bg-white'
                                                } hover:bg-surface/30`}
                                        >
                                            {/* Fila 1: Nombre y Delete */}
                                            <div className="flex justify-between items-start gap-3 mb-1">
                                                <div className="font-bold text-heading text-sm leading-snug flex-1 flex items-center gap-1.5">
                                                    {item.product.name}
                                                    {item.isInsufficientStock && (
                                                        <div className="flex flex-col gap-1 mt-1">
                                                            <div className="flex items-center gap-1.5 leading-none">
                                                                <AlertCircle size={14} className={item.isOverridden ? 'text-success' : 'text-error'} />
                                                                <span className={`text-[10px] font-extrabold uppercase tracking-tight ${item.isOverridden ? 'text-success-dark' : 'text-error-dark'}`}>
                                                                    {item.isOverridden ? 'SOBREPASO CONFIRMADO' : 'REQUIERE CONFIRMACIÓN'}
                                                                </span>
                                                            </div>
                                                            <p className={`text-[11px] font-bold ${item.isOverridden ? 'text-text-secondary/70' : 'text-error'}`}>
                                                                Disponible: {item.product.available_quantity} · Solicitó: {item.quantity}
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    {item.isInsufficientStock && !item.isOverridden && (
                                                        <button
                                                            onClick={() => toggleItemOverride(item.product.id)}
                                                            className="text-[10px] font-bold uppercase text-white bg-error px-2 py-1 rounded shadow-md ring-2 ring-error/20 active:scale-95 transition-all"
                                                        >
                                                            Confirmar
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => updateQuantity(item.product, 0)}
                                                        className="p-1.5 -mr-1.5 text-text-secondary hover:text-error hover:bg-error/5 rounded-full transition-colors"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Metadata */}
                                            <p className="text-xs text-text-secondary mb-3">
                                                {[item.product.brand, item.product.caliber, item.product.quality, (item.product as any).shipment_number].filter(Boolean).join(' · ')}
                                            </p>

                                            {/* Cantidad + Total */}
                                            <div className="flex items-end justify-between gap-3">
                                                <div className="flex flex-col gap-1">
                                                    {/* Input de cantidad (US-ORD-03) */}
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="1"
                                                        value={item.quantity === 0 ? '' : item.quantity}
                                                        onChange={e => {
                                                            const val = e.target.value === '' ? 0 : parseInt(e.target.value);
                                                            if (!isNaN(val)) updateQuantity(item.product, val);
                                                        }}
                                                        onFocus={(e) => e.target.select()}
                                                        className="w-20 bg-white border border-border rounded shadow-sm h-9 text-center font-bold text-heading focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all"
                                                        placeholder="0"
                                                    />
                                                </div>
                                                <div className="text-right flex flex-col items-end">
                                                    <span className="text-[10px] text-text-secondary font-bold uppercase tracking-wider mb-1">Precio Unit.</span>
                                                    <div className="flex items-center gap-1 min-w-[80px] justify-end">
                                                        <span className="text-sm font-bold text-text-secondary">$</span>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            className="w-16 text-right font-bold text-sm text-heading bg-white border border-border rounded px-1.5 py-1 focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                                                            value={item.unitPrice}
                                                            onChange={e => updateUnitPrice(item.product, parseFloat(e.target.value) || 0)}
                                                            onFocus={e => e.target.select()}
                                                        />
                                                    </div>
                                                    <div className="text-base font-bold text-primary mt-1">${item.total.toFixed(2)}</div>
                                                </div>
                                            </div>

                                            {/* Descuento por ítem mobile */}
                                            <div className="mt-3 flex items-center justify-between gap-2 p-2 bg-surface/50 rounded-md border border-border/30">
                                                <span className="text-[10px] font-bold uppercase text-text-secondary flex items-center gap-1">
                                                    <Tag size={12} /> Descuento
                                                </span>
                                                <div className="flex items-center bg-white border border-border rounded shadow-sm h-8 overflow-hidden">
                                                    <button
                                                        onClick={() => updateItemDiscount(item.product.id, item.discountType === 'percentage' ? 'fixed' : 'percentage', item.discountValue || 0)}
                                                        className="px-2 h-full bg-surface border-r border-border text-[10px] font-bold text-primary hover:bg-primary/5 transition-colors"
                                                    >
                                                        {item.discountType === 'percentage' ? '%' : '$'}
                                                    </button>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        className="w-12 h-full text-right text-xs font-bold text-heading px-1 outline-none"
                                                        value={item.discountValue || ''}
                                                        onChange={e => updateItemDiscount(item.product.id, item.discountType || 'fixed', parseFloat(e.target.value) || 0)}
                                                        onFocus={e => e.target.select()}
                                                    />
                                                </div>
                                            </div>

                                            {/* Nota por línea mobile (CA2) */}
                                            <div className="mt-2">
                                                <button
                                                    onClick={() => setActiveNoteProductId(
                                                        activeNoteProductId === item.product.id ? null : item.product.id
                                                    )}
                                                    className={`flex items-center gap-1 text-[11px] font-medium transition-colors ${item.note ? 'text-primary' : 'text-text-secondary hover:text-primary'
                                                        }`}
                                                >
                                                    <StickyNote size={12} />
                                                    {item.note || activeNoteProductId === item.product.id ? 'Nota de línea' : 'Agregar nota'}
                                                </button>
                                                {activeNoteProductId === item.product.id && (
                                                    <textarea
                                                        autoFocus
                                                        rows={2}
                                                        placeholder="Instrucción especial para bodega..."
                                                        value={item.note || ''}
                                                        onChange={e => setItemNote(item.product.id, e.target.value)}
                                                        className="mt-1.5 w-full text-[12px] border border-border rounded-md px-2.5 py-1.5 text-heading placeholder:text-text-secondary/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 resize-none transition-all"
                                                    />
                                                )}
                                                {item.note && activeNoteProductId !== item.product.id && (
                                                    <p className="mt-1 text-[11px] text-primary/80 italic truncate">{item.note}</p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* ── DESKTOP TABLE LAYOUT ── */}
                                <div className="hidden md:block overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-surface text-caption text-text-secondary uppercase tracking-wider border-b border-border">
                                                <th className="px-md py-sm font-semibold">Producto</th>
                                                <th className="px-md py-sm font-semibold text-right w-28">Cant.</th>
                                                <th className="px-md py-sm font-semibold text-right w-32">Precio Unit.</th>
                                                <th className="px-md py-sm font-semibold text-center w-28">Desc.</th>
                                                <th className="px-md py-sm font-semibold text-right w-28">Total</th>
                                                <th className="px-md py-sm w-10" />
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/50">
                                            {orderItemsDetails.map(item => (
                                                <tr
                                                    key={item.product.id}
                                                    className={`transition-all ${item.isInsufficientStock && !item.isOverridden
                                                        ? 'bg-error/5 border-l-2 border-l-error animate-pulse-subtle'
                                                        : 'hover:bg-surface/30'
                                                        }`}
                                                >
                                                    <td className="px-md py-sm">
                                                        <div className="flex flex-col gap-0.5">
                                                            <div className="font-bold text-heading text-body flex items-center gap-2">
                                                                {item.product.name}
                                                                {item.isInsufficientStock && (
                                                                    <div className="flex flex-col gap-1">
                                                                        <div className="flex items-center gap-1.5 leading-none">
                                                                            <AlertCircle size={14} className={item.isOverridden ? 'text-success' : 'text-error'} />
                                                                            <span className={`text-[10px] font-extrabold uppercase tracking-tight ${item.isOverridden ? 'text-success-dark' : 'text-error-dark'}`}>
                                                                                {item.isOverridden ? 'SOBREPASO CONFIRMADO' : 'REQUIERE CONFIRMACIÓN'}
                                                                            </span>
                                                                        </div>
                                                                        <p className={`text-[11px] font-bold ${item.isOverridden ? 'text-text-secondary/70' : 'text-error'}`}>
                                                                            Disponible: {item.product.available_quantity} · Solicitó: {item.quantity}
                                                                        </p>
                                                                    </div>
                                                                )}
                                                                {item.isInsufficientStock && !item.isOverridden && (
                                                                    <button
                                                                        onClick={() => toggleItemOverride(item.product.id)}
                                                                        className="text-[10px] font-bold uppercase text-white bg-error px-2 py-1 rounded shadow-md ring-2 ring-error/20 active:scale-95 transition-all ml-2 whitespace-nowrap"
                                                                    >
                                                                        Confirmar Sobrepaso
                                                                    </button>
                                                                )}
                                                            </div>
                                                            <p className="text-caption text-text-secondary">
                                                                {[item.product.brand, item.product.caliber, item.product.quality, (item.product as any).shipment_number].filter(Boolean).join(' · ')}
                                                            </p>
                                                        </div>
                                                        {/* Nota por línea desktop (CA2) */}
                                                        <div className="mt-1">
                                                            <button
                                                                onClick={() => setActiveNoteProductId(
                                                                    activeNoteProductId === item.product.id ? null : item.product.id
                                                                )}
                                                                className={`flex items-center gap-1 text-[11px] font-medium transition-colors ${item.note ? 'text-primary' : 'text-text-secondary hover:text-primary'
                                                                    }`}
                                                            >
                                                                <StickyNote size={11} />
                                                                {item.note || activeNoteProductId === item.product.id ? 'Nota de línea' : 'Agregar nota'}
                                                            </button>
                                                            {activeNoteProductId === item.product.id && (
                                                                <textarea
                                                                    autoFocus
                                                                    rows={2}
                                                                    placeholder="Instrucción especial para bodega..."
                                                                    value={item.note || ''}
                                                                    onChange={e => setItemNote(item.product.id, e.target.value)}
                                                                    className="mt-1 w-full text-[12px] border border-border rounded-md px-2.5 py-1.5 text-heading placeholder:text-text-secondary/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 resize-none transition-all"
                                                                />
                                                            )}
                                                            {item.note && activeNoteProductId !== item.product.id && (
                                                                <p className="mt-0.5 text-[11px] text-primary/80 italic truncate max-w-[220px]">{item.note}</p>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-md py-sm text-right">
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            className="w-16 text-right font-bold text-body text-heading bg-transparent border-b border-transparent focus:border-primary outline-none transition-colors py-0.5 px-1 hover:bg-white"
                                                            value={item.quantity === 0 ? '' : item.quantity}
                                                            onChange={e => updateQuantity(item.product, parseInt(e.target.value) || 0)}
                                                            onFocus={e => e.target.select()}
                                                        />
                                                    </td>
                                                    <td className="px-md py-sm text-right">
                                                        <div className="flex items-center justify-end gap-1">
                                                            <span className="text-caption text-text-secondary">$</span>
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                min="0"
                                                                className="w-20 text-right font-medium text-body text-heading bg-transparent border-b border-border/30 focus:border-primary outline-none transition-colors py-0.5 px-1 hover:bg-white"
                                                                value={item.unitPrice}
                                                                onChange={e => updateUnitPrice(item.product, parseFloat(e.target.value) || 0)}
                                                                onFocus={e => e.target.select()}
                                                            />
                                                        </div>
                                                    </td>
                                                    <td className="px-sm py-sm text-center">
                                                        <div className="flex items-center justify-center">
                                                            <div className="flex items-center bg-white border border-border rounded overflow-hidden h-7 shadow-sm focus-within:ring-1 focus-within:ring-primary/20">
                                                                <button
                                                                    title="Cambiar tipo de descuento"
                                                                    onClick={() => updateItemDiscount(item.product.id, item.discountType === 'percentage' ? 'fixed' : 'percentage', item.discountValue || 0)}
                                                                    className="px-1.5 h-full bg-surface border-r border-border text-[10px] font-bold text-primary hover:bg-primary/10 transition-colors"
                                                                >
                                                                    {item.discountType === 'percentage' ? '%' : '$'}
                                                                </button>
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    step="0.01"
                                                                    className="w-12 h-full text-center text-xs font-bold text-heading outline-none tabular-nums"
                                                                    value={item.discountValue || ''}
                                                                    onChange={e => {
                                                                        let val = parseFloat(e.target.value) || 0;
                                                                        if (item.discountType === 'percentage' && val > CONFIG.MAX_DISCOUNT_PERCENTAGE) {
                                                                            val = CONFIG.MAX_DISCOUNT_PERCENTAGE;
                                                                        }
                                                                        updateItemDiscount(item.product.id, item.discountType || 'fixed', val);
                                                                    }}
                                                                    onFocus={e => e.target.select()}
                                                                />
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-md py-sm text-right font-bold text-primary">
                                                        ${item.total.toFixed(2)}
                                                    </td>
                                                    <td className="pr-md py-sm">
                                                        <button
                                                            className="p-xs text-text-secondary hover:text-error transition-colors"
                                                            onClick={() => updateQuantity(item.product, 0)}
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* ── TOTALES ── */}
                                <div className="bg-gray-50 border-t border-border p-5 md:p-6 flex flex-col items-end">
                                    <div className="w-full md:w-80 flex flex-col gap-3">
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-text-secondary font-medium">Subtotal</span>
                                            <span className="text-heading font-bold text-base tabular-nums">${subtotal.toFixed(2)}</span>
                                        </div>


                                        {totalDiscount > 0 && (
                                            <div className="flex justify-between items-center text-xs text-error font-medium animate-in slide-in-from-right-2 bg-error/5 p-1 rounded px-2">
                                                <span className="opacity-90 font-bold uppercase tracking-wider text-[10px]">Ahorro Total</span>
                                                <span className="tabular-nums font-bold text-sm">−${totalDiscount.toFixed(2)}</span>
                                            </div>
                                        )}

                                        <div className="h-px bg-border/60 my-1" />

                                        <div className="flex justify-between items-end">
                                            <span className="text-heading font-display font-bold text-lg">Total</span>
                                            <span className="text-primary font-display font-bold text-2xl tracking-tight tabular-nums">
                                                ${totalFinal.toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div> {/* fin tarjeta productos */}

                    {/* ── Notas del Pedido (US-ORD-05 CA1) ── */}
                    {hasItems && (
                        <div className="bg-amber-50/50 rounded-lg border border-amber-200 p-md flex flex-col gap-sm animate-in fade-in duration-200">
                            <div className="flex items-center gap-2">
                                <StickyNote size={15} className="text-amber-700" />
                                <h3 className="text-caption font-extrabold text-amber-800 uppercase tracking-widest">{t('orders.order_notes_label')}</h3>
                            </div>
                            <textarea
                                rows={3}
                                placeholder={t('orders.order_notes_placeholder')}
                                value={orderNotes}
                                onChange={e => setOrderNotes(e.target.value)}
                                className="w-full text-sm border border-amber-200 rounded-lg px-3 py-2.5 text-heading bg-white placeholder:text-text-secondary/40 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/20 resize-none transition-all"
                            />
                            <p className="text-[10px] text-amber-700/70 font-medium">
                                {t('orders.order_notes_help')}
                            </p>
                        </div>
                    )}
                </div> {/* fin lg:col-span-2 */}

                {/* ══ Sidebar Desktop ══ */}
                <div className="lg:col-span-1">
                    <div className="bg-white rounded-lg shadow-cards border border-border p-lg sticky top-[100px]">
                        <h2 className="text-h3 font-display text-heading mb-md">{t('orders.table_actions')}</h2>
                        <div className="flex flex-col gap-sm text-body text-text-secondary font-medium mb-lg">
                            <div className="flex justify-between items-center">
                                <span>{t('orders.table_customer')}</span>
                                <span className="font-bold text-heading truncate max-w-[150px]">{selectedCustomer.business_name}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span>{t('orders.subtotal')}</span>
                                <span>${subtotal.toFixed(2)}</span>
                            </div>
                            {totalDiscount > 0 && (
                                <div className="flex justify-between items-center text-error">
                                    <span>{t('orders.total_discount')}</span>
                                    <span>-${totalDiscount.toFixed(2)}</span>
                                </div>
                            )}
                            <div className="pt-sm border-t border-border/50 flex justify-between items-center text-h2 font-display">
                                <span className="text-heading">{t('orders.total')}</span>
                                <span className="text-primary">${totalFinal.toFixed(2)}</span>
                            </div>
                        </div>

                        {error && (
                            <div className="p-sm bg-error/10 border border-error/20 rounded-sm text-error text-caption font-medium mb-md">
                                {error}
                            </div>
                        )}

                        <Button
                            className="w-full flex items-center justify-center"
                            size="lg"
                            disabled={!hasItems || totalFinal <= 0 || isSubmitting || isRehydrating || isSavingDraft}
                            isLoading={isSubmitting}
                            loadingMessage={t('loading_order')}
                            onClick={handleConfirmOrder}
                        >
                            {t('orders.confirm_order')}
                        </Button>

                        <Button
                            variant="ghost"
                            className="w-full mt-2 text-text-secondary hover:text-error"
                            disabled={isSubmitting || isDiscarding}
                            onClick={() => {
                                // Si es un pedido confirmado, simplemente cancelamos la edición volviendo atrás.
                                // Si es un borrador (Draft), mostramos el modal de descarte para eliminarlo.
                                if (editingOrderNumber && editingOrderStatus !== 'Draft') {
                                    onBack();
                                } else {
                                    setShowDiscardModal(true);
                                }
                            }}
                        >
                            {editingOrderNumber && editingOrderStatus !== 'Draft' ? (
                                <>
                                    <ArrowLeft size={16} className="mr-2" />
                                    Cancelar Edición
                                </>
                            ) : (
                                <>
                                    <Trash2 size={16} className="mr-2" />
                                    {t('orders.discard_order')}
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Modal de Confirmación para Descartar */}
            <ConfirmModal
                isOpen={showDiscardModal}
                onClose={() => setShowDiscardModal(false)}
                onConfirm={handleDiscardOrder}
                title={t('orders.discard_confirm_title')}
                message={t('orders.discard_confirm_message')}
                confirmLabel={t('orders.discard_confirm_button')}
                variant="danger"
                Icon={AlertCircle}
                isLoading={isDiscarding}
            />
        </div>
    );
};