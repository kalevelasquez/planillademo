import { describe, it, expect } from 'vitest';
import { requiereAutorizacionGG } from './anticiposUtils';

// calcularMontoCuota se movió a cuotasUtils.ts (compartida con Descuentos) — ver cuotasUtils.test.ts.

describe('requiereAutorizacionGG (US-ANT-02, IMPL-51)', () => {
    it('no requiere autorización para salario', () => {
        expect(requiereAutorizacionGG('salario')).toBe(false);
    });

    it('requiere autorización para vacaciones', () => {
        expect(requiereAutorizacionGG('vacaciones')).toBe(true);
    });

    it('requiere autorización para aguinaldo', () => {
        expect(requiereAutorizacionGG('aguinaldo')).toBe(true);
    });
});
