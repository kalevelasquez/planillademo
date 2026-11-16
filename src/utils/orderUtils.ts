import { type OrderItem } from '../store/orderStore';
import { type Product } from '../services/productService';

/**
 * CA1: Lógica de cálculo de totales y descuentos (US-NFR-02)
 * Extraída a utilidades puras para facilitar el testeo unitario sin dependencias de React/Zustand.
 */
export interface CalculatedOrderItem extends OrderItem {
    unitPrice: number;
    discountAmount: number;
    total: number;
}

export const calculateItemTotals = (item: OrderItem, catalogProduct?: Product): CalculatedOrderItem => {
    const displayProduct = item.product || catalogProduct;
    const unitPrice = Number(item.unitPrice ?? displayProduct?.price ?? 0);
    const quantity = Number(item.quantity || 0);

    let discountAmount = 0;
    if (item.discountType === 'fixed') {
        discountAmount = Number(item.discountValue || 0);
    } else if (item.discountType === 'percentage') {
        discountAmount = (unitPrice * quantity) * (Number(item.discountValue || 0) / 100);
    }

    return {
        ...item,
        unitPrice,
        discountAmount,
        total: (unitPrice * quantity) - discountAmount
    };
};

export const calculateOrderSummary = (items: CalculatedOrderItem[]) => {
    const subtotal = items.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
    const totalDiscount = items.reduce((sum, item) => sum + (item.discountAmount || 0), 0);
    const totalFinal = Math.max(0, subtotal - totalDiscount);
    const totalItemsCount = items.reduce((sum, item) => sum + item.quantity, 0);

    return {
        subtotal,
        totalDiscount,
        totalFinal,
        totalItemsCount
    };
};
