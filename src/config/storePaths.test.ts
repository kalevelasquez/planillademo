import { describe, it, expect } from 'vitest';
import { ROUTES, isStorePath, isAccountPath, resolvePostLoginPath } from './storePaths';

describe('storePaths', () => {
    describe('ROUTES', () => {
        it('expone el mapa de rutas acordado (landing, tienda, cuenta, inicio admin)', () => {
            expect(ROUTES.LANDING).toBe('/');
            expect(ROUTES.STORE).toBe('/tienda');
            expect(ROUTES.ACCOUNT).toBe('/cuenta');
            expect(ROUTES.ADMIN_HOME).toBe('/inicio');
            expect(ROUTES.LOGIN).toBe('/login');
        });
    });

    describe('isStorePath', () => {
        it.each(['/tienda', '/tienda/', '/tienda/carrito', '/tienda/p/abc', '/cuenta', '/cuenta/registro', '/cuenta/confirmado'])(
            '%s es ruta de tienda',
            (p) => expect(isStorePath(p)).toBe(true),
        );

        it.each(['/', '/inicio', '/login', '/inventario', '/planilla/empleados', '/reset-password', '/setup-account', '/tiendas', '/cuentas', '/mi/tienda'])(
            '%s NO es ruta de tienda',
            (p) => expect(isStorePath(p)).toBe(false),
        );

        it('"/" queda fuera: si Supabase cae al Site URL con un token admin (invite/recovery) el cliente admin debe seguir capturandolo', () => {
            expect(isStorePath('/')).toBe(false);
        });

        it('es robusto ante undefined/vacio', () => {
            expect(isStorePath(undefined)).toBe(false);
            expect(isStorePath('')).toBe(false);
        });
    });

    describe('isAccountPath', () => {
        it.each(['/cuenta', '/cuenta/', '/cuenta/confirmado'])('%s es ruta de cuenta', (p) => expect(isAccountPath(p)).toBe(true));
        it.each(['/tienda', '/tienda/carrito', '/', '/inicio', '/cuentas'])('%s NO es ruta de cuenta', (p) => expect(isAccountPath(p)).toBe(false));
    });

    describe('resolvePostLoginPath', () => {
        it('sin estado, vuelve al dashboard /inicio', () => {
            expect(resolvePostLoginPath(undefined)).toBe('/inicio');
            expect(resolvePostLoginPath(null)).toBe('/inicio');
            expect(resolvePostLoginPath({})).toBe('/inicio');
        });

        it('respeta la ruta pedida (pathname + search + hash)', () => {
            expect(resolvePostLoginPath({ from: { pathname: '/inventario', search: '?q=1', hash: '#x' } })).toBe('/inventario?q=1#x');
            expect(resolvePostLoginPath({ from: { pathname: '/planilla/calculo' } })).toBe('/planilla/calculo');
        });

        it.each(['/', '/login', '/forgot-password', '/reset-password', '/setup-account', '/force-password-change'])(
            'ignora un "from" inutil o ciclico (%s) y cae en /inicio',
            (p) => expect(resolvePostLoginPath({ from: { pathname: p } })).toBe('/inicio'),
        );

        it('ignora rutas de tienda y valores externos/malformados', () => {
            expect(resolvePostLoginPath({ from: { pathname: '/tienda' } })).toBe('/inicio');
            expect(resolvePostLoginPath({ from: { pathname: 'https://evil.com' } })).toBe('/inicio');
            expect(resolvePostLoginPath({ from: { pathname: '//evil.com' } })).toBe('/inicio');
            expect(resolvePostLoginPath({ from: 'nope' })).toBe('/inicio');
        });
    });
});
