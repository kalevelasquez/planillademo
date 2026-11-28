import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CartLine } from './CartLine';
import type { CartItem } from '../../../../store/cartStore';

const ITEM: CartItem = {
    productKey: 'k1',
    name: 'Manzana Fuji',
    caliber: '80',
    quality: 'Primera',
    price: 12.5,
    imageUrl: 'https://cdn/a.webp',
    qty: 2,
};

describe('CartLine', () => {
    it('muestra nombre, calibre, calidad, precio unitario y total de linea', () => {
        render(<CartLine item={ITEM} onQtyChange={() => {}} onRemove={() => {}} />);
        expect(screen.getByText('Manzana Fuji')).toBeInTheDocument();
        expect(screen.getByText('Calibre 80')).toBeInTheDocument();
        expect(screen.getByText('Primera')).toBeInTheDocument();
        expect(screen.getByText('$12.50 c/u')).toBeInTheDocument();
        expect(screen.getByText('$25.00')).toBeInTheDocument();
    });

    it('el total de linea sigue a la cantidad y sin calibre/calidad no se muestran', () => {
        render(<CartLine item={{ ...ITEM, qty: 4, caliber: null, quality: null, price: 3 }} onQtyChange={() => {}} onRemove={() => {}} />);
        expect(screen.getByText('$12.00')).toBeInTheDocument();
        expect(screen.queryByText(/Calibre/)).toBeNull();
    });

    it('cambiar cantidad y quitar emiten con la clave del producto', async () => {
        const onQtyChange = vi.fn();
        const onRemove = vi.fn();
        render(<CartLine item={ITEM} onQtyChange={onQtyChange} onRemove={onRemove} />);
        await userEvent.click(screen.getByRole('button', { name: 'Aumentar cantidad de Manzana Fuji' }));
        expect(onQtyChange).toHaveBeenCalledWith('k1', 3);
        await userEvent.click(screen.getByRole('button', { name: 'Quitar Manzana Fuji del carrito' }));
        expect(onRemove).toHaveBeenCalledWith('k1');
    });
});
