import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import EmailConfirmedPage from './EmailConfirmedPage';
import { useStoreSessionStore } from '../../../../store/storeSessionStore';

const renderAt = (url: string) =>
    render(
        <MemoryRouter initialEntries={[url]}>
            <EmailConfirmedPage />
        </MemoryRouter>,
    );

beforeEach(() => useStoreSessionStore.setState({ session: null, status: 'ready' }));

describe('EmailConfirmedPage', () => {
    it('con sesion (mismo dispositivo): correo confirmado y camino al catalogo', () => {
        useStoreSessionStore.setState({ session: { user: { id: 'c1' } } as Session });
        renderAt('/cuenta/confirmado?code=abc');
        expect(screen.getByRole('heading', { name: 'Correo confirmado' })).toBeInTheDocument();
        expect(screen.getByText('Tu cuenta está lista. Ya podés hacer tu primer pedido.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Ir al catálogo' })).toHaveAttribute('href', '/tienda');
    });

    it('sin sesion (otro dispositivo): confirmado pero hay que ingresar', () => {
        renderAt('/cuenta/confirmado');
        expect(screen.getByRole('heading', { name: 'Correo confirmado' })).toBeInTheDocument();
        expect(screen.getByText(/Ingresá con tu correo y contraseña para continuar/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Ingresar' })).toHaveAttribute('href', '/cuenta');
    });

    it('enlace vencido o invalido (error en la URL): alerta y sin falso "confirmado"', () => {
        renderAt('/cuenta/confirmado?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid');
        expect(screen.getByRole('alert')).toHaveTextContent('El enlace de confirmación no es válido o venció');
        expect(screen.queryByRole('heading', { name: 'Correo confirmado' })).toBeNull();
        expect(screen.getByRole('link', { name: 'Ingresar' })).toHaveAttribute('href', '/cuenta');
    });

    it('el error tambien se detecta en el hash (#error=...)', () => {
        renderAt('/cuenta/confirmado#error=access_denied&error_code=otp_expired');
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });
});
