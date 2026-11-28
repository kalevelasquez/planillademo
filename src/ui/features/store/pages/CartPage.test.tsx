import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CartPage from './CartPage';
import { useCartStore } from '../../../../store/cartStore';
import type { StoreProduct } from '../../../../services/storeService';

const P = (key: string, name: string, price: number): StoreProduct => ({
    productKey: key,
    name,
    caliber: null,
    quality: null,
    price,
    imageUrl: null,
    availability: 'Disponible',
});

const renderPage = () =>
    render(
        <MemoryRouter>
            <CartPage />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCartStore.getState().clear();
    localStorage.clear();
});

describe('CartPage', () => {
    it('carrito vacio: mensaje y enlace al catalogo (sin boton de continuar)', () => {
        renderPage();
        expect(screen.getByText('Tu carrito está vacío.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Ver catálogo' })).toHaveAttribute('href', '/tienda');
        expect(screen.queryByRole('link', { name: 'Continuar con el pedido' })).toBeNull();
    });

    it('con productos: lineas, total estimado y continuar al checkout', () => {
        useCartStore.getState().add(P('a', 'Manzana', 10), 2);
        useCartStore.getState().add(P('b', 'Pera', 3), 1);
        renderPage();
        expect(screen.getByText('Manzana')).toBeInTheDocument();
        expect(screen.getByText('Pera')).toBeInTheDocument();
        expect(screen.getByText('Total estimado')).toBeInTheDocument();
        expect(screen.getByText('$23.00', { selector: 'aside span' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Continuar con el pedido' })).toHaveAttribute('href', '/tienda/checkout');
    });

    it('cambiar cantidad recalcula el total y quitar elimina la linea', async () => {
        useCartStore.getState().add(P('a', 'Manzana', 10), 1);
        useCartStore.getState().add(P('b', 'Pera', 3), 1);
        renderPage();
        await userEvent.click(screen.getByRole('button', { name: 'Aumentar cantidad de Manzana' }));
        expect(screen.getByText('$23.00', { selector: 'aside span' })).toBeInTheDocument();
        expect(useCartStore.getState().items.find((i) => i.productKey === 'a')?.qty).toBe(2);

        await userEvent.click(screen.getByRole('button', { name: 'Quitar Pera del carrito' }));
        expect(screen.queryByText('Pera')).toBeNull();
        expect(screen.getByText('$20.00', { selector: 'aside span' })).toBeInTheDocument();
    });
});
