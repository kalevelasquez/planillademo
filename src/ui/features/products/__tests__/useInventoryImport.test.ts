import { describe, it, expect, vi } from 'vitest';

// Mocking dependencies that trigger Supabase initialization
vi.mock('../../../../services/authService', () => ({
    supabase: {
        auth: { getUser: vi.fn() },
        storage: { from: vi.fn() }
    }
}));

import { productSchema } from '../useInventoryImport';

describe('useInventoryImport Schema Validation', () => {
    it('should validate a correct product payload', () => {
        const payload = {
            name: 'Manzana Fuji',
            quality: 'CAT 1',
            caliber: '100s',
            brand: 'Washington',
            shipment_number: 'EMB-001',
            category: 'Frutas',
            entry_date: '2026-03-04',
            price: 15.5,
            available_quantity: 100
        };

        const result = productSchema.safeParse(payload);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.name).toBe('Manzana Fuji');
        }
    });

    it('should fail validation if required fields are missing', () => {
        const payload = {
            name: '', // Empty name should fail min(1)
            quality: 'CAT 1',
            caliber: '',
            brand: 'Washington',
            shipment_number: 'EMB-001',
        };

        const result = productSchema.safeParse(payload);
        expect(result.success).toBe(false);
        if (!result.success) {
            const errorMessages = result.error.issues.map(i => i.message);
            expect(errorMessages).toContain('El producto es requerido');
            expect(errorMessages).toContain('El calibre es requerido');
        }
    });

    it('should apply default values for non-required fields', () => {
        const payload = {
            name: 'Pera Packham',
            quality: 'Premium',
            caliber: '80s',
            brand: 'Del Sur',
            shipment_number: 'EMB-002',
            // Missing category, price and available_quantity
        };

        const result = productSchema.safeParse(payload);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.category).toBe('OTROS');
            expect(result.data.price).toBe(0);
            expect(result.data.available_quantity).toBe(0);
        }
    });

    it('should fail if price or quantity are negative', () => {
        const payload = {
            name: 'Kiwi',
            quality: 'Extra',
            caliber: '30s',
            brand: 'Zespri',
            shipment_number: 'EMB-003',
            price: -5,
            available_quantity: -10
        };

        const result = productSchema.safeParse(payload);
        expect(result.success).toBe(false);
        if (!result.success) {
            const errorMessages = result.error.issues.map(i => i.message);
            expect(errorMessages).toContain('El precio debe ser mayor o igual a 0');
            expect(errorMessages).toContain('El inventario debe ser mayor o igual a 0');
        }
    });
});
