import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../../services/storeService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../services/storeService')>()),
    getProduct: mocks.get,
}));

import ProductDetailPage from './ProductDetailPage';
import { StoreError, type StoreProduct } from '../../../../services/storeService';
import { useCartStore } from '../../../../store/cartStore';

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

beforeEach(() => {
    vi.clearAllMocks();
    useCartStore.getState().clear();
    localStorage.clear();
});

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

    it('Pedir agrega 1 unidad al carrito y ofrece ir al carrito', async () => {
        mocks.get.mockResolvedValue(P);
        renderAt('/tienda/p/abc123');
        const btn = await screen.findByRole('button', { name: 'Pedir' });
        expect(btn).toBeEnabled();
        await userEvent.click(btn);

        expect(useCartStore.getState().items).toEqual([
            { productKey: 'abc123', name: 'Manzana Fuji', caliber: '80', quality: 'Primera', price: 12.5, imageUrl: 'https://cdn/x.webp', qty: 1 },
        ]);
        expect(screen.getByRole('status')).toHaveTextContent('Agregado al carrito.');
        expect(screen.getByRole('link', { name: 'Ver carrito' })).toHaveAttribute('href', '/tienda/carrito');
    });

    it('elegir cantidad con el stepper y pedir suma esa cantidad (y de nuevo suma sobre la linea)', async () => {
        mocks.get.mockResolvedValue(P);
        renderAt('/tienda/p/abc123');
        await userEvent.click(await screen.findByRole('button', { name: 'Aumentar cantidad de Manzana Fuji' }));
        await userEvent.click(screen.getByRole('button', { name: 'Aumentar cantidad de Manzana Fuji' }));
        await userEvent.click(screen.getByRole('button', { name: 'Pedir' }));
        expect(useCartStore.getState().items[0].qty).toBe(3);
        await userEvent.click(screen.getByRole('button', { name: 'Pedir' }));
        expect(useCartStore.getState().items[0].qty).toBe(6);
    });

    it('Agotado: no se puede pedir (boton deshabilitado, sin stepper) y el carrito no cambia', async () => {
        mocks.get.mockResolvedValue({ ...P, availability: 'Agotado' });
        renderAt('/tienda/p/abc123');
        const btn = await screen.findByRole('button', { name: 'No disponible' });
        expect(btn).toBeDisabled();
        await userEvent.click(btn);
        expect(useCartStore.getState().items).toHaveLength(0);
        expect(screen.queryByRole('button', { name: /Aumentar cantidad/ })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Pedir' })).toBeNull();
    });

    it('carrito lleno de productos distintos: avisa en vez de agregar', async () => {
        for (let i = 0; i < 30; i++) useCartStore.getState().add({ ...P, productKey: 'k' + i }, 1);
        mocks.get.mockResolvedValue(P);
        renderAt('/tienda/p/abc123');
        await userEvent.click(await screen.findByRole('button', { name: 'Pedir' }));
        expect(screen.getByRole('alert')).toHaveTextContent('El carrito ya tiene el máximo de productos distintos');
        expect(useCartStore.getState().items).toHaveLength(30);
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
