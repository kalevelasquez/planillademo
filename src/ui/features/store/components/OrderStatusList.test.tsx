import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { OrderStatusList } from './OrderStatusList';
import type { MyOrder } from '../../../../services/storeService';

const ORDERS: MyOrder[] = [
    {
        orderNumber: 'PED-20261208-0002',
        status: 'Approved',
        total: 40,
        createdAt: '2026-12-08T18:00:00Z',
        items: [{ name: 'Pera', caliber: null, quality: null, quantity: 4, unitPrice: 10, lineTotal: 40 }],
    },
    {
        orderNumber: 'PED-20261201-0001',
        status: 'Pending',
        total: 37.5,
        createdAt: '2026-12-01T18:00:00Z',
        items: [
            { name: 'Manzana Fuji', caliber: '80', quality: 'Primera', quantity: 3, unitPrice: 12.5, lineTotal: 37.5 },
        ],
    },
];

describe('OrderStatusList', () => {
    it('lista cada pedido con numero, estado traducido, total e items', () => {
        render(<OrderStatusList orders={ORDERS} />);
        const items = screen.getAllByRole('listitem').filter((li) => li.getAttribute('data-order'));
        expect(items).toHaveLength(2);

        const first = within(items[0]);
        expect(first.getByText('Pedido PED-20261208-0002')).toBeInTheDocument();
        expect(first.getByText('Confirmado')).toBeInTheDocument();
        expect(first.getByText('$40.00', { selector: 'span' })).toBeInTheDocument();
        expect(first.getByText(/4 × Pera/)).toBeInTheDocument();

        const second = within(items[1]);
        expect(second.getByText('Pendiente de confirmación')).toBeInTheDocument();
        expect(second.getByText('$37.50', { selector: 'span' })).toBeInTheDocument();
        expect(second.getByText(/3 × Manzana Fuji/)).toBeInTheDocument();
    });

    it('Cancelled y un estado desconocido (sin filtrar el valor crudo)', () => {
        render(
            <OrderStatusList
                orders={[
                    { ...ORDERS[0], orderNumber: 'PED-A', status: 'Cancelled' },
                    { ...ORDERS[1], orderNumber: 'PED-B', status: 'Draft' },
                ]}
            />,
        );
        expect(screen.getByText('Cancelado')).toBeInTheDocument();
        expect(screen.getByText('En proceso')).toBeInTheDocument();
        expect(screen.queryByText('Draft')).toBeNull();
    });
});
