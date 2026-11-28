import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StoreHeader } from './StoreHeader';

const renderAt = (props: { showPanelLink?: boolean } = {}, entry = '/') =>
    render(
        <MemoryRouter initialEntries={[entry]}>
            <StoreHeader {...props} />
        </MemoryRouter>,
    );

describe('StoreHeader', () => {
    it('logo a "/" y navegacion principal al catalogo', () => {
        renderAt();
        expect(screen.getByRole('link', { name: 'Teknergy, ir al inicio' })).toHaveAttribute('href', '/');
        const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
        expect(within(nav).getByRole('link', { name: 'Catálogo' })).toHaveAttribute('href', '/tienda');
    });

    it('sin sesion interna NO muestra "Ir al panel"', () => {
        renderAt({ showPanelLink: false });
        expect(screen.queryByRole('link', { name: 'Ir al panel' })).toBeNull();
    });

    it('con sesion interna muestra "Ir al panel" hacia /inicio', () => {
        renderAt({ showPanelLink: true });
        expect(screen.getByRole('link', { name: 'Ir al panel' })).toHaveAttribute('href', '/inicio');
    });

    it('marca la ruta activa con aria-current', () => {
        renderAt({}, '/tienda');
        expect(screen.getByRole('link', { name: 'Catálogo' })).toHaveAttribute('aria-current', 'page');
    });
});
