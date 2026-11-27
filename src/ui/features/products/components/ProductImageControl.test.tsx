import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../../services/authService', () => ({ supabase: {} }));
const setProductImage = vi.fn();
const removeProductImage = vi.fn();
vi.mock('../../../../services/productService', () => ({
    productService: {
        setProductImage: (...a: unknown[]) => setProductImage(...a),
        removeProductImage: (...a: unknown[]) => removeProductImage(...a),
    },
}));

import { ProductImageControl } from './ProductImageControl';
import i18n from '../../../../config/i18n';

const product = { id: 'p1', tenant_id: 't1', name: 'MANZANA', caliber: '100S', quality: 'PRIMERA', image_url: null as string | null };
const pick = (input: HTMLElement, f: File) => fireEvent.change(input, { target: { files: [f] } });
const png = () => new File(['x'], 'a.png', { type: 'image/png' });

beforeEach(() => {
    setProductImage.mockReset();
    removeProductImage.mockReset();
});

describe('ProductImageControl', () => {
    it('sin permiso de edicion no muestra controles de subida (solo miniatura)', () => {
        render(<ProductImageControl product={product} canEdit={false} onChange={vi.fn()} onError={vi.fn()} />);
        expect(screen.queryByTestId('product-image-input')).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('con permiso sube la imagen y notifica la nueva url', async () => {
        setProductImage.mockResolvedValue('https://x/new.png');
        const onChange = vi.fn();
        render(<ProductImageControl product={product} canEdit onChange={onChange} onError={vi.fn()} />);
        pick(screen.getByTestId('product-image-input'), png());
        await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://x/new.png'));
        expect(setProductImage).toHaveBeenCalledWith(product, expect.any(File));
    });

    it('archivo invalido: reporta el mensaje i18n y no cambia nada', async () => {
        const { ProductImageError } = await import('../../../../services/storageService');
        setProductImage.mockRejectedValue(new ProductImageError('inventory.image.tooLarge'));
        const onChange = vi.fn();
        const onError = vi.fn();
        render(<ProductImageControl product={product} canEdit onChange={onChange} onError={onError} />);
        pick(screen.getByTestId('product-image-input'), png());
        await waitFor(() => expect(onError).toHaveBeenCalledWith(i18n.t('inventory.image.tooLarge')));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('muestra el boton de quitar solo si hay imagen y la quita', async () => {
        removeProductImage.mockResolvedValue(undefined);
        const onChange = vi.fn();
        const { rerender } = render(<ProductImageControl product={product} canEdit onChange={onChange} onError={vi.fn()} />);
        expect(screen.queryByTestId('product-image-remove')).toBeNull();
        rerender(<ProductImageControl product={{ ...product, image_url: 'https://x/a.png' }} canEdit onChange={onChange} onError={vi.fn()} />);
        fireEvent.click(screen.getByTestId('product-image-remove'));
        await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
        expect(removeProductImage).toHaveBeenCalled();
    });
});
