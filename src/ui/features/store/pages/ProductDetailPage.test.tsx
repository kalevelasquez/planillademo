import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../../services/storeService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../services/storeService')>()),
    getProduct: mocks.get,
}));

import ProductDetailPage from './ProductDetailPage';
import { StoreError, type StoreProduct } from '../../../../services/storeService';

const P: StoreProduct = {
    productKey: 'abc123',
    name: 'Manzana Fuji',
    caliber: '80',
    quality: 'Primera',
    price: 12.5,
    imageUrl: 'https://cdn/x.webp',
    availability: 'Disponible',
};

const renderAt = (path: string) =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/tienda/p/:productKey" element={<ProductDetailPage />} />
            </Routes>
        </MemoryRouter>,
    );

beforeEach(() => vi.clearAllMocks());

describe('ProductDetailPage', () => {
    it('muestra detalle: nombre, calibre, calidad, precio, disponibilidad, imagen y volver al catalogo', async () => {
        mocks.get.mockResolvedValue(P);
        renderAt('/tienda/p/abc123');
        expect(await screen.findByRole('heading', { level: 1, name: 'Manzana Fuji' })).toBeInTheDocument();
        expect(mocks.get).toHaveBeenCalledWith('abc123');
        expect(screen.getByText('Calibre 80')).toBeInTheDocument();
        expect(screen.getByText('Primera')).toBeInTheDocument();
        expect(screen.getByText('$12.50')).toBeInTheDocument();
        expect(screen.getByText('Disponible')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Manzana Fuji' })).toHaveAttribute('src', 'https://cdn/x.webp');
        expect(screen.getByRole('link', { name: 'Volver al catálogo' })).toHaveAttribute('href', '/tienda');
    });

    it('el boton de pedir esta DESHABILITADO y dice "Próximamente" (no hay carrito en esta fase)', async () => {
        mocks.get.mockResolvedValue(P);
        renderAt('/tienda/p/abc123');
        const btn = await screen.findByRole('button', { name: 'Pedir (próximamente)' });
        expect(btn).toBeDisabled();
    });

    it('Agotado se muestra como tal', async () => {
        mocks.get.mockResolvedValue({ ...P, availability: 'Agotado' });
        renderAt('/tienda/p/abc123');
        expect(await screen.findByText('Agotado')).toBeInTheDocument();
        expect(screen.queryByText('Disponible')).toBeNull();
    });

    it('producto inexistente: "Producto no encontrado" con enlace al catalogo', async () => {
        mocks.get.mockResolvedValue(null);
        renderAt('/tienda/p/nope');
        expect(await screen.findByRole('heading', { name: 'Producto no encontrado' })).toBeInTheDocument();
        expect(screen.getByText('Este producto ya no está disponible.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Volver al catálogo' })).toBeInTheDocument();
    });

    it('sin tenant configurado: "Catálogo no disponible"; error de red: alerta', async () => {
        mocks.get.mockRejectedValueOnce(new StoreError('store.errors.store_unavailable'));
        const a = renderAt('/tienda/p/x');
        expect(await screen.findByRole('heading', { name: 'Catálogo no disponible' })).toBeInTheDocument();
        a.unmount();

        mocks.get.mockRejectedValueOnce(new StoreError('store.errors.generic'));
        renderAt('/tienda/p/x');
        expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado');
    });
});
