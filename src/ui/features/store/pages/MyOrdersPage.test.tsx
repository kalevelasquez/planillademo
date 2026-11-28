import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../../../services/storeService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../services/storeService')>()),
    listMyOrders: mocks.list,
}));

import MyOrdersPage from './MyOrdersPage';
import { StoreError, type MyOrder } from '../../../../services/storeService';

const ORDER = (n: string, status: string, total: number): MyOrder => ({
    orderNumber: n,
    status,
    total,
    createdAt: '2026-12-08T18:00:00Z',
    items: [{ name: 'Pera', caliber: null, quality: null, quantity: 2, unitPrice: total / 2, lineTotal: total }],
});

const renderPage = () =>
    render(
        <MemoryRouter>
            <MyOrdersPage />
        </MemoryRouter>,
    );

beforeEach(() => vi.clearAllMocks());

describe('MyOrdersPage', () => {
    it('carga accesible y luego lista los pedidos con su estado', async () => {
        mocks.list.mockResolvedValue([ORDER('PED-1', 'Pending', 20), ORDER('PED-2', 'Approved', 30)]);
        renderPage();
        expect(screen.getByRole('status')).toHaveTextContent('Cargando tus pedidos');
        expect(await screen.findByText('Pedido PED-1')).toBeInTheDocument();
        expect(screen.getByText('Pedido PED-2')).toBeInTheDocument();
        expect(screen.getByText('Pendiente de confirmación')).toBeInTheDocument();
        expect(screen.getByText('Confirmado')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Mis pedidos' })).toBeInTheDocument();
    });

    it('sin pedidos: mensaje vacio', async () => {
        mocks.list.mockResolvedValue([]);
        renderPage();
        expect(await screen.findByText('Todavía no hiciste ningún pedido.')).toBeInTheDocument();
    });

    it('error: alerta traducida y "Reintentar" vuelve a consultar', async () => {
        mocks.list.mockRejectedValueOnce(new StoreError('store.errors.generic'));
        renderPage();
        expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado');
        mocks.list.mockResolvedValueOnce([ORDER('PED-9', 'Cancelled', 10)]);
        await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        expect(await screen.findByText('Pedido PED-9')).toBeInTheDocument();
        expect(screen.getByText('Cancelado')).toBeInTheDocument();
        expect(mocks.list).toHaveBeenCalledTimes(2);
    });
});
