import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AvailabilityBadge } from './AvailabilityBadge';

describe('AvailabilityBadge', () => {
    it('Disponible muestra el texto traducido y nada de cantidades', () => {
        const { container } = render(<AvailabilityBadge availability="Disponible" />);
        expect(screen.getByText('Disponible')).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/\d/);
    });

    it('Agotado muestra el texto de agotado', () => {
        render(<AvailabilityBadge availability="Agotado" />);
        expect(screen.getByText('Agotado')).toBeInTheDocument();
        expect(screen.queryByText('Disponible')).toBeNull();
    });
});
