import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, configure } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const { getSession, getBootstrapData, listProducts, getProduct } = vi.hoisted(() => ({
    getSession: vi.fn(),
    getBootstrapData: vi.fn(),
    listProducts: vi.fn(),
    getProduct: vi.fn(),
}));

// El router delgado NO debe tocar el bootstrap admin en la landing: se asierta con este espia.
vi.mock('./services/authService', () => ({
    authService: { getBootstrapData, logout: vi.fn() },
    supabase: { auth: { getSession } },
}));
vi.mock('./config/supabaseClient', () => ({
    supabase: { auth: { getSession } },
}));
vi.mock('./services/storeService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./services/storeService')>()),
    listProducts,
    getProduct,
}));
vi.mock('./AdminApp', () => ({
    default: () => <div data-testid="admin-app">AdminApp</div>,
}));
vi.mock('./ui/components/ReloadPrompt', () => ({
    default: () => <div data-testid="reload-prompt" />,
}));

import { AppRoutes } from './App';

const Probe = () => {
    const loc = useLocation();
    return <div data-testid="loc">{`${loc.pathname}${loc.search}${loc.hash}`}</div>;
};

const renderAt = (entry: string) =>
    render(
        <MemoryRouter initialEntries={[entry]}>
            <AppRoutes />
            <Probe />
        </MemoryRouter>,
    );

const LANDING_H1 = 'Fruta fresca para tu negocio';

// La primera carga de los chunks lazy (PublicApp + pagina) puede tardar con la suite completa en paralelo.
configure({ asyncUtilTimeout: 8000 });

describe('App (router delgado)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getSession.mockResolvedValue({ data: { session: null }, error: null });
        listProducts.mockResolvedValue([]);
        getProduct.mockResolvedValue(null);
    });

    describe('"/" = landing publica', () => {
        it('visitante anon: ve la landing, sin redirect a login ni bootstrap admin', async () => {
            renderAt('/');
            expect(await screen.findByRole('heading', { level: 1, name: LANDING_H1 })).toBeInTheDocument();
            expect(screen.getByTestId('loc')).toHaveTextContent(/^\/$/);
            expect(getBootstrapData).not.toHaveBeenCalled();
            expect(screen.queryByTestId('admin-app')).not.toBeInTheDocument();
            expect(screen.queryByRole('link', { name: 'Ir al panel' })).not.toBeInTheDocument();
        });

        it('usuario interno con sesion: tambien ve la landing, con acceso "Ir al panel" a /inicio (sin redirect)', async () => {
            getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
            renderAt('/');
            expect(await screen.findByRole('heading', { level: 1, name: LANDING_H1 })).toBeInTheDocument();
            expect(await screen.findByRole('link', { name: 'Ir al panel' })).toHaveAttribute('href', '/inicio');
            expect(screen.getByTestId('loc')).toHaveTextContent(/^\/$/);
            expect(getBootstrapData).not.toHaveBeenCalled();
        });

        it('la landing incluye el acceso de empleados a /login y no monta AdminApp', async () => {
            renderAt('/');
            expect(await screen.findByRole('link', { name: 'Acceso empleados' })).toHaveAttribute('href', '/login');
            expect(screen.queryByTestId('admin-app')).not.toBeInTheDocument();
        });

        it('si falla getSession (admin) la landing igual se muestra', async () => {
            getSession.mockRejectedValue(new Error('boom'));
            renderAt('/');
            expect(await screen.findByRole('heading', { level: 1, name: LANDING_H1 })).toBeInTheDocument();
        });
    });

    describe('"/" con enlaces de email de Supabase (invitacion / recovery / errores) => flujo admin', () => {
        it.each([
            '/#access_token=abc&refresh_token=def&type=invite',
            '/#access_token=abc&type=recovery',
            '/?foo=1#error=access_denied&error_code=otp_expired',
            '/?error=access_denied&error_description=Email+link+is+invalid',
        ])('%s sin sesion: va a /login conservando search y hash, sin landing ni bootstrap', async (entry) => {
            renderAt(entry);
            const expected = entry.replace(/^\//, '/login');
            await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent(expected));
            expect(screen.queryByRole('heading', { level: 1, name: LANDING_H1 })).not.toBeInTheDocument();
            expect(getBootstrapData).not.toHaveBeenCalled();
        });

        it('con sesion (token de invitacion ya canjeado por el cliente admin) aterriza en /inicio conservando el hash', async () => {
            getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
            renderAt('/#access_token=abc&type=invite');
            await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/inicio#access_token=abc&type=invite'));
        });

        it('no monta AdminApp ni la landing antes de resolver la sesion', () => {
            getSession.mockReturnValue(new Promise(() => { }));
            renderAt('/#access_token=abc&type=recovery');
            expect(screen.queryByTestId('admin-app')).not.toBeInTheDocument();
            expect(screen.queryByRole('heading', { level: 1, name: LANDING_H1 })).not.toBeInTheDocument();
        });

        it('un "#contacto" o utm_* en "/" NO es un enlace de auth: se muestra la landing', async () => {
            renderAt('/?utm_source=fb#contacto');
            expect(await screen.findByRole('heading', { level: 1, name: LANDING_H1 })).toBeInTheDocument();
            expect(screen.getByTestId('loc')).toHaveTextContent('/?utm_source=fb#contacto');
        });
    });

    describe('tienda publica', () => {
        it('/tienda monta el catalogo (PublicApp) sin AdminApp ni bootstrap admin', async () => {
            renderAt('/tienda');
            expect(await screen.findByRole('heading', { level: 1, name: 'Catálogo' })).toBeInTheDocument();
            expect(listProducts).toHaveBeenCalled();
            expect(screen.queryByTestId('admin-app')).not.toBeInTheDocument();
            expect(getBootstrapData).not.toHaveBeenCalled();
        });

        it('/tienda/p/:productKey monta el detalle', async () => {
            getProduct.mockResolvedValue({
                productKey: 'abc',
                name: 'Mango Tommy',
                caliber: null,
                quality: null,
                price: 3,
                imageUrl: null,
                availability: 'Disponible',
            });
            renderAt('/tienda/p/abc');
            expect(await screen.findByRole('heading', { level: 1, name: 'Mango Tommy' })).toBeInTheDocument();
            expect(getProduct).toHaveBeenCalledWith('abc');
            expect(screen.queryByTestId('admin-app')).not.toBeInTheDocument();
        });

        it('/tienda/<ruta desconocida> cae al shell admin (no hay pagina publica con ese path)', async () => {
            renderAt('/tienda/otra/cosa');
            expect(await screen.findByTestId('admin-app')).toBeInTheDocument();
        });
    });

    describe('rutas admin intactas', () => {
        it.each(['/inventario', '/inicio', '/login', '/planilla/empleados', '/administrar/usuarios', '/reset-password', '/pedidos/123', '/cuenta'])(
            '%s monta AdminApp sin pasar por el gate de "/" ni la landing',
            async (path) => {
                renderAt(path);
                expect(await screen.findByTestId('admin-app')).toBeInTheDocument();
                expect(screen.getByTestId('loc')).toHaveTextContent(path);
                expect(getSession).not.toHaveBeenCalled();
                expect(listProducts).not.toHaveBeenCalled();
            },
        );
    });

    it('ReloadPrompt es global (se monta tambien fuera de AdminApp)', async () => {
        renderAt('/');
        expect(await screen.findByTestId('reload-prompt')).toBeInTheDocument();
    });
});
