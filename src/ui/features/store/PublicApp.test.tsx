import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { getSession, getStoreSession, subscribeStoreAuth } = vi.hoisted(() => ({
    getSession: vi.fn(),
    getStoreSession: vi.fn(),
    subscribeStoreAuth: vi.fn(),
}));
vi.mock('../../../config/supabaseClient', () => ({ supabase: { auth: { getSession } } }));

vi.mock('../../../services/storeAuthService', () => ({
    getStoreSession,
    subscribeStoreAuth,
    signOutStoreCustomer: vi.fn(),
}));

import PublicApp from './PublicApp';
import { useCartStore } from '../../../store/cartStore';
import { useStoreSessionStore } from '../../../store/storeSessionStore';

const renderShell = (entry = '/tienda') =>
    render(
        <MemoryRouter initialEntries={[entry]}>
            <Routes>
                <Route element={<PublicApp />}>
                    <Route path="/tienda" element={<p>contenido de prueba</p>} />
                </Route>
            </Routes>
        </MemoryRouter>,
    );

beforeEach(() => {
    useStoreSessionStore.getState().reset();
    vi.clearAllMocks();
    useCartStore.getState().clear();
    localStorage.clear();
    getSession.mockResolvedValue({ data: { session: null } });
    getStoreSession.mockResolvedValue(null);
    subscribeStoreAuth.mockReturnValue(() => {});
});

describe('PublicApp (shell publico)', () => {
    it('header + main (destino del skip link) + footer rodean el contenido', () => {
        renderShell();
        expect(screen.getByRole('banner')).toBeInTheDocument();
        const main = screen.getByRole('main');
        expect(main).toHaveAttribute('id', 'contenido');
        expect(main).toHaveTextContent('contenido de prueba');
        expect(screen.getByRole('contentinfo')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Acceso empleados' })).toHaveAttribute('href', '/login');
    });

    it('visitante anon: sin "Ir al panel"', async () => {
        renderShell();
        await waitFor(() => expect(getSession).toHaveBeenCalled());
        expect(screen.queryByRole('link', { name: 'Ir al panel' })).toBeNull();
    });

    it('usuario interno con sesion: ve "Ir al panel" -> /inicio y sigue viendo la pagina publica', async () => {
        getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
        renderShell();
        expect(await screen.findByRole('link', { name: 'Ir al panel' })).toHaveAttribute('href', '/inicio');
        expect(screen.getByRole('main')).toHaveTextContent('contenido de prueba');
    });

    it('inicia la sesion de TIENDA una sola vez (independiente de la sesion admin)', async () => {
        renderShell();
        await waitFor(() => expect(getStoreSession).toHaveBeenCalledTimes(1));
        expect(subscribeStoreAuth).toHaveBeenCalledTimes(1);
    });

    it('el header refleja el carrito local y la sesion de cliente', async () => {
        useCartStore.getState().add({ productKey: 'k', name: 'Pera', caliber: null, quality: null, price: 2, imageUrl: null, availability: 'Disponible' }, 4);
        getStoreSession.mockResolvedValue({ user: { id: 'c1' } });
        renderShell();
        expect(screen.getByRole('link', { name: 'Carrito, 4 unidades' })).toHaveAttribute('href', '/tienda/carrito');
        expect(await screen.findByRole('link', { name: 'Mi cuenta' })).toHaveAttribute('href', '/cuenta');
    });

    it('sesion de cliente y sesion admin conviven: ambos accesos se muestran', async () => {
        getSession.mockResolvedValue({ data: { session: { user: { id: 'staff' } } } });
        getStoreSession.mockResolvedValue({ user: { id: 'c1' } });
        renderShell();
        expect(await screen.findByRole('link', { name: 'Ir al panel' })).toBeInTheDocument();
        expect(await screen.findByRole('link', { name: 'Mi cuenta' })).toBeInTheDocument();
    });
});
