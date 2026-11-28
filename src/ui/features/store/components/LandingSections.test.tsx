import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ValueProps } from './ValueProps';
import { HowItWorks } from './HowItWorks';

describe('ValueProps', () => {
    it('lista las 4 propuestas de valor con titulo y descripcion', () => {
        render(<ValueProps />);
        expect(screen.getByRole('heading', { level: 2, name: 'Por qué comprar con nosotros' })).toBeInTheDocument();
        const items = within(screen.getByRole('list')).getAllByRole('listitem');
        expect(items).toHaveLength(4);
        expect(screen.getByRole('heading', { level: 3, name: 'Fruta fresca y seleccionada' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 3, name: 'Pagás al recibir' })).toBeInTheDocument();
    });
});

const renderHow = () =>
    render(
        <MemoryRouter>
            <HowItWorks />
        </MemoryRouter>,
    );

describe('HowItWorks', () => {
    it('muestra los 4 pasos en orden: cuenta, pedido, confirmacion del vendedor, pago contra entrega', () => {
        renderHow();
        const section = screen.getByRole('region', { name: 'Cómo pedir' });
        expect(section).toHaveAttribute('id', 'como-pedir');
        const steps = within(screen.getByRole('list')).getAllByRole('listitem');
        expect(steps).toHaveLength(4);
        expect(within(steps[0]).getByText('Creá tu cuenta')).toBeInTheDocument();
        expect(within(steps[1]).getByText('Armá tu pedido')).toBeInTheDocument();
        expect(within(steps[2]).getByText('Un vendedor confirma')).toBeInTheDocument();
        expect(within(steps[3]).getByText('Pagás contra entrega')).toBeInTheDocument();
    });

    it('ya NO dice Próximamente: el pedido en línea esta disponible y se ofrece crear cuenta', () => {
        renderHow();
        expect(screen.queryByText(/Próximamente/)).toBeNull();
        expect(screen.queryByText(/estarán disponibles muy pronto/)).toBeNull();
        expect(screen.getByRole('link', { name: 'Crear cuenta' })).toHaveAttribute('href', '/cuenta/registro');
    });
});
