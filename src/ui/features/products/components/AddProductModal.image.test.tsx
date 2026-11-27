import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const createManualProduct = vi.fn();
const setProductImage = vi.fn();
vi.mock('../../../../services/productService', () => ({
    productService: {
        createManualProduct: (...a: unknown[]) => createManualProduct(...a),
        setProductImage: (...a: unknown[]) => setProductImage(...a),
    },
}));
vi.mock('../../../../services/authService', () => ({ supabase: {} }));
vi.mock('../../../../services/auditService', () => ({ auditService: { logAction: vi.fn() } }));

let canEdit = true;
vi.mock('../../../../store/authStore', () => {
    const state = () => ({
        profile: { tenant_id: 't1' },
        permissions: [{ resource: 'inventario', can_create: true, can_edit: canEdit }],
    });
    return { useAuthStore: Object.assign(() => state(), { getState: state }) };
});

import { AddProductModal } from './AddProductModal';
import { ProductImageError } from '../../../../services/storageService';
import i18n from '../../../../config/i18n';

const fillRequired = () => {
    const set = (placeholder: string, v: string) =>
        fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: v } });
    set('Ej: Manzana Gala', 'Manzana Gala');
    set('Ej: 100s', '100s');
    set('Ej: Washington', 'Wash');
    set('Ej: Frutas', 'Frutas');
    set('Ej: EMB-001', 'EMB-1');
    set('0', '5');
    set('0.00', '2.5');
    fireEvent.change(screen.getByDisplayValue('Seleccionar calidad'), { target: { value: 'PRIMERA' } });
};
const pick = (f: File) => fireEvent.change(screen.getByTestId('product-image-input'), { target: { files: [f] } });
const png = () => new File(['x'], 'a.png', { type: 'image/png' });

beforeEach(() => {
    canEdit = true;
    createManualProduct.mockReset().mockResolvedValue({ isDuplicate: false, productId: 'new1' });
    setProductImage.mockReset().mockResolvedValue('https://x/a.png');
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
});

describe('AddProductModal - imagen', () => {
    it('sin permiso inventario.edit no muestra el campo de imagen', () => {
        canEdit = false;
        render(<AddProductModal onClose={vi.fn()} onSuccess={vi.fn()} />);
        expect(screen.queryByTestId('product-image-input')).toBeNull();
    });

    it('con permiso muestra el campo con la etiqueta i18n', () => {
        render(<AddProductModal onClose={vi.fn()} onSuccess={vi.fn()} />);
        expect(screen.getAllByText(i18n.t('inventory.image.label')).length).toBeGreaterThan(0);
        expect(screen.getByTestId('product-image-input')).toBeInTheDocument();
    });

    it('tipo invalido: muestra mensaje i18n y no hay preview', () => {
        render(<AddProductModal onClose={vi.fn()} onSuccess={vi.fn()} />);
        pick(new File(['x'], 'a.pdf', { type: 'application/pdf' }));
        expect(screen.getByText(i18n.t('inventory.image.invalidType'))).toBeInTheDocument();
        expect(screen.queryByTestId('product-image-preview')).toBeNull();
    });

    it('archivo grande: muestra tooLarge', () => {
        render(<AddProductModal onClose={vi.fn()} onSuccess={vi.fn()} />);
        const big = png();
        Object.defineProperty(big, 'size', { value: 2 * 1024 * 1024 + 1 });
        pick(big);
        expect(screen.getByText(i18n.t('inventory.image.tooLarge'))).toBeInTheDocument();
    });

    it('archivo valido: muestra preview y tras crear el producto sube la imagen al lote creado', async () => {
        const onSuccess = vi.fn();
        render(<AddProductModal onClose={vi.fn()} onSuccess={onSuccess} />);
        fillRequired();
        const f = png();
        pick(f);
        expect(screen.getByTestId('product-image-preview')).toHaveAttribute('src', 'blob:preview');
        fireEvent.click(screen.getByText('Guardar producto'));
        await waitFor(() => expect(setProductImage).toHaveBeenCalled());
        expect(setProductImage).toHaveBeenCalledWith(
            { id: 'new1', tenant_id: 't1', name: 'MANZANA GALA', caliber: '100S', quality: 'PRIMERA' }, f);
        expect(onSuccess).toHaveBeenCalled();
    });

    it('sin imagen no llama a setProductImage', async () => {
        render(<AddProductModal onClose={vi.fn()} onSuccess={vi.fn()} />);
        fillRequired();
        fireEvent.click(screen.getByText('Guardar producto'));
        await waitFor(() => expect(createManualProduct).toHaveBeenCalled());
        expect(setProductImage).not.toHaveBeenCalled();
    });

    it('si la imagen falla el producto igual queda creado y se avisa con mensaje i18n', async () => {
        setProductImage.mockRejectedValue(new ProductImageError('inventory.image.uploadError'));
        const onSuccess = vi.fn();
        render(<AddProductModal onClose={vi.fn()} onSuccess={onSuccess} />);
        fillRequired();
        pick(png());
        fireEvent.click(screen.getByText('Guardar producto'));
        await waitFor(() => expect(screen.getByText('Producto agregado')).toBeInTheDocument());
        expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('inventory.image.uploadAfterCreate'));
        expect(onSuccess).toHaveBeenCalled();
    });
});
