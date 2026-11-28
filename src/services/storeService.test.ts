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

import { listProducts, getProduct, createStoreOrder, StoreError } from './storeService';

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

describe('storeService.createStoreOrder', () => {
    const OK_ROW = { order_id: 'ord-1', order_number: 'PED-20261208-0007', total: '64.00' };
    const ITEMS = [
        { productKey: 'key-1', quantity: 5 },
        { productKey: 'key-2', quantity: 2 },
    ];

    it('llama store_create_order con SOLO product_key/quantity y mapea el resultado (total numerico)', async () => {
        mocks.rpc.mockResolvedValue({ data: [OK_ROW], error: null });

        const result = await createStoreOrder(ITEMS, 'entregar por la tarde');

        expect(mocks.rpc).toHaveBeenCalledWith('store_create_order', {
            p_items: [
                { product_key: 'key-1', quantity: 5 },
                { product_key: 'key-2', quantity: 2 },
            ],
            p_notes: 'entregar por la tarde',
        });
        expect(result).toEqual({ orderId: 'ord-1', orderNumber: 'PED-20261208-0007', total: 64 });
    });

    it('NUNCA envia precio, tenant, cliente ni vendedor aunque el llamador los cuele', async () => {
        mocks.rpc.mockResolvedValue({ data: [OK_ROW], error: null });
        const sneaky = [
            { productKey: 'key-1', quantity: 1, price: 0.01, unit_price: 0.01, tenant_id: 't', customer_id: 'c', seller_id: 's' },
        ] as unknown as Parameters<typeof createStoreOrder>[0];

        await createStoreOrder(sneaky);

        const payload = mocks.rpc.mock.calls[0][1] as { p_items: Record<string, unknown>[] };
        expect(Object.keys(payload.p_items[0]).sort()).toEqual(['product_key', 'quantity']);
        expect(Object.keys(payload).sort()).toEqual(['p_items', 'p_notes']);
    });

    it('no depende de VITE_STORE_TENANT_ID (el tenant lo deriva el servidor) y acepta fila unica', async () => {
        mocks.tenantId.current = '';
        mocks.rpc.mockResolvedValue({ data: OK_ROW, error: null });

        await expect(createStoreOrder([ITEMS[0]])).resolves.toMatchObject({ orderId: 'ord-1' });
        expect(mocks.rpc).toHaveBeenCalledTimes(1);
    });

    it('notas recortadas; vacias o en blanco => null', async () => {
        mocks.rpc.mockResolvedValue({ data: [OK_ROW], error: null });

        await createStoreOrder([ITEMS[0]], '  hola  ');
        expect(mocks.rpc).toHaveBeenLastCalledWith('store_create_order', expect.objectContaining({ p_notes: 'hola' }));

        await createStoreOrder([ITEMS[0]], '   ');
        expect(mocks.rpc).toHaveBeenLastCalledWith('store_create_order', expect.objectContaining({ p_notes: null }));

        await createStoreOrder([ITEMS[0]]);
        expect(mocks.rpc).toHaveBeenLastCalledWith('store_create_order', expect.objectContaining({ p_notes: null }));
    });

    it('carrito vacio => invalid_items sin llamar al RPC', async () => {
        await expect(createStoreOrder([])).rejects.toMatchObject({ i18nKey: 'store.errors.invalid_items' });
        expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it.each([0, -1, 1.5, Number.NaN, 501])('cantidad %s => invalid_quantity sin llamar al RPC', async (quantity) => {
        await expect(createStoreOrder([{ productKey: 'k', quantity }])).rejects.toMatchObject({
            i18nKey: 'store.errors.invalid_quantity',
        });
        expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('mas de 30 items => too_many_items sin llamar al RPC; 30 pasan', async () => {
        const many = (n: number) => Array.from({ length: n }, (_, i) => ({ productKey: `k${i}`, quantity: 1 }));
        await expect(createStoreOrder(many(31))).rejects.toMatchObject({ i18nKey: 'store.errors.too_many_items' });
        expect(mocks.rpc).not.toHaveBeenCalled();

        mocks.rpc.mockResolvedValue({ data: [OK_ROW], error: null });
        await expect(createStoreOrder(many(30))).resolves.toMatchObject({ orderId: 'ord-1' });
    });

    it('product_key vacia => invalid_items sin llamar al RPC', async () => {
        await expect(createStoreOrder([{ productKey: '  ', quantity: 1 }])).rejects.toMatchObject({
            i18nKey: 'store.errors.invalid_items',
        });
        expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it.each([
        ['SW002', 'store.errors.product_unavailable'],
        ['SW003', 'store.errors.invalid_quantity'],
        ['SW004', 'store.errors.too_many_items'],
        ['SW005', 'store.errors.invalid_items'],
        ['SW006', 'store.errors.too_many_pending'],
        ['SW007', 'store.errors.email_unconfirmed'],
        ['SW008', 'store.errors.store_unavailable'],
        ['42501', 'store.errors.auth_required'],
    ])('codigo %s del servidor => %s (sin filtrar el mensaje de la base)', async (code, key) => {
        mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'mensaje interno de la base', details: null, hint: null } });

        const err = await createStoreOrder([ITEMS[0]]).catch((e) => e);

        expect(err).toBeInstanceOf(StoreError);
        expect(err.i18nKey).toBe(key);
        expect(err.message).toBe(key);
        expect(err.message).not.toContain('base');
    });

    it('SW001 (stock insuficiente) => insufficient_availability con el nombre del producto y SIN cantidades', async () => {
        mocks.rpc.mockResolvedValue({
            data: null,
            error: {
                code: 'SW001',
                message: 'No hay suficiente disponibilidad de Manzana Fuji, probá con una cantidad menor',
                details: 'Manzana Fuji',
                hint: null,
            },
        });

        const err = await createStoreOrder([ITEMS[0]]).catch((e) => e);

        expect(err.i18nKey).toBe('store.errors.insufficient_availability');
        expect(err.productName).toBe('Manzana Fuji');
        expect(JSON.stringify({ message: err.message, key: err.i18nKey, name: err.productName })).not.toMatch(/\d/);
    });

    it('SW001 sin detalle => insufficient_availability sin nombre (undefined, no revienta)', async () => {
        mocks.rpc.mockResolvedValue({ data: null, error: { code: 'SW001', message: 'x', details: null, hint: null } });

        const err = await createStoreOrder([ITEMS[0]]).catch((e) => e);

        expect(err.i18nKey).toBe('store.errors.insufficient_availability');
        expect(err.productName).toBeUndefined();
    });

    it('error desconocido, red caida o respuesta vacia => generic', async () => {
        mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' } });
        await expect(createStoreOrder([ITEMS[0]])).rejects.toMatchObject({ i18nKey: 'store.errors.generic' });

        mocks.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await expect(createStoreOrder([ITEMS[0]])).rejects.toMatchObject({ i18nKey: 'store.errors.generic' });

        mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
        await expect(createStoreOrder([ITEMS[0]])).rejects.toMatchObject({ i18nKey: 'store.errors.generic' });
    });
});
