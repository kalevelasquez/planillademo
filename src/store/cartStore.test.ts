import { describe, it, expect, beforeEach } from 'vitest';
import {
    useCartStore,
    CART_STORAGE_KEY,
    CART_VERSION,
    cartCount,
    cartEstimatedTotal,
    migrateCart,
    type CartItem,
} from './cartStore';
import type { StoreProduct } from '../services/storeService';

const APPLE: StoreProduct = {
    productKey: 'k-apple',
    name: 'Manzana Fuji',
    caliber: '80',
    quality: 'Primera',
    price: 12.5,
    imageUrl: 'https://cdn/a.webp',
    availability: 'Disponible',
};
const PEAR: StoreProduct = { ...APPLE, productKey: 'k-pear', name: 'Pera', price: 3, imageUrl: null };

const reset = () => {
    useCartStore.getState().clear();
    localStorage.clear();
};

beforeEach(reset);

describe('cartStore: agregar y recalcular', () => {
    it('agrega 2 unidades de un Disponible: 2 items y total estimado', () => {
        const res = useCartStore.getState().add(APPLE, 2);
        expect(res).toBe('added');
        const { items } = useCartStore.getState();
        expect(items).toEqual([
            { productKey: 'k-apple', name: 'Manzana Fuji', caliber: '80', quality: 'Primera', price: 12.5, imageUrl: 'https://cdn/a.webp', qty: 2 },
        ]);
        expect(cartCount(items)).toBe(2);
        expect(cartEstimatedTotal(items)).toBe(25);
    });

    it('agregar el mismo producto suma cantidades (una sola linea) y otro producto agrega linea', () => {
        const s = useCartStore.getState();
        s.add(APPLE, 2);
        s.add(APPLE, 3);
        s.add(PEAR, 1);
        const { items } = useCartStore.getState();
        expect(items.map((i) => [i.productKey, i.qty])).toEqual([
            ['k-apple', 5],
            ['k-pear', 1],
        ]);
        expect(cartCount(items)).toBe(6);
        expect(cartEstimatedTotal(items)).toBe(5 * 12.5 + 3);
    });

    it('Agotado: lo bloquea y el carrito no cambia', () => {
        const res = useCartStore.getState().add({ ...APPLE, availability: 'Agotado' }, 1);
        expect(res).toBe('soldOut');
        expect(useCartStore.getState().items).toHaveLength(0);
        useCartStore.getState().add(PEAR, 1);
        expect(useCartStore.getState().add({ ...APPLE, availability: 'Agotado' }, 1)).toBe('soldOut');
        expect(useCartStore.getState().items).toHaveLength(1);
    });

    it('cantidad invalida (0, negativa, decimal) se rechaza', () => {
        const s = useCartStore.getState();
        expect(s.add(APPLE, 0)).toBe('invalid');
        expect(s.add(APPLE, -1)).toBe('invalid');
        expect(s.add(APPLE, 1.5)).toBe('invalid');
        expect(useCartStore.getState().items).toHaveLength(0);
        expect(s.add(APPLE, 1)).toBe('added');
    });

    it('tope por linea 500: sumar mas lo recorta; tope de 30 lineas rechaza la 31', () => {
        const s = useCartStore.getState();
        s.add(APPLE, 400);
        s.add(APPLE, 400);
        expect(useCartStore.getState().items[0].qty).toBe(500);
        useCartStore.getState().clear();
        for (let i = 0; i < 30; i++) expect(useCartStore.getState().add({ ...APPLE, productKey: `k${i}` }, 1)).toBe('added');
        expect(useCartStore.getState().add({ ...APPLE, productKey: 'extra' }, 1)).toBe('limit');
        expect(useCartStore.getState().items).toHaveLength(30);
        // una linea ya existente sigue pudiendo crecer aunque se haya llegado a 30
        expect(useCartStore.getState().add({ ...APPLE, productKey: 'k0' }, 1)).toBe('added');
    });
});

