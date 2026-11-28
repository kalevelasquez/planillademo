import { describe, it, expect } from 'vitest';
import { resolveStoreReturnPath } from './storeReturnPath';

describe('resolveStoreReturnPath', () => {
    it('acepta rutas internas de la tienda y conserva search/hash', () => {
        expect(resolveStoreReturnPath({ from: { pathname: '/tienda/checkout' } })).toBe('/tienda/checkout');
        expect(resolveStoreReturnPath({ from: { pathname: '/cuenta/pedidos', search: '?a=1', hash: '#x' } })).toBe('/cuenta/pedidos?a=1#x');
    });

    it('rechaza rutas admin, el propio login, externas y formas invalidas', () => {
        expect(resolveStoreReturnPath({ from: { pathname: '/inventario' } })).toBeNull();
        expect(resolveStoreReturnPath({ from: { pathname: '/inicio' } })).toBeNull();
        expect(resolveStoreReturnPath({ from: { pathname: '/cuenta' } })).toBeNull();
        expect(resolveStoreReturnPath({ from: { pathname: '//evil.com/tienda' } })).toBeNull();
        expect(resolveStoreReturnPath({ from: { pathname: 'https://evil.com' } })).toBeNull();
        expect(resolveStoreReturnPath({ from: 'x' })).toBeNull();
        expect(resolveStoreReturnPath(null)).toBeNull();
        expect(resolveStoreReturnPath(undefined)).toBeNull();
    });
});
