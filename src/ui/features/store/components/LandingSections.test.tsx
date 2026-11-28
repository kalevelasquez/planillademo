import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

describe('HowItWorks', () => {
    it('muestra los 4 pasos en orden: cuenta, pedido, confirmacion del vendedor, pago contra entrega', () => {
        render(<HowItWorks />);
        const section = screen.getByRole('region', { name: 'Cómo pedir' });
        expect(section).toHaveAttribute('id', 'como-pedir');
        const steps = within(screen.getByRole('list')).getAllByRole('listitem');
        expect(steps).toHaveLength(4);
        expect(within(steps[0]).getByText('Creá tu cuenta')).toBeInTheDocument();
        expect(within(steps[1]).getByText('Armá tu pedido')).toBeInTheDocument();
        expect(within(steps[2]).getByText('Un vendedor confirma')).toBeInTheDocument();
        expect(within(steps[3]).getByText('Pagás contra entrega')).toBeInTheDocument();
    });

    it('avisa que pedir en linea es "Próximamente" y NO ofrece botones de crear cuenta ni pedir', () => {
        render(<HowItWorks />);
        expect(screen.getByText(/Los pedidos en línea estarán disponibles muy pronto/)).toBeInTheDocument();
        expect(screen.getAllByText('Próximamente').length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
    });
});
