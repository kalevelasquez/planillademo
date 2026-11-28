import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../../../services/storeService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../services/storeService')>()),
    listProducts: mocks.list,
}));

import CatalogPage from './CatalogPage';
import { StoreError, type StoreProduct } from '../../../../services/storeService';

const mk = (key: string, name: string, over: Partial<StoreProduct> = {}): StoreProduct => ({
    productKey: key,
    name,
    caliber: '80',
    quality: 'Primera',
    price: 5,
    imageUrl: null,
    availability: 'Disponible',
    ...over,
});

const renderPage = () =>
    render(
        <MemoryRouter initialEntries={['/tienda']}>
            <CatalogPage />
        </MemoryRouter>,
    );

beforeEach(() => vi.clearAllMocks());

describe('CatalogPage', () => {
    it('muestra estado de carga accesible y luego la grilla de productos', async () => {
        mocks.list.mockResolvedValue([mk('a', 'Banano'), mk('b', 'Mango', { availability: 'Agotado' })]);
        renderPage();
        expect(screen.getByRole('status')).toHaveTextContent('Cargando catálogo');

        const list = await screen.findByRole('list', { name: 'Catálogo' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByRole('heading', { level: 1, name: 'Catálogo' })).toBeInTheDocument();
        expect(screen.getByText('Disponible')).toBeInTheDocument();
        expect(screen.getByText('Agotado')).toBeInTheDocument();
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('buscar vuelve a consultar con el texto (debounce) y limpiar restaura la lista', async () => {
        mocks.list.mockResolvedValue([mk('a', 'Banano')]);
        renderPage();
        await screen.findByRole('list', { name: 'Catálogo' });

        const user = userEvent.setup();
        await user.type(screen.getByRole('searchbox', { name: 'Buscar productos' }), 'man');
        await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ search: 'man', limit: 100 }), { timeout: 2000 });
    });

    it('sin resultados para una busqueda muestra el mensaje con el texto buscado', async () => {
        mocks.list.mockResolvedValueOnce([mk('a', 'Banano')]).mockResolvedValue([]);
        renderPage();
        await screen.findByRole('list', { name: 'Catálogo' });

        await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Buscar productos' }), 'zzz');
        expect(await screen.findByText(/No encontramos productos para “zzz”/, {}, { timeout: 2000 })).toBeInTheDocument();
    });

    it('catalogo vacio sin busqueda muestra store.catalog.empty', async () => {
        mocks.list.mockResolvedValue([]);
        renderPage();
        expect(await screen.findByText('No hay productos disponibles por el momento.')).toBeInTheDocument();
    });

    it('sin VITE_STORE_TENANT_ID: estado amigable "Catálogo no disponible" (sin crash ni pantalla en blanco)', async () => {
        mocks.list.mockRejectedValue(new StoreError('store.errors.store_unavailable'));
        renderPage();
        expect(await screen.findByRole('heading', { name: 'Catálogo no disponible' })).toBeInTheDocument();
        expect(screen.getByText('La tienda no está disponible por el momento.')).toBeInTheDocument();
        expect(screen.queryByRole('searchbox')).toBeNull();
    });

    it('error generico muestra alerta y "Reintentar" vuelve a cargar', async () => {
        mocks.list.mockRejectedValueOnce(new StoreError('store.errors.generic')).mockResolvedValueOnce([mk('a', 'Banano')]);
        renderPage();
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Ocurrió un error inesperado');

        await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
        expect(await screen.findByRole('list', { name: 'Catálogo' })).toBeInTheDocument();
    });
});
