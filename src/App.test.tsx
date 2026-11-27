import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const { getSession, getBootstrapData } = vi.hoisted(() => ({
    getSession: vi.fn(),
    getBootstrapData: vi.fn(),
}));

// El router delgado NO debe tocar el bootstrap admin en la landing: se asierta con este espia.
vi.mock('./services/authService', () => ({
    authService: { getBootstrapData, logout: vi.fn() },
    supabase: { auth: { getSession } },
}));
vi.mock('./config/supabaseClient', () => ({
    supabase: { auth: { getSession } },
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

describe('App (router delgado)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getSession.mockResolvedValue({ data: { session: null }, error: null });
    });

    describe('"/" (interino hasta la landing de B4)', () => {
        it('visitante sin sesion: va a /login sin ejecutar el bootstrap admin', async () => {
            renderAt('/');
            await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/login'));
            expect(getBootstrapData).not.toHaveBeenCalled();
        });

        it('usuario interno con sesion: aterriza en /inicio', async () => {
            getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
            renderAt('/');
            await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/inicio'));
            expect(getBootstrapData).not.toHaveBeenCalled();
        });

        it('si getSession falla, cae en /login (no deja la pantalla colgada)', async () => {
            getSession.mockRejectedValue(new Error('boom'));
            renderAt('/');
            await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/login'));
        });

        it('conserva search y hash (errores de enlaces de email que caen en el Site URL)', async () => {
            renderAt('/?foo=1#error=access_denied&error_code=otp_expired');
            await waitFor(() =>
                expect(screen.getByTestId('loc')).toHaveTextContent('/login?foo=1#error=access_denied&error_code=otp_expired'),
            );
        });

        it('no monta AdminApp antes de resolver la sesion', () => {
            getSession.mockReturnValue(new Promise(() => { }));
            renderAt('/');
            expect(screen.queryByTestId('admin-app')).not.toBeInTheDocument();
        });
    });

    describe('rutas admin intactas', () => {
        it.each(['/inventario', '/inicio', '/login', '/planilla/empleados', '/administrar/usuarios', '/reset-password', '/pedidos/123'])(
            '%s monta AdminApp sin pasar por el gate de "/"',
            async (path) => {
                renderAt(path);
                expect(await screen.findByTestId('admin-app')).toBeInTheDocument();
                expect(screen.getByTestId('loc')).toHaveTextContent(path);
                expect(getSession).not.toHaveBeenCalled();
            },
        );
    });

    it('ReloadPrompt es global (se monta tambien fuera de AdminApp)', async () => {
        getSession.mockReturnValue(new Promise(() => { }));
        renderAt('/');
        expect(await screen.findByTestId('reload-prompt')).toBeInTheDocument();
    });
});
