import { storeSupabase } from '../config/storeSupabaseClient';
import { STORE_TENANT_ID } from '../config/env';

/**
 * storeService.ts
 * ─────────────────────────────────────────────────────────────────
 * Catalogo PUBLICO de la tienda. Habla SOLO con el cliente anon de tienda (`storeSupabase`) y con
 * los RPCs SECURITY DEFINER `store_list_products` / `store_get_product` (migracion B1.3), que ya
 * filtran por `tenants.store_enabled` y devuelven columnas seguras. Nunca importa el cliente admin.
 *
 * Defensa en profundidad: el mapeo es una LISTA BLANCA de campos; aunque el RPC devolviera algo
 * de mas (stock, costo, lote), no llega a la UI.
 */

export type Availability = 'Disponible' | 'Agotado';

export interface StoreProduct {
    /** Clave opaca (md5) del grupo nombre+calibre+calidad. No es un id interno. */
    productKey: string;
    name: string;
    caliber: string | null;
    quality: string | null;
    price: number;
    imageUrl: string | null;
    availability: Availability;
}

export type StoreErrorKey =
    | 'store.errors.store_unavailable'
    | 'store.errors.generic'
    | 'store.errors.auth_required'
    | 'store.errors.email_unconfirmed'
    | 'store.errors.too_many_pending'
    | 'store.errors.invalid_items'
    | 'store.errors.too_many_items'
    | 'store.errors.invalid_quantity'
    | 'store.errors.product_unavailable'
    | 'store.errors.insufficient_availability'
    // Auth de cliente (storeAuthService)
    | 'store.errors.invalid_credentials'
    | 'store.errors.signup_unavailable'
    | 'store.errors.weak_password'
    | 'store.errors.rate_limited'
    | 'store.errors.invalid_email';

export class StoreError extends Error {
    readonly i18nKey: StoreErrorKey;
    /** Solo para `insufficient_availability`: nombre del producto (NUNCA cantidades). */
    readonly productName?: string;

    constructor(i18nKey: StoreErrorKey, productName?: string) {
        super(i18nKey);
        this.name = 'StoreError';
        this.i18nKey = i18nKey;
        this.productName = productName;
    }
}

export interface ListProductsParams {
    search?: string;
    limit?: number;
    offset?: number;
}

export const DEFAULT_PAGE_SIZE = 48;

interface CatalogRow {
    product_key: string;
    name: string;
    caliber: string | null;
    quality: string | null;
    price: number | string | null;
    image_url: string | null;
    availability: string | null;
}

const toStoreProduct = (row: CatalogRow): StoreProduct => ({
    productKey: row.product_key,
    name: row.name,
    caliber: row.caliber ?? null,
    quality: row.quality ?? null,
    price: Number(row.price ?? 0),
    imageUrl: row.image_url?.trim() || null,
    // Default seguro: ante un valor inesperado jamas se ofrece como disponible.
    availability: row.availability === 'Disponible' ? 'Disponible' : 'Agotado',
});

const requireTenant = (): string => {
    if (!STORE_TENANT_ID) throw new StoreError('store.errors.store_unavailable');
    return STORE_TENANT_ID;
};

const callRpc = async (fn: string, args: Record<string, unknown>): Promise<CatalogRow[]> => {
    try {
        const { data, error } = await storeSupabase.rpc(fn, args);
        if (error) throw new StoreError('store.errors.generic');
        return (data ?? []) as CatalogRow[];
    } catch (e) {
        throw e instanceof StoreError ? e : new StoreError('store.errors.generic');
    }
};

export async function listProducts(params: ListProductsParams = {}): Promise<StoreProduct[]> {
    const tenantId = requireTenant();
    const rows = await callRpc('store_list_products', {
        p_tenant_id: tenantId,
        p_search: params.search?.trim() || null,
        p_limit: params.limit ?? DEFAULT_PAGE_SIZE,
        p_offset: params.offset ?? 0,
    });
    return rows.map(toStoreProduct);
}

export async function getProduct(productKey: string): Promise<StoreProduct | null> {
    const key = productKey.trim();
    if (!key) return null;
    const tenantId = requireTenant();
    const rows = await callRpc('store_get_product', { p_tenant_id: tenantId, p_product_key: key });
    return rows.length > 0 ? toStoreProduct(rows[0]) : null;
}

// ─────────────────────────────────────────────────────────────────
// Pedidos web (F2). Requiere sesion de CLIENTE de tienda en `storeSupabase`.
// ─────────────────────────────────────────────────────────────────

/** Espejo de los limites del RPC `store_create_order` (el servidor es quien manda). */
export const MAX_ORDER_ITEMS = 30;
export const MAX_ORDER_QUANTITY = 500;

export interface OrderItemInput {
    productKey: string;
    quantity: number;
}

export interface CreatedOrder {
    orderId: string;
    orderNumber: string;
    total: number;
}

interface CreatedOrderRow {
    order_id: string;
    order_number: string;
    total: number | string;
}

interface RpcErrorLike {
    code?: string | null;
    details?: string | null;
}

