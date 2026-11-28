import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MAX_ORDER_ITEMS, MAX_ORDER_QUANTITY, type StoreProduct } from '../services/storeService';

/**
 * cartStore.ts
 * ─────────────────────────────────────────────────────────────────
 * Carrito LOCAL de la tienda (persistido en localStorage). NO es fuente de verdad de precios: el
 * precio guardado es solo una estimacion para mostrar; el servidor recalcula todo al crear el
 * pedido (`store_create_order` recibe unicamente product_key + quantity).
 */

export const CART_STORAGE_KEY = 'teknergy-cart-v1';
export const CART_VERSION = 1;

export interface CartItem {
    productKey: string;
    name: string;
    caliber: string | null;
    quality: string | null;
    /** Precio de catalogo al momento de agregar: solo estimado. */
    price: number;
    imageUrl: string | null;
    qty: number;
}

export type AddResult = 'added' | 'soldOut' | 'invalid' | 'limit';

interface CartState {
    items: CartItem[];
    add: (product: StoreProduct, qty?: number) => AddResult;
    setQty: (productKey: string, qty: number) => void;
    remove: (productKey: string) => void;
    clear: () => void;
}

const isValidQty = (q: unknown): q is number => Number.isInteger(q) && (q as number) >= 1;
const clampQty = (q: number): number => Math.min(Math.max(q, 1), MAX_ORDER_QUANTITY);

/** Unidades totales (suma de cantidades). */
export const cartCount = (items: CartItem[]): number => items.reduce((n, i) => n + i.qty, 0);

/** Total ESTIMADO con los precios guardados. Un precio no finito cuenta como 0. */
export const cartEstimatedTotal = (items: CartItem[]): number =>
    items.reduce((sum, i) => sum + (Number.isFinite(i.price) ? i.price : 0) * i.qty, 0);

const asNullableString = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** Normaliza una lista persistida: descarta lo invalido, deduplica por clave y acota cantidades/lineas. */
const sanitizeItems = (raw: unknown): CartItem[] => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: CartItem[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        if (typeof e.productKey !== 'string' || e.productKey.trim() === '' || seen.has(e.productKey)) continue;
        if (typeof e.name !== 'string' || !isValidQty(e.qty)) continue;
        const price = typeof e.price === 'number' && Number.isFinite(e.price) && e.price >= 0 ? e.price : 0;
        seen.add(e.productKey);
        out.push({
            productKey: e.productKey,
            name: e.name,
            caliber: asNullableString(e.caliber),
            quality: asNullableString(e.quality),
            price,
            imageUrl: asNullableString(e.imageUrl),
            qty: clampQty(e.qty),
        });
        if (out.length >= MAX_ORDER_ITEMS) break;
    }
    return out;
};

/**
 * Migra el estado persistido de cualquier version anterior a la actual. Hoy solo existe la v1, asi que
 * migrar = sanear lo que haya (forma desconocida/basura => carrito vacio). Una v2 ramificara por version.
 */
export const migrateCart = (persisted: unknown): { items: CartItem[] } => {
    const items = persisted && typeof persisted === 'object' ? (persisted as { items?: unknown }).items : undefined;
    return { items: sanitizeItems(items) };
};

export const useCartStore = create<CartState>()(
    persist(
        (set, get) => ({
            items: [],

            add: (product, qty = 1) => {
                if (product.availability !== 'Disponible') return 'soldOut';
                if (!isValidQty(qty)) return 'invalid';
                const { items } = get();
                const existing = items.find((i) => i.productKey === product.productKey);
                if (existing) {
                    set({
                        items: items.map((i) =>
                            i.productKey === product.productKey ? { ...i, qty: clampQty(i.qty + qty) } : i,
                        ),
                    });
                    return 'added';
                }
                if (items.length >= MAX_ORDER_ITEMS) return 'limit';
                set({
                    items: [
                        ...items,
                        {
                            productKey: product.productKey,
                            name: product.name,
                            caliber: product.caliber,
                            quality: product.quality,
                            price: product.price,
                            imageUrl: product.imageUrl,
                            qty: clampQty(qty),
                        },
                    ],
                });
                return 'added';
            },

            setQty: (productKey, qty) => {
                if (!get().items.some((i) => i.productKey === productKey)) return;
                const next = isValidQty(qty) ? clampQty(qty) : 1;
                set({ items: get().items.map((i) => (i.productKey === productKey ? { ...i, qty: next } : i)) });
            },

            remove: (productKey) => set({ items: get().items.filter((i) => i.productKey !== productKey) }),

            clear: () => set({ items: [] }),
        }),
        {
            name: CART_STORAGE_KEY,
            version: CART_VERSION,
            partialize: (state) => ({ items: state.items }),
            migrate: (persisted) => migrateCart(persisted),
            // Misma version pero localStorage manipulado/corrupto: tambien se sanea.
            merge: (persisted, current) => ({
                ...current,
                items: sanitizeItems((persisted as { items?: unknown } | undefined)?.items),
            }),
        },
    ),
);
