import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuantityStepper } from './QuantityStepper';

describe('QuantityStepper', () => {
    it('muestra la cantidad y sube/baja de a una unidad', async () => {
        const onChange = vi.fn();
        render(<QuantityStepper name="Manzana" value={3} onChange={onChange} />);
        expect(screen.getByText('3')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Aumentar cantidad de Manzana' }));
        expect(onChange).toHaveBeenLastCalledWith(4);
        await userEvent.click(screen.getByRole('button', { name: 'Disminuir cantidad de Manzana' }));
        expect(onChange).toHaveBeenLastCalledWith(2);
    });

    it('en el minimo deshabilita "disminuir" y no emite', async () => {
        const onChange = vi.fn();
        render(<QuantityStepper name="Pera" value={1} onChange={onChange} />);
        const minus = screen.getByRole('button', { name: 'Disminuir cantidad de Pera' });
        expect(minus).toBeDisabled();
        await userEvent.click(minus);
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Aumentar cantidad de Pera' })).toBeEnabled();
    });

    it('en el maximo (500 por defecto o el indicado) deshabilita "aumentar"', () => {
        const { unmount } = render(<QuantityStepper name="Pera" value={500} onChange={() => {}} />);
        expect(screen.getByRole('button', { name: 'Aumentar cantidad de Pera' })).toBeDisabled();
        unmount();
        render(<QuantityStepper name="Pera" value={5} max={5} onChange={() => {}} />);
        expect(screen.getByRole('button', { name: 'Aumentar cantidad de Pera' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Disminuir cantidad de Pera' })).toBeEnabled();
    });
});
