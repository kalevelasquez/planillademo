import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }));
vi.mock('../../../../services/storeService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../services/storeService')>()),
    listProducts: mocks.list,
    getProduct: mocks.get,
}));

import { useCatalog } from './useCatalog';
import { useProduct } from './useProduct';
import { StoreError, type StoreProduct } from '../../../../services/storeService';

const P: StoreProduct = {
    productKey: 'k1',
    name: 'Mango',
    caliber: null,
    quality: null,
    price: 3,
    imageUrl: null,
    availability: 'Disponible',
};

beforeEach(() => vi.clearAllMocks());

describe('useCatalog', () => {
    it('arranca en loading y pasa a ready con los productos', async () => {
        mocks.list.mockResolvedValue([P]);
        const { result } = renderHook(() => useCatalog());
        expect(result.current.status).toBe('loading');
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.products).toEqual([P]);
        expect(mocks.list).toHaveBeenCalledWith({ search: undefined, limit: undefined });
    });

    it('pasa search y limit al servicio y vuelve a pedir cuando cambia la busqueda', async () => {
        mocks.list.mockResolvedValue([P]);
        const { result, rerender } = renderHook(({ search }) => useCatalog({ search, limit: 6 }), {
            initialProps: { search: '' },
        });
        await waitFor(() => expect(result.current.status).toBe('ready'));
        rerender({ search: 'man' });
        await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ search: 'man', limit: 6 }));
        expect(mocks.list).toHaveBeenCalledTimes(2);
    });

    it('sin tenant configurado => status unavailable (no error generico)', async () => {
        mocks.list.mockRejectedValue(new StoreError('store.errors.store_unavailable'));
        const { result } = renderHook(() => useCatalog());
        await waitFor(() => expect(result.current.status).toBe('unavailable'));
        expect(result.current.products).toEqual([]);
    });

    it('error generico => status error, y reload() reintenta con exito', async () => {
        mocks.list.mockRejectedValueOnce(new StoreError('store.errors.generic')).mockResolvedValueOnce([P]);
        const { result } = renderHook(() => useCatalog());
        await waitFor(() => expect(result.current.status).toBe('error'));
        act(() => result.current.reload());
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.products).toEqual([P]);
    });

    it('un error no-StoreError (bug inesperado) tambien termina en error, sin colgar el loading', async () => {
        mocks.list.mockRejectedValue(new TypeError('x'));
        const { result } = renderHook(() => useCatalog());
        await waitFor(() => expect(result.current.status).toBe('error'));
    });

    it('descarta la respuesta vieja si llega despues de una busqueda mas nueva', async () => {
        let resolveOld: (v: StoreProduct[]) => void = () => {};
        mocks.list
            .mockImplementationOnce(() => new Promise<StoreProduct[]>((r) => { resolveOld = r; }))
            .mockResolvedValueOnce([{ ...P, productKey: 'nuevo', name: 'Nuevo' }]);
        const { result, rerender } = renderHook(({ search }) => useCatalog({ search }), { initialProps: { search: 'a' } });
        rerender({ search: 'ab' });
        await waitFor(() => expect(result.current.products[0]?.name).toBe('Nuevo'));
        await act(async () => resolveOld([{ ...P, productKey: 'viejo', name: 'Viejo' }]));
        expect(result.current.products.map((p) => p.name)).toEqual(['Nuevo']);
    });
});

describe('useProduct', () => {
    it('ready con el producto', async () => {
        mocks.get.mockResolvedValue(P);
        const { result } = renderHook(() => useProduct('k1'));
        expect(result.current.status).toBe('loading');
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.product).toEqual(P);
        expect(mocks.get).toHaveBeenCalledWith('k1');
    });

    it('inexistente => notFound', async () => {
        mocks.get.mockResolvedValue(null);
        const { result } = renderHook(() => useProduct('nope'));
        await waitFor(() => expect(result.current.status).toBe('notFound'));
        expect(result.current.product).toBeNull();
    });

    it('sin tenant => unavailable; otro error => error', async () => {
        mocks.get.mockRejectedValueOnce(new StoreError('store.errors.store_unavailable'));
        const a = renderHook(() => useProduct('k'));
        await waitFor(() => expect(a.result.current.status).toBe('unavailable'));

        mocks.get.mockRejectedValueOnce(new StoreError('store.errors.generic'));
        const b = renderHook(() => useProduct('k'));
        await waitFor(() => expect(b.result.current.status).toBe('error'));
    });
});