describe('cartStore: setQty, remove, clear', () => {
    it('setQty cambia la cantidad; fuera de rango 1..500 se ajusta; no entero se ignora', () => {
        const s = useCartStore.getState();
        s.add(APPLE, 2);
        s.setQty('k-apple', 7);
        expect(useCartStore.getState().items[0].qty).toBe(7);
        s.setQty('k-apple', 9999);
        expect(useCartStore.getState().items[0].qty).toBe(500);
        s.setQty('k-apple', 0);
        expect(useCartStore.getState().items[0].qty).toBe(1);
        s.setQty('k-apple', 2.5);
        expect(useCartStore.getState().items[0].qty).toBe(1);
        s.setQty('inexistente', 4);
        expect(useCartStore.getState().items).toHaveLength(1);
    });

    it('remove quita solo esa linea y clear vacia', () => {
        const s = useCartStore.getState();
        s.add(APPLE, 1);
        s.add(PEAR, 1);
        s.remove('k-apple');
        expect(useCartStore.getState().items.map((i) => i.productKey)).toEqual(['k-pear']);
        s.clear();
        expect(useCartStore.getState().items).toEqual([]);
    });
});

describe('cartStore: totales puros', () => {
    it('cartEstimatedTotal y cartCount sobre listas distintas; precios no finitos cuentan 0', () => {
        const items: CartItem[] = [
            { productKey: 'a', name: 'A', caliber: null, quality: null, price: 1.1, imageUrl: null, qty: 3 },
            { productKey: 'b', name: 'B', caliber: null, quality: null, price: Number.NaN, imageUrl: null, qty: 2 },
        ];
        expect(cartCount(items)).toBe(5);
        expect(cartEstimatedTotal(items)).toBeCloseTo(3.3, 5);
        expect(cartEstimatedTotal([])).toBe(0);
    });
});

describe('cartStore: persistencia y migracion', () => {
    it('persiste en localStorage bajo teknergy-cart-v1 con version', () => {
        useCartStore.getState().add(APPLE, 2);
        const raw = localStorage.getItem(CART_STORAGE_KEY);
        expect(CART_STORAGE_KEY).toBe('teknergy-cart-v1');
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw as string);
        expect(parsed.version).toBe(CART_VERSION);
        expect(parsed.state.items[0]).toMatchObject({ productKey: 'k-apple', qty: 2 });
    });

    it('rehidrata desde localStorage', async () => {
        localStorage.setItem(
            CART_STORAGE_KEY,
            JSON.stringify({
                version: CART_VERSION,
                state: { items: [{ productKey: 'k-pear', name: 'Pera', caliber: null, quality: null, price: 3, imageUrl: null, qty: 4 }] },
            }),
        );
        await useCartStore.persist.rehydrate();
        expect(useCartStore.getState().items).toEqual([
            { productKey: 'k-pear', name: 'Pera', caliber: null, quality: null, price: 3, imageUrl: null, qty: 4 },
        ]);
    });

    it('datos corruptos o tipos invalidos se descartan al rehidratar (sin romper)', async () => {
        localStorage.setItem(
            CART_STORAGE_KEY,
            JSON.stringify({
                version: CART_VERSION,
                state: {
                    items: [
                        { productKey: 'ok', name: 'Ok', price: 2, qty: 1 },
                        { productKey: '', name: 'sin clave', price: 2, qty: 1 },
                        { productKey: 'neg', name: 'Neg', price: 2, qty: -3 },
                        { productKey: 'dup', name: 'D', price: 1, qty: 1 },
                        { productKey: 'dup', name: 'D', price: 1, qty: 1 },
                        'basura',
                    ],
                },
            }),
        );
        await useCartStore.persist.rehydrate();
        expect(useCartStore.getState().items.map((i) => i.productKey)).toEqual(['ok', 'dup']);
    });

    it('migrateCart: version vieja con forma conocida se rescata; basura da carrito vacio', () => {
        const old = migrateCart({ items: [{ productKey: 'x', name: 'X', price: 5, qty: 2 }] });
        expect(old.items).toEqual([
            { productKey: 'x', name: 'X', caliber: null, quality: null, price: 5, imageUrl: null, qty: 2 },
        ]);
        expect(migrateCart('???').items).toEqual([]);
        expect(migrateCart(null).items).toEqual([]);
    });
});
