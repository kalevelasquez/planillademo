import { describe, it, expect } from 'vitest';
import { calcularMontoCuota } from './cuotasUtils';

describe('calcularMontoCuota (compartida: US-ANT-02/IMPL-51, US-DESC-01/IMPL-58)', () => {
    it('divide el monto total entre el número de cuotas', () => {
        expect(calcularMontoCuota(400, 4)).toBe(100);
    });

    it('redondea a 2 decimales', () => {
        expect(calcularMontoCuota(500, 3)).toBe(166.67);
    });

    it('funciona con una sola cuota', () => {
        expect(calcularMontoCuota(250, 1)).toBe(250);
    });
});
