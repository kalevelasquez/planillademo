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

export type StoreErrorKey = 'store.errors.store_unavailable' | 'store.errors.generic';

export class StoreError extends Error {
    readonly i18nKey: StoreErrorKey;

    constructor(i18nKey: StoreErrorKey) {
        super(i18nKey);
        this.name = 'StoreError';
        this.i18nKey = i18nKey;
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
