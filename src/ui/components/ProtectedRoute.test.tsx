import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { useAuthStore } from '../../store/authStore';
import type { UserProfile } from '../../services/authService';

const Probe = () => <div data-testid="loc">{useLocation().pathname}</div>;

const setProfile = (roles: string[]) =>
    useAuthStore.setState({
        isLoading: false,
        profile: { id: 'u1', tenant_id: 't1', roles, role: roles[0], needs_password_change: false } as unknown as UserProfile,
    });

const renderAt = (path: string) =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/inicio" element={<div data-testid="home">home</div>} />
                <Route path="/login" element={<div data-testid="login">login</div>} />
                <Route path="/admin-only" element={<ProtectedRoute requiredRole="admin"><div data-testid="secret">secret</div></ProtectedRoute>} />
            </Routes>
            <Probe />
        </MemoryRouter>,
    );

describe('ProtectedRoute', () => {
    beforeEach(() => {
        useAuthStore.setState({ profile: null, isLoading: false, permissions: [], serverTime: null });
    });

    it('sin perfil redirige a /login', () => {
        renderAt('/admin-only');
        expect(screen.getByTestId('loc')).toHaveTextContent('/login');
    });

    it('sin el rol requerido redirige al dashboard /inicio (no a "/")', () => {
        setProfile(['vendedor']);
        renderAt('/admin-only');
        expect(screen.getByTestId('loc')).toHaveTextContent('/inicio');
        expect(screen.getByTestId('home')).toBeInTheDocument();
    });

    it('con el rol requerido renderiza el contenido', () => {
        setProfile(['admin']);
        renderAt('/admin-only');
        expect(screen.getByTestId('secret')).toBeInTheDocument();
    });
});
