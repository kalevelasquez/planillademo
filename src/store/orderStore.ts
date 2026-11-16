import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Customer } from '../services/customerService';
import type { Product } from '../services/productService';
import { orderService, type OrderDTO } from '../services/orderService';
import { productService } from '../services/productService';

export interface OrderItem {
    product: Product;
    quantity: number;
    unitPrice?: number; // US-ORD-04: Precio negociado por línea
    note?: string;  // Nota por línea (US-ORD-05 CA2)
    discountType?: 'fixed' | 'percentage';
    discountValue?: number;
    isOverridden?: boolean; // US-ORD-03: Confirmación explícita de sobrepaso de inventario
}

interface OrderState {
    selectedCustomer: Customer | null;
    items: Record<string, OrderItem>;
    isRehydrating: boolean;
    activeDraftId: string | null;
    draftNotes: string;
    draftDiscount: { type: 'fixed' | 'percentage' | null; amount: number }; // US-ORD-07 rehidratación
    editingOrderNumber: string | null; // Nuevo: para saber si estamos editando un pedido existente
    editingOrderStatus: string | null; // Nuevo: para saber el estado original
    _initializedForCustomerId: string | null;

    // US-ORD-08: Repetir último pedido
    lastOrderPreview: OrderDTO | null;
    fetchLastOrder: (customerId: string) => Promise<void>;
    duplicateLastOrder: () => Promise<void>;
    duplicateSpecificOrder: (order: OrderDTO) => Promise<void>;
    clearLastOrderPreview: () => void;

    setCustomer: (customer: Customer | null) => void;
    updateQuantity: (product: Product, quantity: number) => void;
    updateUnitPrice: (product: Product, price: number) => void; // US-ORD-04
    setItemNote: (productId: string, note: string) => void;  // US-ORD-05
    updateItemDiscount: (productId: string, type: 'fixed' | 'percentage', value: number) => void;
    toggleItemOverride: (productId: string) => void; // US-ORD-03
    clearOrder: () => void;

    // Nueva acción asíncrona para despertar el borrador
    initializeDraft: (sellerId: string, customerId: string, tenantId: string) => Promise<void>;

    // Cargar un borrador específico desde el historial (US-HIS-01)
    prepareResumeDraft: (order: any) => void;

    // Cargar un PEDIDO CONFIRMADO para editar
    prepareEditOrder: (order: OrderDTO, items: any[]) => void;
}

