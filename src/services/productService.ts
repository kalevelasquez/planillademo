// [AI: DEDUPLICATION_FIX_APPLIED_V2]
import { supabase } from './authService';
import { Logger } from '../utils/logger';

export interface ProductCategory {
    id: string;
    tenant_id: string;
    name: string;
}

export interface Product {
    id: string;
    tenant_id: string;
    status: 'active' | 'incomplete' | 'unavailable'; // Added 'unavailable' for CA5 US-INV-03
    name: string;
    category_id: string;
    brand: string;
    caliber: string;
    quality: string;
    shipment_number: string;
    sku_sintetico?: string;
    last_import_id?: string | null; // UUID references inventory_imports(id)
    entry_date?: string | null;
    available_quantity: number;
    price: number;
    created_at: string;
    product_categories?: {
        name: string;
    };
    category?: string; // Para compatibilidad
}

export interface ProductDB extends Omit<Product, 'product_categories'> {
    product_categories?: { name: string } | null;
}

// ── Tipos de Filtros (Homologación UI v1.0 — Single-Select) ─────────────────
// Migrado de arrays multi-select a strings simples para alinearse con
// el patrón FilterBar + SelectField del UI Kit (03-Mar-2026).
export interface FilterState {
    category: string;        // Nombre de categoría ('' = sin filtro)
    caliber: string;
    brand: string;
    quality: string;
    shipmentNumber: string;
}

export const INITIAL_FILTERS: FilterState = {
    category: '',
    caliber: '',
    brand: '',
    quality: '',
    shipmentNumber: '',
};

export interface FilterOptions {
    categories: string[];
    calibers: string[];
    brands: string[];
    qualities: string[];
    shipmentNumbers: string[];
}

/** CA8 US-INV-01 — Registro de auditoría de importación masiva */
export interface InventoryImportRecord {
    id: string;
    file_name: string;
    row_count: number;
    success_count: number;
    error_count: number;
    created_at: string;
    created_by_name: string;
    metadata?: { new_count: number; updated_count: number };
}

// ── Servicio ─────────────────────────────────────────────────────────────────

