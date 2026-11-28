import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StoreHeader } from './StoreHeader';

const renderAt = (props: { showPanelLink?: boolean; cartCount?: number; signedIn?: boolean } = {}, entry = '/') =>
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

    it('carrito: enlace a /tienda/carrito con la cantidad en el nombre accesible y en la insignia', () => {
        renderAt({ cartCount: 3 });
        const cart = screen.getByRole('link', { name: 'Carrito, 3 unidades' });
        expect(cart).toHaveAttribute('href', '/tienda/carrito');
        expect(within(cart).getByText('3')).toBeInTheDocument();
    });

    it('carrito vacio: sin insignia; con 1 unidad singular', () => {
        const { unmount } = renderAt({ cartCount: 0 });
        const empty = screen.getByRole('link', { name: 'Carrito, 0 unidades' });
        expect(within(empty).queryByText('0')).toBeNull();
        unmount();
        renderAt({ cartCount: 1 });
        expect(screen.getByRole('link', { name: 'Carrito, 1 unidad' })).toBeInTheDocument();
    });

    it('cuenta: anon ve Ingresar, con sesion de tienda ve Mi cuenta; ambos a /cuenta', () => {
        const { unmount } = renderAt({ signedIn: false });
        expect(screen.getByRole('link', { name: 'Ingresar' })).toHaveAttribute('href', '/cuenta');
        expect(screen.queryByRole('link', { name: 'Mi cuenta' })).toBeNull();
        unmount();
        renderAt({ signedIn: true });
        expect(screen.getByRole('link', { name: 'Mi cuenta' })).toHaveAttribute('href', '/cuenta');
        expect(screen.queryByRole('link', { name: 'Ingresar' })).toBeNull();
    });
});
