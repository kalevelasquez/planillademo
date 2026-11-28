import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({ signUp: vi.fn() }));
vi.mock('../../../../services/storeAuthService', () => ({
    signUpStoreCustomer: mocks.signUp,
    getStoreSession: vi.fn(),
    subscribeStoreAuth: vi.fn(),
    signOutStoreCustomer: vi.fn(),
}));

import RegisterPage from './RegisterPage';
import { useStoreSessionStore } from '../../../../store/storeSessionStore';
import { StoreError } from '../../../../services/storeService';

const renderPage = () =>
    render(
        <MemoryRouter initialEntries={['/cuenta/registro']}>
            <Routes>
                <Route path="/cuenta/registro" element={<RegisterPage />} />
                <Route path="/cuenta" element={<p>mi cuenta</p>} />
            </Routes>
        </MemoryRouter>,
    );

const fill = async () => {
    await userEvent.type(screen.getByLabelText('Nombre completo'), 'Ana Perez');
    await userEvent.type(screen.getByLabelText('Teléfono'), '70001111');
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@x.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'Secreta123');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
};

beforeEach(() => {
    vi.clearAllMocks();
    useStoreSessionStore.setState({ session: null, status: 'ready' });
});

describe('RegisterPage', () => {
    it('registro correcto: manda los datos y pide revisar el correo (sin revelar nada mas)', async () => {
        mocks.signUp.mockResolvedValue(undefined);
        renderPage();
        await fill();
        expect(mocks.signUp).toHaveBeenCalledWith({
            fullName: 'Ana Perez',
            phone: '70001111',
            email: 'ana@x.com',
            password: 'Secreta123',
            address: '',
            department: '',
            municipality: '',
        });
        expect(await screen.findByRole('heading', { name: 'Revisá tu correo' })).toBeInTheDocument();
        expect(screen.getByText(/Si el correo es válido/)).toBeInTheDocument();
        expect(screen.queryByLabelText('Contraseña')).toBeNull();
    });

    it('registro deshabilitado en el servidor: mensaje amable, formulario sigue disponible, sin crash', async () => {
        mocks.signUp.mockRejectedValue(new StoreError('store.errors.signup_unavailable'));
        renderPage();
        await fill();
        expect(await screen.findByRole('alert')).toHaveTextContent('El registro no está disponible por el momento. Intentá más tarde.');
        expect(screen.getByRole('button', { name: 'Crear cuenta' })).toBeEnabled();
    });

    it('error inesperado (no StoreError) se muestra generico', async () => {
        mocks.signUp.mockRejectedValue(new Error('boom interno'));
        renderPage();
        await fill();
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Ocurrió un error inesperado');
        expect(alert).not.toHaveTextContent('boom');
    });

    it('si ya hay sesion de cliente va directo a /cuenta', () => {
        useStoreSessionStore.setState({ session: { user: { id: 'c1' } } as Session });
        renderPage();
        expect(screen.getByText('mi cuenta')).toBeInTheDocument();
    });
});