export const productService = {

    /**
     * Obtiene productos con filtros multidimensionales (Blueprint v2.0 §3.5).
     * Lógica: OR dentro del grupo + AND entre grupos.
     * Ordenamiento: shipment_number DESC como proxy de fecha de embarque.
     */
    async getProducts(
        page: number = 1,
        searchQuery: string = '',
        limit: number = 20,
        status: string | string[] | null = 'active',
        filters: FilterState = INITIAL_FILTERS,
        excludeHistorical: boolean = false
    ): Promise<{ data: Product[], count: number }> {

        let latestImportId: string | null = null;
        if (excludeHistorical) {
            const { data: importData } = await supabase
                .from('inventory_imports')
                .select('id')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            latestImportId = importData?.id || null;
        }

        // Necesitamos los IDs de categoría cuando se filtra por categoría (nombre → id)
        // La unión ya existe en el select, usamos la sub-relación para el filtro
        let query = supabase
            .from('products')
            .select('*, product_categories(name)', { count: 'exact' })
            // Ordenamiento primario: shipment_number DESC (proxy de embarque más reciente)
            // Supabase ordena strings lexicográficamente; para números como string es correcto
            // para valores del tipo "EMB-001", "EMB-002", etc.
            .order('shipment_number', { ascending: false })
            .order('created_at', { ascending: false }); // Fallback secundario

        if (status) {
            if (Array.isArray(status)) {
                query = query.in('status', status);
            } else {
                query = query.eq('status', status);
            }
        }

        if (excludeHistorical && latestImportId) {
            query = query.or(`status.neq.unavailable,last_import_id.eq.${latestImportId}`);
        }

        // Búsqueda de texto libre multi-término (US-CAT-01 v3) - Super Intuitivo
        // Encapsulamos todas las condiciones en una única cláusula or de PostgREST con lógica and(...)
        if (searchQuery.trim()) {
            const words = searchQuery.trim().split(/\s+/).filter(Boolean);
            const andConditions = words.map(word => {
                const term = `%${word.replace(/[()[\],]/g, '')}%`;
                return `or(name.ilike.${term},brand.ilike.${term},caliber.ilike.${term},quality.ilike.${term},shipment_number.ilike.${term})`;
            });

            if (andConditions.length > 0) {
                // PostgREST: or=(and(or1, or2, ...))
                query = query.or(`and(${andConditions.join(',')})`);
            }
        }

        // ── Pre-fetch: resolver nombre de categoría → category_id (server-side) ──
        // Supabase no permite filtrar por columnas de tablas relacionadas desde
        // .from('products'). Solución: convertir el nombre en el UUID con una
        // query separada, luego .eq('category_id', id) en la query principal.
        // ilike() garantiza case-insensitive. maybeSingle() evita error si no existe.
        let categoryId: string | null = null;
        if (filters.category) {
            const { data: catRow } = await supabase
                .from('product_categories')
                .select('id')
                .ilike('name', filters.category)
                .maybeSingle();
            categoryId = catRow?.id ?? null;
        }

        // Filtros server-side sobre columnas directas de products
        if (categoryId) query = query.eq('category_id', categoryId);
        if (filters.caliber) query = query.eq('caliber', filters.caliber);
        if (filters.brand) query = query.eq('brand', filters.brand);
        if (filters.quality) query = query.eq('quality', filters.quality);
        if (filters.shipmentNumber) query = query.eq('shipment_number', filters.shipmentNumber);

        // Paginación
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        const { data, count, error } = await query.range(from, to);

        if (error) throw error;

        // Mapeo: denormalizar nombre de categoría desde la relación join
        const mappedData = (data || []).map((p: ProductDB) => ({
            ...p,
            category: p.product_categories?.name || 'Otros',
        })) as Product[];

        return { data: mappedData, count: count || 0 };
    },

    /** Trae todas las categorías de la tabla maestra product_categories.
     *  Se usa para rellenar filterOptions.categories (fuente estática, independiente
     *  del catálogo paginado actual).
     */
    async getCategories(): Promise<ProductCategory[]> {
        const { data, error } = await supabase
            .from('product_categories')
            .select('id, tenant_id, name')
            .order('name');
        if (error) throw error;
        return data || [];
    },

    /**
     * Top N productos más pedidos por un cliente específico.
     * Estrategia: 3 queries encadenadas (Opción C — Blueprint Frecuentes v1.0).
     *
     * Step 1 → orders por customer_id (cap 200)
     * Step 2 → order_items de esas órdenes → SUM(quantity) por product_id
     * Step 3 → fetch de products activos en ese Top N
     *
     * RN-T04: Solo productos status='active'. RN-T05: Orden por qty total histórica.
     */
    async getTopProductsForCustomer(
        customerId: string,
        limit: number = 5,
    ): Promise<Product[]> {
        // ── Step 1: IDs de órdenes del cliente (últimas 200) ─────────────────
        const { data: ordersData, error: ordersErr } = await supabase
            .from('orders')
            .select('id')
            .eq('customer_id', customerId)
            .limit(200);

        if (ordersErr) throw ordersErr;
        const orderIds = (ordersData ?? []).map((o: { id: string }) => o.id);
        if (orderIds.length === 0) return [];

        // ── Step 2: Ítems de esas órdenes ────────────────────────────────────
        const { data: itemsData, error: itemsErr } = await supabase
            .from('order_items')
            .select('product_id, quantity')
            .in('order_id', orderIds);

        if (itemsErr) throw itemsErr;
        if (!itemsData || itemsData.length === 0) return [];

        // ── Step 3: Agregación client-side — SUM(quantity) por product_id ────
        const totals = new Map<string, number>();
        for (const item of itemsData as { product_id: string; quantity: number }[]) {
            totals.set(item.product_id,
                (totals.get(item.product_id) ?? 0) + item.quantity
            );
        }

        // Top N ordenados por cantidad total descendente
        const topIds = [...totals.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([id]) => id);

        if (topIds.length === 0) return [];

        // ── Step 4: Fetch de products activos (IN preserva el orden vía sort) ─
        const { data: productsData, error: prodErr } = await supabase
            .from('products')
            .select('*, product_categories(name)')
            .in('id', topIds)
            .in('status', ['active', 'incomplete', 'unavailable']);

        if (prodErr) throw prodErr;

        // Preservar el orden de topIds (.in() no garantiza orden en Supabase)
        return topIds
            .map(id => (productsData ?? []).find((p: ProductDB) => p.id === id))
            .filter((p): p is ProductDB => Boolean(p))
            .map((p: ProductDB) => ({
                ...p,
                category: p.product_categories?.name || 'Otros',
            })) as Product[];
    },

    async getInventoryStats(tenantId: string) {
        // Fetch latest import to exclude historical unavailable products from the count
        const { data: importData } = await supabase
            .from('inventory_imports')
            .select('id')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        const latestImportId = importData?.id;

        let query = supabase
            .from('products')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .in('status', ['active', 'incomplete', 'unavailable']);
            
        if (latestImportId) {
            query = query.or(`status.neq.unavailable,last_import_id.eq.${latestImportId}`);
        } else {
            query = query.or('status.neq.unavailable');
        }

        const { count: activeCount, error: errActive } = await query;

        if (errActive) throw errActive;

        // Contamos la cantidad total de filas en cuarentena para el tenant actual
        const { count: quarantineCount, error: errQuarantine } = await supabase
            .from('products_quarantine')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenantId);

        if (errQuarantine) {
            Logger.error('Error al obtener estadísticas de cuarentena', { tenantId }, errQuarantine);
        }

        const { data: latestData } = await supabase
            .from('products_quarantine')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })
            .limit(20);

        return {
            activeCount: activeCount || 0,
            quarantineCount: quarantineCount || 0,
            latestQuarantineData: latestData
        };
    },

    // A: Upsert de Categorías (Algoritmo Arquitectura)
    async syncCategories(categories: string[], tenantId: string) {
        if (categories.length === 0) return [];

        // Deduplicar localmente (ON CONFLICT no admite la misma fila repetida en el mismo payload)
        const uniqueNames = Array.from(new Set(categories.map(c => c.trim()).filter(Boolean)));
        const payload = uniqueNames.map(c => ({ tenant_id: tenantId, name: c }));

        const { error } = await supabase
            .from('product_categories')
            .upsert(payload, { onConflict: 'tenant_id, name' });

        if (error) throw error;

        const { data: fetchCat, error: fetchErr } = await supabase
            .from('product_categories')
            .select('id, name')
            .eq('tenant_id', tenantId);

        if (fetchErr) throw fetchErr;
        return fetchCat || [];
    },

    // B: Upsert Maestro de Productos (Catalog Sync Support)
    async syncProducts(products: Partial<Product>[], importId?: string | null) {
        if (products.length === 0) return;

        // Deduplicar localmente basándose en la llave compuesta de conflicto
        // Saneamiento de datos antes del Upsert: Normalizamos campos clave a Mayúsculas (Standard PostgreSQL)
        const standardizedProducts = products.map(p => ({
            ...p,
            name: (p.name || '').trim().toUpperCase(),
            caliber: (p.caliber || '').trim().toUpperCase(),
            brand: (p.brand || '').trim().toUpperCase(),
            quality: (p.quality || '').trim().toUpperCase(),
            shipment_number: (p.shipment_number || '').trim().toUpperCase(),
            last_import_id: importId || p.last_import_id || null
        }));

        // Deduplicar localmente basándose en la llave compuesta (Normalizada)
        const uniqueMap = new Map<string, Partial<Product>>();
        standardizedProducts.forEach(p => {
            const key = `${p.tenant_id}-${p.name}-${p.caliber}-${p.brand}-${p.quality}-${p.shipment_number}`;
            uniqueMap.set(key, p);
        });

        const deduplicatedPayload = Array.from(uniqueMap.values());

        const { error } = await supabase
            .from('products')
            .upsert(deduplicatedPayload, {
                onConflict: 'tenant_id,name,caliber,brand,quality,shipment_number'
            });

        if (error) throw error;
    },

    // C: Actualización parcial de stock (Inline Editing)
    async updateStock(productId: string, newValue: number, newStatus: string) {
        const { error, count } = await supabase
            .from('products')
            .update({ available_quantity: newValue, status: newStatus }, { count: 'exact' })
            .eq('id', productId);

        if (error) throw error;
        if (count === 0) {
            throw new Error("No tiene permisos para actualizar este producto o el lote ya no existe.");
        }
    },

    /**
     * Lógica de limpieza post-importación (Atomic Replace Catalog).
     * Invoca el RPC sync_inventory_catalog para borrar/desactivar remanentes.
     */
    async cleanupMissingProducts(tenantId: string, importId: string): Promise<{ deleted: number, deactivated: number }> {
        const { data, error } = await supabase.rpc('sync_inventory_catalog', {
            p_tenant_id: tenantId,
            p_import_id: importId
        });

        if (error) {
            Logger.error('Fallo en el barrido de catálogo (Cleanup)', { tenantId, importId }, error);
            throw error;
        }

        return {
            deleted: data?.deleted_count || 0,
            deactivated: data?.deactivated_count || 0
        };
    },

    // D: Actualización parcial de precio (Inline Editing)
    async updatePrice(productId: string, newValue: number) {
        const { error, count } = await supabase
            .from('products')
            .update({ price: newValue }, { count: 'exact' })
            .eq('id', productId);

        if (error) throw error;
        if (count === 0) {
            throw new Error("No tiene permisos para actualizar este producto o el lote ya no existe.");
        }
    },

    // D: Consultar Cuarentena (Para listado de revisión)
    async getQuarantinedProducts(tenantId: string) {
        const { data, error } = await supabase
            .from('products_quarantine')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    },

    // E: Promover fila de Cuarentena (Aprobación hacia inventario general)
    async promoteQuarantinedProduct(quarantineId: string, payload: Partial<Product>) {
        if (!payload.tenant_id) throw new Error("tenant_id is required");

        // 1. Inserción master al catálogo base
        const { error: insertError } = await supabase
            .from('products')
            .upsert([payload], { onConflict: 'tenant_id, name, caliber, brand, quality, shipment_number' });

        if (insertError) throw insertError;

        // 2. Eliminación de la fila original bloqueada
        const { error: deleteError } = await supabase
            .from('products_quarantine')
            .delete()
            .eq('id', quarantineId);

        if (deleteError) {
            Logger.error('Fallo al limpiar registro de cuarentena tras promoción', { quarantineId }, deleteError);
            throw deleteError;
        }

        return true;
    },

    // F: Registrar resultado de importación
    async createImportRecord(payload: any) {
        const { data, error } = await supabase
            .from('inventory_imports')
            .insert(payload)
            .select('id')
            .single();
        if (error) throw error;
        return data;
    },

    // G: Registrar filas en cuarentena masivamente
    async createQuarantineRecords(payloads: any[]) {
        const { error } = await supabase
            .from('products_quarantine')
            .insert(payloads);
        if (error) throw error;
    },

    // H: Historial de importaciones (CA8 US-INV-01)
    async getImportHistory(tenantId: string): Promise<InventoryImportRecord[]> {
        const { data, error } = await supabase
            .from('inventory_imports')
            .select('id, file_name, row_count, success_count, error_count, created_at, metadata, user_profiles(full_name)')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;
        return (data || []).map((r: any) => ({
            id: r.id,
            file_name: r.file_name,
            row_count: r.row_count,
            success_count: r.success_count,
            error_count: r.error_count,
            created_at: r.created_at,
            created_by_name: r.user_profiles?.full_name ?? 'Sistema',
            metadata: (r as any).metadata || { new_count: 0, updated_count: 0 },
        }));
    },

    /**
     * Obtiene una lista de productos por sus IDs (US-ORD-08)
     */
    async getProductsByIds(ids: string[]): Promise<Product[]> {
        if (ids.length === 0) return [];
        const { data, error } = await supabase
            .from('products')
            .select('*, product_categories(name)')
            .in('id', ids);

        if (error) throw error;
        return (data || []).map((p: ProductDB) => ({
            ...p,
            category: p.product_categories?.name || 'Otros',
        })) as Product[];
    },

    /**
     * Obtiene TODOS los productos ignorando la paginación del servidor (PostgREST cap @ 1000).
     * Se usa para reportes y exportaciones (US-INV-05).
     */
    async getAllProductsForExport(status: string | string[] = 'active'): Promise<Product[]> {
        const ALL_LIMIT = 1000;
        let allProducts: Product[] = [];
        let currentPage = 1;
        let hasMore = true;

        while (hasMore) {
            const { data, count } = await this.getProducts(currentPage, '', ALL_LIMIT, status);
            allProducts = [...allProducts, ...data];

            if (allProducts.length >= count || data.length < ALL_LIMIT) {
                hasMore = false;
            } else {
                currentPage++;
            }
        }

        return allProducts;
    },

    /**
     * Crea un producto manualmente desde la UI (CA-1..CA-9 US-INV-ADD).
     * Detecta duplicados por clave compuesta antes de insertar.
     * last_import_id = null indica origen manual — nunca será eliminado por imports futuros.
     */
    async createManualProduct(payload: {
        tenant_id: string;
        name: string;
        caliber: string;
        brand: string;
        quality: string;
        category: string;
        shipment_number: string;
        entry_date?: string | null;
        available_quantity: number;
        price: number;
    }): Promise<{ isDuplicate: boolean; productId?: string }> {
        const upper = (s: string) => s.trim().toUpperCase();
        const name = upper(payload.name);
        const caliber = upper(payload.caliber);
        const brand = upper(payload.brand);
        const quality = upper(payload.quality);
        const shipment_number = upper(payload.shipment_number);
        const categoryName = upper(payload.category);

        // CA-3: Verificar duplicado por clave compuesta
        const { data: existing } = await supabase
            .from('products')
            .select('id')
            .eq('tenant_id', payload.tenant_id)
            .eq('name', name)
            .eq('caliber', caliber)
            .eq('brand', brand)
            .eq('quality', quality)
            .eq('shipment_number', shipment_number)
            .maybeSingle();

        if (existing) return { isDuplicate: true };

        // CA-7: Asegurar que la categoría existe (upsert)
        const { error: catUpsertErr } = await supabase
            .from('product_categories')
            .upsert({ tenant_id: payload.tenant_id, name: categoryName }, { onConflict: 'tenant_id,name' });
        if (catUpsertErr) throw catUpsertErr;

        const { data: catRow, error: catFetchErr } = await supabase
            .from('product_categories')
            .select('id')
            .eq('tenant_id', payload.tenant_id)
            .eq('name', categoryName)
            .single();
        if (catFetchErr || !catRow) throw catFetchErr ?? new Error('Error al obtener la categoría');

        // CA-4: status depende de la cantidad; CA-5: last_import_id = null
        const status = payload.available_quantity > 0 ? 'active' : 'incomplete';
        const { data: product, error: insertErr } = await supabase
            .from('products')
            .insert({
                tenant_id: payload.tenant_id,
                name,
                caliber,
                brand,
                quality,
                shipment_number,
                category_id: catRow.id,
                entry_date: payload.entry_date || null,
                available_quantity: payload.available_quantity,
                price: payload.price,
                status,
                last_import_id: null,
            })
            .select('id')
            .single();

        if (insertErr) throw insertErr;

        return { isDuplicate: false, productId: product.id };
    },
};
