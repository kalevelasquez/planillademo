import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../../../config/supabaseClient', () => ({ supabase: { auth: { getSession } } }));

import PublicApp from './PublicApp';

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
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: null } });
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
});