export const useOrderStore = create<OrderState>()(
    persist(
        (set, get) => ({
    selectedCustomer: null,
    items: {},
    isRehydrating: false,
    activeDraftId: null,
    draftNotes: '',
    draftDiscount: { type: null, amount: 0 },
    editingOrderNumber: null,
    editingOrderStatus: null,
    _initializedForCustomerId: null,
    lastOrderPreview: null,

    setCustomer: (customer) => {
        set({
            selectedCustomer: customer,
            items: {},
            activeDraftId: null,
            draftNotes: '',
            draftDiscount: { type: null, amount: 0 },
            editingOrderNumber: null,
            editingOrderStatus: null,
            _initializedForCustomerId: null,
            lastOrderPreview: null
        });
    },

    updateQuantity: (product, quantity) => set((state) => {
        const newItems = { ...state.items };
        const existing = state.items[product.id];

        // Solo eliminamos si la cantidad es 0 Y no hay precio negociado ni nota
        if (quantity <= 0 && !existing?.unitPrice && !existing?.note) {
            delete newItems[product.id];
        } else {
            const isInsufficient = quantity > (product.available_quantity || 0);

            newItems[product.id] = {
                ...existing,
                product,
                quantity: Math.max(0, quantity),
                // Reset override si ahora hay stock suficiente, o persistir si sigue insuficiente
                isOverridden: isInsufficient ? (existing?.isOverridden ?? false) : false
            };
        }
        return { items: newItems };
    }),

    updateUnitPrice: (product, price) => set((state) => {
        const existing = state.items[product.id];

        return {
            items: {
                ...state.items,
                [product.id]: {
                    ...existing,
                    product,
                    quantity: existing?.quantity ?? 0,
                    unitPrice: price
                }
            }
        };
    }),

    setItemNote: (productId, note) => set((state) => {
        const existing = state.items[productId];
        if (!existing) return {};
        return {
            items: {
                ...state.items,
                [productId]: { ...existing, note: note || undefined }
            }
        };
    }),

    updateItemDiscount: (productId, type, value) => set((state) => {
        const existing = state.items[productId];
        if (!existing) return {};
        return {
            items: {
                ...state.items,
                [productId]: {
                    ...existing,
                    discountType: type,
                    discountValue: value
                }
            }
        };
    }),

    toggleItemOverride: (productId) => set((state) => {
        const existing = state.items[productId];
        if (!existing) return {};
        return {
            items: {
                ...state.items,
                [productId]: { ...existing, isOverridden: !existing.isOverridden }
            }
        };
    }),

    clearOrder: () => set({
        selectedCustomer: null,
        items: {},
        activeDraftId: null,
        draftNotes: '',
        draftDiscount: { type: null, amount: 0 },
        editingOrderNumber: null,
        editingOrderStatus: null,
        _initializedForCustomerId: null,
        lastOrderPreview: null
    }),

    fetchLastOrder: async (customerId: string) => {
        try {
            const lastOrder = await orderService.getLastOrderForCustomer(customerId);
            set({ lastOrderPreview: lastOrder });
        } catch (error) {
            console.error('Error fetching last order preview:', error);
        }
    },

    duplicateLastOrder: async () => {
        const state = get();
        if (!state.lastOrderPreview) return;
        try {
            await get().duplicateSpecificOrder(state.lastOrderPreview);
        } finally {
            set({ lastOrderPreview: null });
        }
    },

    duplicateSpecificOrder: async (order: OrderDTO) => {
        set({ isRehydrating: true });
        try {
            const id = order.id;
            const items = await orderService.getOrderItems(id);
            const productIds = items.map(i => i.products?.id).filter(Boolean) as string[];

            const newItems: Record<string, OrderItem> = {};
            if (productIds.length > 0) {
                // Obtener info actual de productos para asegurar precios vigentes (US-ORD-08 CA4)
                const currentProducts = await productService.getProductsByIds(productIds);
                const productMap = currentProducts.reduce((acc, p) => ({ ...acc, [p.id]: p }), {} as Record<string, Product>);

                for (const item of items) {
                    if (!item.products?.id) continue;
                    const liveProduct = productMap[item.products.id];
                    if (!liveProduct) continue;

                    newItems[liveProduct.id] = {
                        product: liveProduct,
                        quantity: item.quantity,
                        unitPrice: Number(item.unit_price), // US-ORD-08: Preservar precio negociado original
                        note: item.notes || undefined,
                        discountType: (item.discount_type as 'fixed' | 'percentage') || undefined,
                        discountValue: item.discount_type === 'percentage'
                            ? (Number(item.unit_price) * Number(item.quantity) === 0 ? 0 : (Number(item.discount_amount || 0) / (Number(item.unit_price) * Number(item.quantity)) * 100))
                            : Number(item.discount_amount || 0),
                    };
                }
            }

            // Aplicar todo al estado (Cliente + Items + Notas + Descuentos)
            const customers = order.customers;
            set({
                selectedCustomer: customers ? {
                    id: customers.id,
                    business_name: customers.business_name,
                    contact_name: customers.contact_name || null,
                    phone: customers.phone || null,
                    status: 'activo',
                    price_type: (customers as any).price_type || 'cliente',
                    tenant_id: customers.tenant_id || order.tenant_id || '',
                } as Customer : null,
                items: newItems,
                draftNotes: order.notes || '',
                draftDiscount: {
                    type: (order.discount_type as any) || null,
                    amount: Number(order.discount_amount || 0)
                },
                activeDraftId: null, // Es un nuevo borrador basado en el anterior
                editingOrderNumber: null,
                editingOrderStatus: null,
                _initializedForCustomerId: order.customer_id // Evita que initializeDraft limpie cosas
            });
        } catch (error) {
            console.error('Error duplicating order:', error);
            throw error;
        } finally {
            set({ isRehydrating: false });
        }
    },

    clearLastOrderPreview: () => set({ lastOrderPreview: null }),

    initializeDraft: async (sellerId: string, customerId: string, tenantId: string) => {
        const state = get();

        // Si ya tenemos un activeDraftId (porque venimos del historial), lo usamos directamente
        let draftIdToLoad = state.activeDraftId;

        // Evita rehidratar si ya estamos en modo edición de un pedido confirmado o si ya se inicializó
        if (state.editingOrderNumber) {
            return;
        }

        // Evita rehidratar múltiple veces para el mismo cliente en la sesión
        // EXCEPCIÓN: Si tenemos un draftIdToLoad que es distinto al actual, permitimos continuar
        if (state._initializedForCustomerId === customerId && !draftIdToLoad) {
            return;
        }

        // Bloqueo si ya hay una rehidratación activa para el MISMO cliente
        // Esto evita doble-llamada pero permite que prepareResumeDraft (que resetea _initializedForCustomerId)
        // o un cambio de cliente repentino inicien una nueva carga legítima.
        if (state.isRehydrating && state._initializedForCustomerId === customerId) {
            return;
        }

        console.log('[DEBUG] initializeDraft: Starting rehydration for', { sellerId, customerId, draftIdToLoad });
        set({ isRehydrating: true, _initializedForCustomerId: customerId });

        try {
            if (draftIdToLoad) {
                // Si ya tenemos el ID, no buscamos, usamos ese.
                draftIdToLoad = state.activeDraftId;
            } else {
                const draft = await orderService.findExistingDraft(sellerId, customerId);
                if (!draft) {
                    set({ activeDraftId: null, isRehydrating: false });
                    return;
                }
                draftIdToLoad = draft.id;

                set({
                    activeDraftId: draft.id,
                    draftNotes: draft.notes || '',
                    draftDiscount: {
                        type: (draft.discount_type as 'fixed' | 'percentage' | null) ?? null,
                        amount: Number(draft.discount_amount ?? 0),
                    },
                });
            }

            // Inyectar items si el carrito está vacío
            const currentItemIds = Object.keys(get().items);
            if (currentItemIds.length === 0 && draftIdToLoad) {
                console.log('[DEBUG] initializeDraft: Fetching items from DB for draft', draftIdToLoad);
                const savedItems = await orderService.getOrderItems(draftIdToLoad);
                console.log('[DEBUG] initializeDraft: Fetched items from DB:', savedItems.length);

                const newItems: Record<string, OrderItem> = {};

                for (const item of savedItems) {
                    // Si la relación con products falla (por RLS), creamos un placeholder
                    const productData = (item.products || { id: item.product_id, name: 'Producto no accesible' }) as any;

                    const product: Product = {
                        id: productData.id,
                        name: productData.name,
                        brand: productData.brand ?? '',
                        caliber: productData.caliber ?? '',
                        quality: productData.quality ?? '',
                        shipment_number: productData.shipment_number ?? '',
                        price: item.unit_price,
                        available_quantity: 9999,
                        tenant_id: tenantId,
                        category_id: '',
                        status: 'active' as const,
                        created_at: '',
                    };
                    newItems[product.id] = {
                        product,
                        quantity: item.quantity,
                        unitPrice: Number(item.unit_price),
                        note: item.notes || undefined,
                        discountType: (item.discount_type as 'fixed' | 'percentage') || undefined,
                        discountValue: item.discount_type === 'percentage'
                            ? (Number(item.unit_price) * Number(item.quantity) === 0 ? 0 : (Number(item.discount_amount || 0) / (Number(item.unit_price) * Number(item.quantity)) * 100))
                            : Number(item.discount_amount || 0)
                    };
                }
                set({ items: newItems });
            }
        } catch (error) {
            console.error('Error rehidratando borrador:', error);
            set({ _initializedForCustomerId: null });
        } finally {
            set({ isRehydrating: false });
        }
    },

    prepareResumeDraft: (order) => {
        const minimalCustomer = {
            id: order.customer_id,
            business_name: order.customers?.business_name || 'Desconocido',
            contact_name: order.customers?.contact_name ?? null,
            phone: order.customers?.phone ?? null,
        } as Customer;

        set({
            selectedCustomer: minimalCustomer,
            activeDraftId: order.id,
            editingOrderNumber: null,
            editingOrderStatus: null,
            draftNotes: order.notes || '',
            draftDiscount: {
                type: (order.discount_type as 'fixed' | 'percentage' | null) ?? null,
                amount: Number(order.discount_amount ?? 0),
            },
            items: {}, // Importante: vaciar para que initializeDraft cargue los de DB
            isRehydrating: true, // Bloqueo inmediato para el autosave
            _initializedForCustomerId: null // Forzar reinicialización si era distinto
        });
    },

    prepareEditOrder: (order, orderItems) => {
        const minimalCustomer = {
            id: order.customer_id,
            business_name: order.customers?.business_name || 'Desconocido',
            contact_name: order.customers?.contact_name ?? null,
            phone: order.customers?.phone ?? null,
        } as Customer;

        const newItems: Record<string, OrderItem> = {};
        for (const item of orderItems) {
            // Placeholder si falla la relación
            const productData = (item.products || { id: item.product_id, name: 'Producto no accesible' }) as any;

            const product: Product = {
                id: productData.id,
                name: productData.name,
                brand: productData.brand ?? '',
                caliber: productData.caliber ?? '',
                quality: productData.quality ?? '',
                shipment_number: productData.shipment_number ?? '',
                price: item.unit_price,
                available_quantity: 9999,
                tenant_id: order.tenant_id || '',
                category_id: '',
                status: 'active' as const,
                created_at: '',
            };
            newItems[product.id] = {
                product,
                quantity: item.quantity,
                unitPrice: Number(item.unit_price),
                note: item.notes || undefined,
                discountType: (item.discount_type as 'fixed' | 'percentage') || undefined,
                discountValue: item.discount_type === 'percentage'
                    ? (Number(item.unit_price) * Number(item.quantity) === 0 ? 0 : (Number(item.discount_amount || 0) / (Number(item.unit_price) * Number(item.quantity)) * 100))
                    : Number(item.discount_amount || 0),
            };
        }

        set({
            selectedCustomer: minimalCustomer,
            activeDraftId: order.id,
            editingOrderNumber: order.order_number,
            editingOrderStatus: order.status,
            draftNotes: order.notes || '',
            draftDiscount: {
                type: (order.discount_type as 'fixed' | 'percentage' | null) ?? null,
                amount: Number(order.discount_amount ?? 0),
            },
            items: newItems,
            isRehydrating: false,
            _initializedForCustomerId: order.customer_id
        });
    }
}), {
    name: 'imporfrut-order-storage',
    partialize: (state) => ({
        selectedCustomer: state.selectedCustomer,
        items: state.items,
        activeDraftId: state.activeDraftId,
        draftNotes: state.draftNotes,
        draftDiscount: state.draftDiscount,
        editingOrderNumber: state.editingOrderNumber,
        editingOrderStatus: state.editingOrderStatus,
        _initializedForCustomerId: state._initializedForCustomerId,
    }),
}));
