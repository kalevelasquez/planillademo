import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/authStore';

const mocks = vi.hoisted(() => ({
    getBootstrapData: vi.fn(),
    refreshSession: vi.fn(),
    realtimeHandler: { current: null as null | ((p: { new: Record<string, unknown> }) => Promise<void>) },
}));

vi.mock('./services/authService', () => ({
    authService: { getBootstrapData: mocks.getBootstrapData, logout: vi.fn().mockResolvedValue(undefined) },
    supabase: {
        auth: {
            onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
            refreshSession: mocks.refreshSession,
        },
        channel: vi.fn(() => {
            const ch = {
                on: vi.fn((_evt: string, _filter: unknown, cb: (p: { new: Record<string, unknown> }) => Promise<void>) => {
                    mocks.realtimeHandler.current = cb;
                    return ch;
                }),
                subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
            };
            return ch;
        }),
    },
}));
vi.mock('./utils/logger', () => ({ Logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('./ui/components/NetworkStatusBanner', () => ({ NetworkStatusBanner: () => null }));
vi.mock('./ui/features/auth/LoginView', () => ({ LoginView: () => <div data-testid="login-view" /> }));
vi.mock('./ui/layout/MainLayout', () => ({ MainLayout: () => <div data-testid="main-layout"><Outlet /></div> }));
vi.mock('./ui/features/reports/DashboardView', () => ({ DashboardView: () => <div data-testid="dashboard" /> }));
vi.mock('./ui/features/products/ProductManagementView', () => ({ ProductManagementView: () => <div data-testid="inventory" /> }));

import AdminApp from './AdminApp';

const Probe = () => {
    const loc = useLocation();
    return (
        <>
            <div data-testid="loc">{`${loc.pathname}${loc.search}${loc.hash}`}</div>
            <div data-testid="state">{JSON.stringify((loc.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? null)}</div>
        </>
    );
};

const renderAt = (entry: string | { pathname: string; state?: unknown }) =>
    render(
        <MemoryRouter initialEntries={[entry]}>
            <AdminApp />
            <Probe />
        </MemoryRouter>,
    );

const profile = (over: Record<string, unknown> = {}) => ({
    id: 'u1',
    tenant_id: 't1',
    full_name: 'Test',
    phone: '',
    is_active: true,
    role: 'admin',
    roles: ['admin'],
    needs_password_change: false,
    ...over,
});

const loggedIn = (over: Record<string, unknown> = {}) =>
    mocks.getBootstrapData.mockResolvedValue({ profile: profile(over), permissions: [], serverTime: null });
const loggedOut = () => mocks.getBootstrapData.mockResolvedValue(null);

describe('AdminApp', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.realtimeHandler.current = null;
        mocks.refreshSession.mockResolvedValue({ data: {}, error: null });
        useAuthStore.setState({ profile: null, permissions: [], serverTime: null, isLoading: true });
    });

    describe('Admin sin sesion', () => {
        it('/inicio redirige a /login recordando la ruta pedida', async () => {
            loggedOut();
            renderAt('/inicio');
            await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/login'));
            expect(screen.getByTestId('state')).toHaveTextContent('"/inicio"');
            expect(await screen.findByTestId('login-view')).toBeInTheDocument();
        });

        it('/inventario (ruta admin existente) tambien redirige a /login con from', async () => {
            loggedOut();
            renderAt('/inventario');
            await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/login'));
            expect(screen.getByTestId('state')).toHaveTextContent('"/inventario"');
        });
    });

    describe('Cliente de tienda en ruta admin (sin user_profiles => bootstrap null)', () => {
        it('no ve datos admin y es redirigido a /login', async () => {
            loggedOut();
            renderAt('/planilla/empleados');
            await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/login'));
            expect(screen.queryByTestId('main-layout')).not.toBeInTheDocument();
            expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
        });
    });

    describe('Dashboard movido', () => {
        it('usuario interno en /inicio ve el dashboard dentro del layout', async () => {
            loggedIn();
            renderAt('/inicio');
            expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
            expect(screen.getByTestId('main-layout')).toBeInTheDocument();
            expect(screen.getByTestId('loc')).toHaveTextContent('/inicio');
        });
    });

    describe('Rutas admin intactas', () => {
        it('/inventario se renderiza igual que antes, sin cambiar la URL', async () => {
            loggedIn();
            renderAt('/inventario');
            expect(await screen.findByTestId('inventory')).toBeInTheDocument();
            expect(screen.getByTestId('loc')).toHaveTextContent('/inventario');
        });
    });

    describe('Login con sesion activa', () => {
        it('sin "from": va a /inicio', async () => {
            loggedIn();
            renderAt('/login');
            await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/inicio'));
            expect(await screen.findByTestId('dashboard')).toBeInTheDocument();
        });

        it('con "from": vuelve a la ruta pedida (incluye search)', async () => {
            loggedIn();
            renderAt({ pathname: '/login', state: { from: { pathname: '/inventario', search: '?q=1', hash: '' } } });
            await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/inventario?q=1'));
            expect(await screen.findByTestId('inventory')).toBeInTheDocument();
        });

        it('si "from" es la propia /login no hace loop: va a /inicio', async () => {
            loggedIn();
            renderAt({ pathname: '/login', state: { from: { pathname: '/login' } } });
            await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/inicio'));
        });
    });

    describe('Fallback', () => {
        it('ruta desconocida con sesion -> /inicio', async () => {
            loggedIn();
            renderAt('/no-existe');
            await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/inicio'));
        });

        it('ruta desconocida sin sesion termina en /login (via /inicio)', async () => {
            loggedOut();
            renderAt('/no-existe');
            await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/login'));
        });
    });

    describe('refreshSession al cambiar el rol (las claims viven en app_metadata del JWT)', () => {
        const emit = async (row: Record<string, unknown>) => {
            await waitFor(() => expect(mocks.realtimeHandler.current).toBeTruthy());
            await act(async () => {
                await mocks.realtimeHandler.current!({ new: row });
            });
        };

        it('refresca la sesion cuando cambia el rol', async () => {
            loggedIn();
            renderAt('/inicio');
            await screen.findByTestId('dashboard');
            await emit({ full_name: 'Test', phone: '', is_active: true, role: ['vendedor'] });
            expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
        });

        it('NO refresca si el rol no cambio (solo nombre/telefono)', async () => {
            loggedIn();
            renderAt('/inicio');
            await screen.findByTestId('dashboard');
            await emit({ full_name: 'Otro', phone: '1', is_active: true, role: ['admin'] });
            expect(mocks.refreshSession).not.toHaveBeenCalled();
        });

        it('un fallo de refreshSession no rompe la UI', async () => {
            loggedIn();
            mocks.refreshSession.mockRejectedValue(new Error('net'));
            renderAt('/inicio');
            await screen.findByTestId('dashboard');
            await emit({ full_name: 'Test', phone: '', is_active: true, role: ['vendedor'] });
            expect(screen.getByTestId('dashboard')).toBeInTheDocument();
        });
    });
});
