import { describe, it, expect, vi } from 'vitest';

// Mocking dependencies that trigger Supabase initialization before any imports
vi.mock('../services/authService', () => ({
    supabase: {
        auth: { getUser: vi.fn() },
        from: vi.fn()
    }
}));

import { calculateItemTotals, calculateOrderSummary } from './orderUtils';
import { type OrderItem } from '../store/orderStore';

describe('orderUtils - Totals and Discounts (CA1)', () => {
    const mockProduct = {
        id: 'prod-1',
        name: 'Producto Test',
        price: 100,
        available_quantity: 10,
        tenant_id: 't1',
        category_id: 'c1',
        brand: '',
        caliber: '',
        quality: '',
        shipment_number: 'SN-001',
        status: 'active' as const,
        created_at: ''
    };

    describe('calculateItemTotals', () => {
        it('should calculate total without discount', () => {
            const item: OrderItem = {
                product: mockProduct,
                quantity: 2
            };
            const result = calculateItemTotals(item);
            expect(result.unitPrice).toBe(100);
            expect(result.total).toBe(200);
            expect(result.discountAmount).toBe(0);
        });

        it('should apply fixed discount', () => {
            const item: OrderItem = {
                product: mockProduct,
                quantity: 2,
                discountType: 'fixed',
                discountValue: 15
            };
            const result = calculateItemTotals(item);
            expect(result.discountAmount).toBe(15);
            expect(result.total).toBe(185);
        });

        it('should apply percentage discount', () => {
            const item: OrderItem = {
                product: mockProduct,
                quantity: 2,
                discountType: 'percentage',
                discountValue: 10 // 10% of (100 * 2) = 20
            };
            const result = calculateItemTotals(item);
            expect(result.discountAmount).toBe(20);
            expect(result.total).toBe(180);
        });

        it('should use overridden unit price', () => {
            const item: OrderItem = {
                product: mockProduct,
                quantity: 2,
                unitPrice: 90 // Price negotiated
            };
            const result = calculateItemTotals(item);
            expect(result.unitPrice).toBe(90);
            expect(result.total).toBe(180);
        });
    });

    describe('calculateOrderSummary', () => {
        it('should summarize multiple items correctly', () => {
            const items = [
                { unitPrice: 100, quantity: 2, discountAmount: 20, total: 180 },
                { unitPrice: 50, quantity: 1, discountAmount: 0, total: 50 }
            ] as any;

            const result = calculateOrderSummary(items);
            expect(result.subtotal).toBe(250);
            expect(result.totalDiscount).toBe(20);
            expect(result.totalFinal).toBe(230);
            expect(result.totalItemsCount).toBe(3);
        });
    });
});
