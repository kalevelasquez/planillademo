import { describe, it, expect } from 'vitest';
import { esPenultimaCuota } from './descuentosUtils';

// calcularMontoCuota se movió a cuotasUtils.ts (compartida con Anticipos) — ver cuotasUtils.test.ts.
// esUltimaCuotaPagada se eliminó (revisión de arquitectura del PM): sin ningún uso fuera de su
// propio test — DescuentosView.tsx usa esPenultimaCuota, la finalización automática al saldar
// (US-DESC-04/IMPL-61) se resuelve server-side.

describe('esPenultimaCuota (US-DESC-03, IMPL-60)', () => {
    it('es true cuando falta exactamente una cuota', () => {
        expect(esPenultimaCuota(6, 5)).toBe(true);
    });

    it('es false para un descuento indefinido (numeroCuotas null)', () => {
        expect(esPenultimaCuota(null, 5)).toBe(false);
    });

    it('es false si faltan más de una cuota', () => {
        expect(esPenultimaCuota(6, 3)).toBe(false);
    });
});