/** SQLSTATE del RPC (migracion 20261208100000) => clave i18n. */
const ORDER_ERROR_BY_CODE: Record<string, StoreErrorKey> = {
    SW002: 'store.errors.product_unavailable',
    SW003: 'store.errors.invalid_quantity',
    SW004: 'store.errors.too_many_items',
    SW005: 'store.errors.invalid_items',
    SW006: 'store.errors.too_many_pending',
    SW007: 'store.errors.email_unconfirmed',
    SW008: 'store.errors.store_unavailable',
    '42501': 'store.errors.auth_required',
};

const toOrderError = (error: RpcErrorLike): StoreError => {
    const code = error.code ?? '';
    if (code === 'SW001') {
        // El detalle trae solo el nombre del producto; el mensaje del servidor NO se propaga.
        const name = error.details?.trim();
        return new StoreError('store.errors.insufficient_availability', name || undefined);
    }
    return new StoreError(ORDER_ERROR_BY_CODE[code] ?? 'store.errors.generic');
};

const validateOrderItems = (items: OrderItemInput[]): void => {
    if (!Array.isArray(items) || items.length === 0) throw new StoreError('store.errors.invalid_items');
    if (items.length > MAX_ORDER_ITEMS) throw new StoreError('store.errors.too_many_items');
    for (const item of items) {
        if (typeof item?.productKey !== 'string' || item.productKey.trim() === '') {
            throw new StoreError('store.errors.invalid_items');
        }
        const q = item.quantity;
        if (!Number.isInteger(q) || q < 1 || q > MAX_ORDER_QUANTITY) {
            throw new StoreError('store.errors.invalid_quantity');
        }
    }
};

/**
 * Crea un pedido web Pending (pago contra entrega). Envia SOLO `product_key` y `quantity`:
 * precio, tenant, cliente y vendedor los resuelve el servidor desde la sesion (nunca se mandan).
 * Cualquier fallo se traduce a un `StoreError` con clave i18n; el mensaje de la base no se filtra.
 */
export async function createStoreOrder(items: OrderItemInput[], notes?: string): Promise<CreatedOrder> {
    validateOrderItems(items);

    let data: unknown;
    try {
        const res = await storeSupabase.rpc('store_create_order', {
            p_items: items.map((i) => ({ product_key: i.productKey.trim(), quantity: i.quantity })),
            p_notes: notes?.trim() || null,
        });
        if (res.error) throw toOrderError(res.error);
        data = res.data;
    } catch (e) {
        throw e instanceof StoreError ? e : new StoreError('store.errors.generic');
    }

    const row = (Array.isArray(data) ? data[0] : data) as CreatedOrderRow | null | undefined;
    if (!row?.order_id || !row.order_number) throw new StoreError('store.errors.generic');
    return { orderId: row.order_id, orderNumber: row.order_number, total: Number(row.total ?? 0) };
}

// ─────────────────────────────────────────────────────────────────
// Cuenta y pedidos del cliente (F2). Solo lee la fila ligada a `auth.uid()` (RPCs DEFINER).
// ─────────────────────────────────────────────────────────────────

export interface StoreAccount {
    contactName: string | null;
    phone: string | null;
    address: string | null;
    department: string | null;
    municipality: string | null;
    email: string | null;
}

export interface MyOrderItem {
    name: string;
    caliber: string | null;
    quality: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
}

export interface MyOrder {
    orderNumber: string;
    /** Estado crudo de la base (Pending, Approved, Cancelled...). La UI lo traduce. */
    status: string;
    total: number;
    createdAt: string;
    items: MyOrderItem[];
}

const asText = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** Ejecuta un RPC del cliente: SQLSTATE 42501 => auth_required; cualquier otro fallo => generic. */
const callCustomerRpc = async (fn: string): Promise<unknown[]> => {
    try {
        const { data, error } = await storeSupabase.rpc(fn);
        if (error) {
            throw new StoreError(error.code === '42501' ? 'store.errors.auth_required' : 'store.errors.generic');
        }
        return Array.isArray(data) ? data : [];
    } catch (e) {
        throw e instanceof StoreError ? e : new StoreError('store.errors.generic');
    }
};

export async function getMyAccount(): Promise<StoreAccount | null> {
    const rows = (await callCustomerRpc('store_get_my_account')) as Record<string, unknown>[];
    const row = rows[0];
    if (!row) return null;
    return {
        contactName: asText(row.contact_name),
        phone: asText(row.phone),
        address: asText(row.address),
        department: asText(row.department),
        municipality: asText(row.municipality),
        email: asText(row.email),
    };
}

const toMyOrderItem = (raw: unknown): MyOrderItem | null => {
    if (!raw || typeof raw !== 'object') return null;
    const i = raw as Record<string, unknown>;
    return {
        name: typeof i.name === 'string' ? i.name : '',
        caliber: asText(i.caliber),
        quality: asText(i.quality),
        quantity: Number(i.quantity ?? 0),
        unitPrice: Number(i.unit_price ?? 0),
        lineTotal: Number(i.total_price ?? 0),
    };
};

export async function listMyOrders(): Promise<MyOrder[]> {
    const rows = (await callCustomerRpc('store_list_my_orders')) as Record<string, unknown>[];
    return rows.map((r) => ({
        orderNumber: String(r.order_number ?? ''),
        status: String(r.status ?? ''),
        total: Number(r.total_amount ?? 0),
        createdAt: String(r.created_at ?? ''),
        items: Array.isArray(r.items)
            ? r.items.map(toMyOrderItem).filter((i): i is MyOrderItem => i !== null)
            : [],
    }));
}
