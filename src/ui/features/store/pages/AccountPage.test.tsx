import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
    signIn: vi.fn(),
    signOut: vi.fn(),
    getSession: vi.fn(),
    subscribe: vi.fn(),
    account: vi.fn(),
    orders: vi.fn(),
}));
vi.mock('../../../../services/storeAuthService', () => ({
    signInStoreCustomer: mocks.signIn,
    signOutStoreCustomer: mocks.signOut,
    getStoreSession: mocks.getSession,
    subscribeStoreAuth: mocks.subscribe,
}));
vi.mock('../../../../services/storeService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../services/storeService')>()),
    getMyAccount: mocks.account,
    listMyOrders: mocks.orders,
}));

import AccountPage from './AccountPage';
import { useStoreSessionStore } from '../../../../store/storeSessionStore';
import { StoreError } from '../../../../services/storeService';

const SESSION = { user: { id: 'c1', email: 'ana@x.com' } } as Session;

const renderAt = (entry: string | { pathname: string; state?: unknown } = '/cuenta') =>
    render(
        <MemoryRouter initialEntries={[entry]}>
            <Routes>
                <Route path="/cuenta" element={<AccountPage />} />
                <Route path="/tienda/checkout" element={<p>pantalla de checkout</p>} />
            </Routes>
        </MemoryRouter>,
    );

beforeEach(() => {
    vi.clearAllMocks();
    useStoreSessionStore.setState({ session: null, status: 'ready' });
    mocks.signOut.mockResolvedValue(undefined);
    mocks.account.mockResolvedValue({
        contactName: 'Ana Perez',
        phone: '70001111',
        address: 'Calle 1',
        department: null,
        municipality: null,
        email: 'ana@x.com',
    });
    mocks.orders.mockResolvedValue([
        { orderNumber: 'PED-1', status: 'Pending', total: 20, createdAt: '2026-12-08T18:00:00Z', items: [] },
    ]);
});

describe('AccountPage', () => {
    it('anon: muestra el login de tienda (no el admin) y enlace a crear cuenta', () => {
        renderAt();
        expect(screen.getByRole('heading', { name: 'Ingresá a tu cuenta' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Crear cuenta' })).toHaveAttribute('href', '/cuenta/registro');
        expect(screen.queryByRole('link', { name: /login|panel/i })).toBeNull();
    });

    it('login correcto llama al servicio con las credenciales', async () => {
        mocks.signIn.mockImplementation(async () => useStoreSessionStore.setState({ session: SESSION }));
        renderAt();
        await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@x.com');
        await userEvent.type(screen.getByLabelText('Contraseña'), 'Secreta123');
        await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
        expect(mocks.signIn).toHaveBeenCalledWith({ email: 'ana@x.com', password: 'Secreta123' });
        expect(await screen.findByRole('heading', { name: 'Mi cuenta' })).toBeInTheDocument();
    });

    it('login con ruta de retorno (venia del checkout) vuelve a ella', async () => {
        mocks.signIn.mockImplementation(async () => useStoreSessionStore.setState({ session: SESSION }));
        renderAt({ pathname: '/cuenta', state: { from: { pathname: '/tienda/checkout' } } });
        await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@x.com');
        await userEvent.type(screen.getByLabelText('Contraseña'), 'Secreta123');
        await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
        expect(await screen.findByText('pantalla de checkout')).toBeInTheDocument();
    });

    it('una ruta de retorno externa o del panel NO se respeta (queda en la cuenta)', async () => {
        mocks.signIn.mockImplementation(async () => useStoreSessionStore.setState({ session: SESSION }));
        renderAt({ pathname: '/cuenta', state: { from: { pathname: '/inventario' } } });
        await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@x.com');
        await userEvent.type(screen.getByLabelText('Contraseña'), 'x');
        await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
        expect(await screen.findByRole('heading', { name: 'Mi cuenta' })).toBeInTheDocument();
    });

    it('credenciales invalidas: alerta traducida y se sigue en el login', async () => {
        mocks.signIn.mockRejectedValue(new StoreError('store.errors.invalid_credentials'));
        renderAt();
        await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@x.com');
        await userEvent.type(screen.getByLabelText('Contraseña'), 'mala');
        await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
        expect(screen.getByRole('heading', { name: 'Ingresá a tu cuenta' })).toBeInTheDocument();
    });

    it('con sesion: datos de la cuenta y mis pedidos con su estado', async () => {
        useStoreSessionStore.setState({ session: SESSION });
        renderAt();
        expect(await screen.findByText('Ana Perez')).toBeInTheDocument();
        expect(screen.getByText('ana@x.com')).toBeInTheDocument();
        expect(screen.getByText('70001111')).toBeInTheDocument();
        expect(await screen.findByText('Pedido PED-1')).toBeInTheDocument();
        expect(screen.getByText('Pendiente de confirmación')).toBeInTheDocument();
    });

    it('cerrar sesion usa el logout LOCAL de tienda y vuelve al login', async () => {
        useStoreSessionStore.setState({ session: SESSION });
        renderAt();
        await userEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
        expect(mocks.signOut).toHaveBeenCalledTimes(1);
        expect(await screen.findByRole('heading', { name: 'Ingresá a tu cuenta' })).toBeInTheDocument();
    });
});
