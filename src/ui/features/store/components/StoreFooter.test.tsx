import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StoreFooter } from './StoreFooter';
import { BRAND } from '../../../../config/brand';

describe('StoreFooter', () => {
    it('incluye el acceso de empleados a /login, el catalogo y la marca', () => {
        render(
            <MemoryRouter>
                <StoreFooter />
            </MemoryRouter>,
        );
        expect(screen.getByRole('contentinfo')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Acceso empleados' })).toHaveAttribute('href', '/login');
        expect(screen.getByRole('link', { name: 'Catálogo' })).toHaveAttribute('href', '/tienda');
        expect(screen.getByText(BRAND.TAGLINE)).toBeInTheDocument();
        expect(screen.getByText(new RegExp(`${new Date().getFullYear()} ${BRAND.NAME}`, 'i'))).toBeInTheDocument();
    });

    it('el enlace de contacto apunta a la seccion de contacto de la landing', () => {
        render(
            <MemoryRouter>
                <StoreFooter />
            </MemoryRouter>,
        );
        expect(screen.getByRole('link', { name: 'Contacto' })).toHaveAttribute('href', '/#contacto');
    });
});
