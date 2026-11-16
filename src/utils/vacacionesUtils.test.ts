import { describe, it, expect } from 'vitest';
import { calcularDiasVacacion, calcularPagoVacacion } from './vacacionesUtils';

describe('calcularDiasVacacion (US-VAC-01, IMPL-65/66)', () => {
    it('cuenta ambos extremos inclusive', () => {
        expect(calcularDiasVacacion('2026-07-01', '2026-07-05')).toBe(5);
    });

    it('un solo día', () => {
        expect(calcularDiasVacacion('2026-07-01', '2026-07-01')).toBe(1);
    });
});

describe('calcularPagoVacacion (US-VAC-01, IMPL-65/66)', () => {
    it('calcula sueldo diario, monto base, recargo 30% y total (Art. 177 CT)', () => {
        const resultado = calcularPagoVacacion('2026-07-01', '2026-07-04', 900);
        expect(resultado.dias).toBe(4);
        expect(resultado.sueldoDiario).toBe(30);
        expect(resultado.montoBase).toBe(120);
        expect(resultado.recargo30).toBe(36);
        expect(resultado.montoTotal).toBe(156);
    });
});
