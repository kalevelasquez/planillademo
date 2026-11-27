import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type AuthInternals = { storageKey: string; flowType: string; detectSessionInUrl: boolean };
const internals = (c: { auth: unknown }) => c.auth as unknown as AuthInternals;

const loadClients = async (pathname: string) => {
    vi.resetModules();
    window.history.pushState({}, '', pathname);
    const admin = (await import('./supabaseClient')).supabase;
    const store = (await import('./storeSupabaseClient')).storeSupabase;
    return { admin, store };
};

describe('aislamiento de sesion admin vs tienda', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });
    afterEach(() => {
        window.history.pushState({}, '', '/');
    });

    it('usan storageKey distintas y la de la tienda es sb-teknergy-store', async () => {
        const { admin, store } = await loadClients('/inicio');
        expect(internals(store).storageKey).toBe('sb-teknergy-store');
        expect(internals(admin).storageKey).not.toBe(internals(store).storageKey);
    });

    it('la tienda usa PKCE', async () => {
        const { store } = await loadClients('/inicio');
        expect(internals(store).flowType).toBe('pkce');
    });

    it('el cliente admin conserva su flujo (no PKCE) y su storage original', async () => {
        const { admin } = await loadClients('/inicio');
        expect(internals(admin).flowType).not.toBe('pkce');
        expect(internals(admin).storageKey).toMatch(/^sb-.*-auth-token$/);
    });

    it.each(['/', '/inicio', '/login', '/reset-password', '/setup-account', '/inventario'])(
        'admin detecta la sesion en la URL en %s',
        async (p) => {
            const { admin } = await loadClients(p);
            expect(internals(admin).detectSessionInUrl).toBe(true);
        },
    );

    it.each(['/tienda', '/tienda/carrito', '/cuenta', '/cuenta/confirmado'])(
        'admin NO detecta la sesion en la URL en %s (H5)',
        async (p) => {
            const { admin } = await loadClients(p);
            expect(internals(admin).detectSessionInUrl).toBe(false);
        },
    );

    it.each(['/cuenta', '/cuenta/confirmado'])('la tienda detecta la sesion en la URL solo en %s', async (p) => {
        const { store } = await loadClients(p);
        expect(internals(store).detectSessionInUrl).toBe(true);
    });

    it.each(['/', '/inicio', '/login', '/tienda', '/tienda/carrito'])('la tienda NO detecta la sesion en la URL en %s', async (p) => {
        const { store } = await loadClients(p);
        expect(internals(store).detectSessionInUrl).toBe(false);
    });
});
