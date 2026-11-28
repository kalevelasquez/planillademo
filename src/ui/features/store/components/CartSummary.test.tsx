import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CartSummary } from './CartSummary';

describe('CartSummary', () => {
    it('muestra unidades, total ESTIMADO, nota de precio de referencia y la accion', () => {
        render(
            <CartSummary count={3} total={37.5}>
                <button type="button">Continuar con el pedido</button>
            </CartSummary>,
        );
        expect(screen.getByText('3 unidades')).toBeInTheDocument();
        expect(screen.getByText('Total estimado')).toBeInTheDocument();
        expect(screen.getByText('$37.50')).toBeInTheDocument();
        expect(screen.getByText(/el vendedor confirma el total final/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Continuar con el pedido' })).toBeInTheDocument();
    });

    it('singular con 1 unidad y otro total', () => {
        render(<CartSummary count={1} total={3} />);
        expect(screen.getByText('1 unidad')).toBeInTheDocument();
        expect(screen.getByText('$3.00')).toBeInTheDocument();
    });
});
