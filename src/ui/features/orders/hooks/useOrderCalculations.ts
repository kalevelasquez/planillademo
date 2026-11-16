import { useMemo } from 'react';
import { useOrderStore } from '../../../../store/orderStore';
import { useProductStore } from '../../../../store/productStore';
import { calculateItemTotals, calculateOrderSummary } from '../../../../utils/orderUtils';

export const useOrderCalculations = () => {
    const items = useOrderStore(state => state.items);
    const products = useProductStore(state => state.products);

    const orderItemsDetails = useMemo(() => {
        const rawItems = Object.values(items);
        console.log('[DEBUG] useOrderCalculations: Processing items', rawItems.length);

        return rawItems.filter(item => {
            const hasQty = item.quantity > 0;
            if (!hasQty) console.warn('[DEBUG] useOrderCalculations: Item filtered out (qty <= 0)', item.product?.id);
            return hasQty;
        }).map(item => {
            const catalogProduct = products.find(p => p.id === item.product.id);
            const calculatedItem = calculateItemTotals(item, catalogProduct);

            // US-ORD-03: Validación contra stock EN VIVO del catálogo si está disponible
            const currentAvailable = catalogProduct ? (catalogProduct.available_quantity ?? 0) : (item.product?.available_quantity ?? 0);
            const isInsufficientStock = item.quantity > currentAvailable;

            return {
                ...calculatedItem,
                product: {
                    ...(item.product || catalogProduct as any),
                    available_quantity: currentAvailable // Asegurar que el objeto product del ítem tenga el stock actualizado para la UI
                },
                discount_amount: calculatedItem.discountAmount, // Mantener compatibilidad con UI legacy
                isInsufficientStock // US-ORD-03
            };
        });
    }, [items, products]);

    const summary = useMemo(() =>
        calculateOrderSummary(orderItemsDetails as any),
        [orderItemsDetails]);

    const hasItems = orderItemsDetails.length > 0;

    return {
        orderItemsDetails,
        hasItems,
        subtotal: summary.subtotal,
        totalDiscount: summary.totalDiscount,
        totalItemsCount: summary.totalItemsCount,
        totalFinal: summary.totalFinal
    };
};
