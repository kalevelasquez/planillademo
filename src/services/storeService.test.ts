import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    rpc: vi.fn(),
    tenantId: { current: '11111111-1111-4111-8111-111111111111' },
}));

// La tienda publica usa SIEMPRE el cliente anon de tienda, nunca el cliente admin.
vi.mock('../config/storeSupabaseClient', () => ({ storeSupabase: { rpc: mocks.rpc } }));
vi.mock('../config/env', () => ({
    get STORE_TENANT_ID() {
        return mocks.tenantId.current;
    },
}));
vi.mock('../config/supabaseClient', () => {
    throw new Error('storeService NO debe importar el cliente admin');
});

import { listProducts, getProduct, StoreError } from './storeService';

const ROW = {
    product_key: 'abc123',
    name: 'Manzana Fuji',
    caliber: '80',
    quality: 'Primera',
    price: '12.50',
    image_url: 'https://cdn/x.webp',
    availability: 'Disponible',
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.tenantId.current = '11111111-1111-4111-8111-111111111111';
});

describe('storeService.listProducts', () => {
    it('llama al RPC anon con el tenant del entorno y mapea a camelCase (precio numerico)', async () => {
        mocks.rpc.mockResolvedValue({ data: [ROW], error: null });

        const result = await listProducts();

        expect(mocks.rpc).toHaveBeenCalledWith('store_list_products', {
            p_tenant_id: '11111111-1111-4111-8111-111111111111',
            p_search: null,
            p_limit: 48,
            p_offset: 0,
        });
        expect(result).toEqual([
            {
                productKey: 'abc123',
                name: 'Manzana Fuji',
                caliber: '80',
                quality: 'Primera',
                price: 12.5,
                imageUrl: 'https://cdn/x.webp',
                availability: 'Disponible',
            },
        ]);
    });

    it('envia la busqueda recortada, limit y offset; busqueda vacia => null', async () => {
        mocks.rpc.mockResolvedValue({ data: [], error: null });

        await listProducts({ search: '  fuji ', limit: 6, offset: 12 });
        expect(mocks.rpc).toHaveBeenLastCalledWith('store_list_products', {
            p_tenant_id: '11111111-1111-4111-8111-111111111111',
            p_search: 'fuji',
            p_limit: 6,
            p_offset: 12,
        });

        await listProducts({ search: '   ' });
        expect(mocks.rpc).toHaveBeenLastCalledWith(
            'store_list_products',
            expect.objectContaining({ p_search: null }),
        );
    });

    it('imagen nula/vacia => imageUrl null; disponibilidad desconocida => Agotado (default seguro)', async () => {
        mocks.rpc.mockResolvedValue({
            data: [
                { ...ROW, image_url: null },
                { ...ROW, product_key: 'k2', image_url: '  ', availability: 'algo raro' },
                { ...ROW, product_key: 'k3', caliber: null, quality: null, availability: 'Agotado' },
            ],
            error: null,
        });

        const result = await listProducts();

        expect(result.map((p) => p.imageUrl)).toEqual([null, null, 'https://cdn/x.webp']);
        expect(result.map((p) => p.availability)).toEqual(['Disponible', 'Agotado', 'Agotado']);
        expect(result[2].caliber).toBeNull();
        expect(result[2].quality).toBeNull();
    });

    it('NUNCA propaga campos extra del RPC (stock, costo, lote): solo las columnas seguras', async () => {
        mocks.rpc.mockResolvedValue({
            data: [{ ...ROW, stock: 37, cost: 4.2, available_quantity: 37, id: 'lote-1', supplier: 'X' }],
            error: null,
        });

        const [product] = await listProducts();

        expect(Object.keys(product).sort()).toEqual(
            ['availability', 'caliber', 'imageUrl', 'name', 'price', 'productKey', 'quality'].sort(),
        );
        expect(product).not.toHaveProperty('stock');
        expect(product).not.toHaveProperty('cost');
    });

    it('sin VITE_STORE_TENANT_ID lanza StoreError store_unavailable y no llama al RPC', async () => {
        mocks.tenantId.current = '';

        await expect(listProducts()).rejects.toMatchObject({
            name: 'StoreError',
            i18nKey: 'store.errors.store_unavailable',
        });
        expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('error del RPC => StoreError generico (no filtra el mensaje de la base)', async () => {
        mocks.rpc.mockResolvedValue({ data: null, error: { message: 'relation "products" does not exist' } });

        const err = await listProducts().catch((e) => e);

        expect(err).toBeInstanceOf(StoreError);
        expect(err.i18nKey).toBe('store.errors.generic');
        expect(err.message).not.toContain('products');
    });

    it('si el RPC rechaza (red caida) tambien es StoreError generico', async () => {
        mocks.rpc.mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(listProducts()).rejects.toMatchObject({ i18nKey: 'store.errors.generic' });
    });
});

describe('storeService.getProduct', () => {
    it('devuelve el producto mapeado (store_get_product con tenant + key)', async () => {
        mocks.rpc.mockResolvedValue({ data: [ROW], error: null });

        const product = await getProduct('abc123');

        expect(mocks.rpc).toHaveBeenCalledWith('store_get_product', {
            p_tenant_id: '11111111-1111-4111-8111-111111111111',
            p_product_key: 'abc123',
        });
        expect(product).toMatchObject({ productKey: 'abc123', name: 'Manzana Fuji', price: 12.5 });
    });

    it('detalle inexistente (0 filas) => null', async () => {
        mocks.rpc.mockResolvedValue({ data: [], error: null });

        expect(await getProduct('nope')).toBeNull();
        expect(mocks.rpc).toHaveBeenCalledTimes(1);
    });

    it('key vacia => null sin llamar al RPC', async () => {
        expect(await getProduct('  ')).toBeNull();
        expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('sin tenant => store_unavailable; error de RPC => generic', async () => {
        mocks.tenantId.current = '';
        await expect(getProduct('abc')).rejects.toMatchObject({ i18nKey: 'store.errors.store_unavailable' });

        mocks.tenantId.current = '11111111-1111-4111-8111-111111111111';
        mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
        await expect(getProduct('abc')).rejects.toMatchObject({ i18nKey: 'store.errors.generic' });
    });
});
