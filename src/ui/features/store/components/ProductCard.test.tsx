import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductCard } from './ProductCard';
import type { StoreProduct } from '../../../../services/storeService';

const base: StoreProduct = {
    productKey: 'abc123',
    name: 'Manzana Fuji',
    caliber: '80',
    quality: 'Primera',
    price: 12.5,
    imageUrl: 'https://cdn/x.webp',
    availability: 'Disponible',
};

const renderCard = (over: Partial<StoreProduct> = {}) =>
    render(
        <MemoryRouter>
            <ProductCard product={{ ...base, ...over }} />
        </MemoryRouter>,
    );

describe('ProductCard', () => {
    it('muestra nombre, calibre, calidad, precio de products.price y disponibilidad', () => {
        renderCard();
        expect(screen.getByRole('heading', { name: 'Manzana Fuji' })).toBeInTheDocument();
        expect(screen.getByText('Calibre 80')).toBeInTheDocument();
        expect(screen.getByText('Primera')).toBeInTheDocument();
        expect(screen.getByText('$12.50')).toBeInTheDocument();
        expect(screen.getByText('Disponible')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Manzana Fuji' })).toHaveAttribute('src', 'https://cdn/x.webp');
    });

    it('enlaza al detalle /tienda/p/:productKey', () => {
        renderCard();
        expect(screen.getByRole('link', { name: /Manzana Fuji/ })).toHaveAttribute('href', '/tienda/p/abc123');
    });

    it('sin imagen usa el placeholder; sin calibre/calidad omite esas lineas', () => {
        renderCard({ imageUrl: null, caliber: null, quality: null });
        expect(screen.getByTestId('product-image-placeholder')).toBeInTheDocument();
        expect(screen.queryByText(/Calibre/)).toBeNull();
        expect(screen.queryByText('Primera')).toBeNull();
    });

    it('Agotado se rotula como tal y no muestra "Disponible"', () => {
        renderCard({ availability: 'Agotado' });
        expect(screen.getByText('Agotado')).toBeInTheDocument();
        expect(screen.queryByText('Disponible')).toBeNull();
    });
});
