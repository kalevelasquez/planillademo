import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductGrid } from './ProductGrid';
import type { StoreProduct } from '../../../../services/storeService';

const mk = (key: string, name: string): StoreProduct => ({
    productKey: key,
    name,
    caliber: null,
    quality: null,
    price: 2,
    imageUrl: null,
    availability: 'Disponible',
});

describe('ProductGrid', () => {
    it('renderiza una tarjeta por producto dentro de una lista accesible', () => {
        render(
            <MemoryRouter>
                <ProductGrid products={[mk('a', 'Banano'), mk('b', 'Mango'), mk('c', 'Piña')]} label="Productos" />
            </MemoryRouter>,
        );
        const list = screen.getByRole('list', { name: 'Productos' });
        const items = within(list).getAllByRole('listitem');
        expect(items).toHaveLength(3);
        expect(within(items[1]).getByRole('heading', { name: 'Mango' })).toBeInTheDocument();
    });
});
