import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { StoreAuthGuard } from './StoreAuthGuard';
import { useStoreSessionStore } from '../../../../store/storeSessionStore';

const Login = () => {
    const loc = useLocation();
    const from = (loc.state as { from?: { pathname: string } } | null)?.from?.pathname;
    return <p>login de tienda, volver a: {from ?? 'nada'}</p>;
};

const renderAt = (path: string) =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/cuenta" element={<Login />} />
                <Route element={<StoreAuthGuard />}>
                    <Route path="/tienda/checkout" element={<p>pantalla protegida</p>} />
                </Route>
            </Routes>
        </MemoryRouter>,
    );

beforeEach(() => useStoreSessionStore.setState({ session: null, status: 'loading' }));

describe('StoreAuthGuard', () => {
    it('sin sesion de tienda: redirige al login de /cuenta preservando la ruta pedida', () => {
        useStoreSessionStore.setState({ session: null, status: 'ready' });
        renderAt('/tienda/checkout');
        expect(screen.getByText('login de tienda, volver a: /tienda/checkout')).toBeInTheDocument();
        expect(screen.queryByText('pantalla protegida')).toBeNull();
    });

    it('con sesion de tienda: muestra el contenido protegido', () => {
        useStoreSessionStore.setState({ session: { user: { id: 'c1' } } as Session, status: 'ready' });
        renderAt('/tienda/checkout');
        expect(screen.getByText('pantalla protegida')).toBeInTheDocument();
    });

    it('mientras se resuelve la sesion muestra carga y NO redirige todavia', () => {
        renderAt('/tienda/checkout');
        expect(screen.getByRole('status')).toHaveTextContent('Cargando tu cuenta');
        expect(screen.queryByText(/login de tienda/)).toBeNull();
        expect(screen.queryByText('pantalla protegida')).toBeNull();
    });
});
