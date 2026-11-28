import { describe, it, expect } from 'vitest';
import { formatPrice, formatPhone, pickFeatured, formatOrderDate } from './storeFormat';
import type { StoreProduct } from '../../../../services/storeService';

const p = (over: Partial<StoreProduct>): StoreProduct => ({
    productKey: 'k',
    name: 'Producto',
    caliber: null,
    quality: null,
    price: 1,
    imageUrl: null,
    availability: 'Disponible',
    ...over,
});

describe('formatPrice', () => {
    it.each([
        [12.5, '$12.50'],
        [0, '$0.00'],
        [1234.5, '$1,234.50'],
        [0.1 + 0.2, '$0.30'],
    ])('%s => %s', (n, expected) => {
        expect(formatPrice(n)).toBe(expected);
    });

    it('un valor no finito no rompe la UI', () => {
        expect(formatPrice(Number.NaN)).toBe('$0.00');
    });
});

describe('pickFeatured', () => {
    const list = [
        p({ productKey: 'a', availability: 'Agotado', imageUrl: 'x' }),
        p({ productKey: 'b', imageUrl: null }),
        p({ productKey: 'c', imageUrl: 'y' }),
        p({ productKey: 'd', imageUrl: 'z' }),
        p({ productKey: 'e', imageUrl: null }),
    ];

    it('prioriza disponibles con imagen, luego disponibles sin imagen, luego agotados (orden estable)', () => {
        expect(pickFeatured(list, 5).map((x) => x.productKey)).toEqual(['c', 'd', 'b', 'e', 'a']);
    });

    it('respeta el maximo pedido', () => {
        expect(pickFeatured(list, 2).map((x) => x.productKey)).toEqual(['c', 'd']);
    });

    it('lista corta o vacia: devuelve lo que hay', () => {
        expect(pickFeatured([list[1]], 4).map((x) => x.productKey)).toEqual(['b']);
        expect(pickFeatured([], 4)).toEqual([]);
    });
});

describe('formatPhone', () => {
    it.each([
        ['50377772397', '+503 7777-2397'],
        ['50300000000', '+503 0000-0000'],
    ])('formato El Salvador %s => %s', (raw, expected) => {
        expect(formatPhone(raw)).toBe(expected);
    });

    it('un numero con otro formato se devuelve con "+" sin inventar separadores', () => {
        expect(formatPhone('12025550123')).toBe('+12025550123');
    });
});

describe('formatOrderDate', () => {
    it('formatea en la zona de El Salvador (UTC-6) segun el idioma', () => {
        expect(formatOrderDate('2026-12-08T10:00:00Z', 'es')).toMatch(/8.*dic.*2026/i);
        expect(formatOrderDate('2026-12-08T10:00:00Z', 'en')).toMatch(/Dec.*8.*2026/);
    });

    it('usa la zona local, no UTC: 03:00Z del dia 9 sigue siendo dia 8 en El Salvador', () => {
        expect(formatOrderDate('2026-12-09T03:00:00Z', 'es')).toMatch(/8.*dic/i);
    });

    it('fecha invalida => cadena vacia (nunca "Invalid Date")', () => {
        expect(formatOrderDate('no-es-fecha', 'es')).toBe('');
        expect(formatOrderDate('', 'es')).toBe('');
    });
});
