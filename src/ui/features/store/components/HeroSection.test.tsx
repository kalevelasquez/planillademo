import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HeroSection } from './HeroSection';
import { BRAND } from '../../../../config/brand';

describe('HeroSection', () => {
    it('muestra tagline de marca, titulo h1, subtitulo y CTA al catalogo', () => {
        render(
            <MemoryRouter>
                <HeroSection />
            </MemoryRouter>,
        );
        expect(screen.getByText(BRAND.TAGLINE)).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1, name: 'Fruta fresca para tu negocio' })).toBeInTheDocument();
        expect(screen.getByText(/Consultá nuestro catálogo/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Ver catálogo' })).toHaveAttribute('href', '/tienda');
    });

    it('el CTA secundario lleva a la seccion "Como pedir" de la misma pagina', () => {
        render(
            <MemoryRouter>
                <HeroSection />
            </MemoryRouter>,
        );
        expect(screen.getByRole('link', { name: 'Cómo pedir' })).toHaveAttribute('href', '#como-pedir');
    });
});
