import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProductImage } from './ProductImage';

describe('ProductImage', () => {
    it('sin image_url renderiza el placeholder (no img)', () => {
        render(<ProductImage src={null} alt="Manzana" />);
        expect(screen.getByTestId('product-image-placeholder')).toBeInTheDocument();
        expect(screen.queryByRole('img', { name: 'Manzana' })).toBeNull();
    });

    it('url vacia o con espacios tambien es placeholder', () => {
        const { rerender } = render(<ProductImage src="" alt="x" />);
        expect(screen.getByTestId('product-image-placeholder')).toBeInTheDocument();
        rerender(<ProductImage src="   " alt="x" />);
        expect(screen.getByTestId('product-image-placeholder')).toBeInTheDocument();
    });

    it('con url renderiza la imagen lazy con alt', () => {
        render(<ProductImage src="https://x/a.png" alt="Manzana" />);
        const img = screen.getByRole('img', { name: 'Manzana' });
        expect(img).toHaveAttribute('src', 'https://x/a.png');
        expect(img).toHaveAttribute('loading', 'lazy');
        expect(screen.queryByTestId('product-image-placeholder')).toBeNull();
    });

    it('si la imagen falla al cargar cae al placeholder', () => {
        render(<ProductImage src="https://x/rota.png" alt="Manzana" />);
        fireEvent.error(screen.getByRole('img', { name: 'Manzana' }));
        expect(screen.getByTestId('product-image-placeholder')).toBeInTheDocument();
    });
});
