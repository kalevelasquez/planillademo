import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ create: vi.fn(), account: vi.fn() }));
vi.mock('../../../../services/storeService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../services/storeService')>()),
    createStoreOrder: mocks.create,
    getMyAccount: mocks.account,
}));

import CheckoutPage from './CheckoutPage';
import { useCartStore } from '../../../../store/cartStore';
import { StoreError, type StoreProduct } from '../../../../services/storeService';

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
            <CheckoutPage />
        </MemoryRouter>,
    );

beforeEach(() => {
    vi.clearAllMocks();
    useCartStore.getState().clear();
    localStorage.clear();
    mocks.account.mockResolvedValue({
        contactName: 'Ana Perez',
        phone: '70001111',
        address: 'Calle 1 #2',
        department: 'San Salvador',
        municipality: 'Soyapango',
        email: 'ana@x.com',
    });
});

describe('CheckoutPage', () => {
    it('carrito vacio: aviso y enlace al catalogo; no hay boton de enviar', () => {
        renderPage();
        expect(screen.getByText('No hay nada para pedir')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Ver catálogo' })).toHaveAttribute('href', '/tienda');
        expect(screen.queryByRole('button', { name: 'Enviar pedido' })).toBeNull();
    });

    it('muestra resumen, pago contra entrega y datos de entrega de la cuenta', async () => {
        useCartStore.getState().add(P('a', 'Manzana', 10), 2);
        renderPage();
        expect(screen.getByText('Pago contra entrega')).toBeInTheDocument();
        expect(screen.getByText(/No se paga en línea/)).toBeInTheDocument();
        expect(screen.getByText(/2 × Manzana/)).toBeInTheDocument();
        expect(screen.getByText('$20.00', { selector: 'aside span' })).toBeInTheDocument();
        expect(await screen.findByText(/Calle 1 #2/)).toBeInTheDocument();
        expect(screen.getByText(/Ana Perez/)).toBeInTheDocument();
    });

    it('enviar: manda SOLO productKey+cantidad y notas, limpia el carrito y muestra el numero de pedido', async () => {
        mocks.create.mockResolvedValue({ orderId: 'o1', orderNumber: 'PED-20261208-0001', total: 20 });
        useCartStore.getState().add(P('a', 'Manzana', 10), 2);
        useCartStore.getState().add(P('b', 'Pera', 3), 1);
        renderPage();

        await userEvent.type(screen.getByLabelText('Notas para el pedido (opcional)'), 'Tocar el timbre');
        await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));

        expect(mocks.create).toHaveBeenCalledWith(
            [
                { productKey: 'a', quantity: 2 },
                { productKey: 'b', quantity: 1 },
            ],
            'Tocar el timbre',
        );
        expect(await screen.findByRole('heading', { name: '¡Pedido recibido!' })).toBeInTheDocument();
        expect(screen.getByText('PED-20261208-0001')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Ver mis pedidos' })).toHaveAttribute('href', '/cuenta');
        expect(useCartStore.getState().items).toEqual([]);
    });

    it('stock insuficiente: mensaje generico con el producto (sin cantidades), carrito intacto y reintento posible', async () => {
        mocks.create.mockRejectedValue(new StoreError('store.errors.insufficient_availability', 'Manzana'));
        useCartStore.getState().add(P('a', 'Manzana', 10), 2);
        renderPage();
        await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('No hay suficiente disponibilidad de Manzana, probá con una cantidad menor.');
        expect(alert.textContent).not.toMatch(/\d/);
        expect(useCartStore.getState().items).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Enviar pedido' })).toBeEnabled();
    });

    it('otros errores se traducen (correo sin confirmar, demasiados pendientes)', async () => {
        useCartStore.getState().add(P('a', 'Manzana', 10), 1);
        renderPage();

        mocks.create.mockRejectedValueOnce(new StoreError('store.errors.email_unconfirmed'));
        await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Confirmá tu correo electrónico antes de hacer un pedido.');

        mocks.create.mockRejectedValueOnce(new StoreError('store.errors.too_many_pending'));
        await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Ya tenés varios pedidos pendientes'));
    });

    it('mientras se envia el boton queda deshabilitado (sin doble envio)', async () => {
        let resolve: (v: unknown) => void = () => {};
        mocks.create.mockReturnValue(new Promise((r) => (resolve = r)));
        useCartStore.getState().add(P('a', 'Manzana', 10), 1);
        renderPage();

        await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));
        const busy = screen.getByRole('button', { name: 'Enviando pedido…' });
        expect(busy).toBeDisabled();
        await userEvent.click(busy);
        expect(mocks.create).toHaveBeenCalledTimes(1);

        resolve({ orderId: 'o', orderNumber: 'PED-1', total: 10 });
        expect(await screen.findByRole('heading', { name: '¡Pedido recibido!' })).toBeInTheDocument();
    });
});
