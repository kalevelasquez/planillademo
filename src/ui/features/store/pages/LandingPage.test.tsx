import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../../../services/storeService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../services/storeService')>()),
    listProducts: mocks.list,
}));

import LandingPage from './LandingPage';
import { StoreError, type StoreProduct } from '../../../../services/storeService';

const mk = (key: string, name: string, over: Partial<StoreProduct> = {}): StoreProduct => ({
    productKey: key,
    name,
    caliber: null,
    quality: null,
    price: 2,
    imageUrl: 'https://cdn/x.webp',
    availability: 'Disponible',
    ...over,
});

const renderPage = () =>
    render(
        <MemoryRouter>
            <LandingPage />
        </MemoryRouter>,
    );

beforeEach(() => vi.clearAllMocks());

describe('LandingPage', () => {
    it('muestra hero, propuestas de valor, como pedir y contacto', async () => {
        mocks.list.mockResolvedValue([mk('a', 'Banano')]);
        renderPage();
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Fruta fresca para tu negocio');
        expect(screen.getByRole('heading', { name: 'Por qué comprar con nosotros' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Cómo pedir' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Contacto comercial' })).toBeInTheDocument();
        await screen.findByRole('heading', { name: 'Productos destacados' });
    });

    it('destacados: pide un lote chico al RPC, prioriza disponibles con foto y limita a 4', async () => {
        mocks.list.mockResolvedValue([
            mk('x', 'Agotado Uno', { availability: 'Agotado' }),
            mk('s1', 'SinFoto', { imageUrl: null }),
            mk('c1', 'Con1'),
            mk('c2', 'Con2'),
            mk('c3', 'Con3'),
            mk('c4', 'Con4'),
        ]);
        renderPage();
        const list = await screen.findByRole('list', { name: 'Productos destacados' });
        const names = within(list).getAllByRole('heading').map((h) => h.textContent);
        expect(names).toEqual(['Con1', 'Con2', 'Con3', 'Con4']);
        expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 24 }));
        expect(screen.getByRole('link', { name: 'Ver todo el catálogo' })).toHaveAttribute('href', '/tienda');
    });

    it('sin tenant configurado la landing igual se renderiza (sin seccion de destacados ni errores)', async () => {
        mocks.list.mockRejectedValue(new StoreError('store.errors.store_unavailable'));
        renderPage();
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Contacto comercial' })).toBeInTheDocument();
        await vi.waitFor(() => expect(mocks.list).toHaveBeenCalled());
        expect(screen.queryByRole('heading', { name: 'Productos destacados' })).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('catalogo vacio o error de red: oculta los destacados sin romper la pagina', async () => {
        mocks.list.mockResolvedValue([]);
        const { unmount } = renderPage();
        await vi.waitFor(() => expect(mocks.list).toHaveBeenCalled());
        expect(screen.queryByRole('heading', { name: 'Productos destacados' })).toBeNull();
        unmount();

        mocks.list.mockRejectedValue(new StoreError('store.errors.generic'));
        renderPage();
        await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
        expect(screen.queryByRole('heading', { name: 'Productos destacados' })).toBeNull();
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    it('no ofrece registro ni pedido todavia: ningun boton de "Crear cuenta"/"Pedir" activo', async () => {
        mocks.list.mockResolvedValue([mk('a', 'Banano')]);
        renderPage();
        await screen.findByRole('heading', { name: 'Productos destacados' });
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByRole('link', { name: /crear cuenta|registr/i })).toBeNull();
    });
});
