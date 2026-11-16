import { describe, it, expect } from 'vitest';
import { calcularConceptosDelDia, valorHora, calcularMontoHorasExtras } from './horasExtrasUtils';

const SUELDO = 480; // valorHora = 2

describe('horasExtrasUtils - valorHora (US-HEX-01, IMPL-81 CA2)', () => {
    it('divide el sueldo mensual entre 240', () => {
        expect(valorHora(480)).toBe(2);
        expect(valorHora(1500)).toBe(6.25);
    });
});

describe('horasExtrasUtils - calcularConceptosDelDia (US-HEX-01, IMPL-81 CA1-CA5)', () => {
    it('día ordinario sin horas extra, con nocturnidad ordinaria (14:00-22:00, jornada 8h)', () => {
        const r = calcularConceptosDelDia(
            [{ entrada: '2026-07-20T14:00:00', salida: '2026-07-20T22:00:00' }],
            8, SUELDO, false
        );
        expect(r.horasTrabajadas).toBe(8);
        expect(r.detalle).toEqual([{ concepto: 'nocturnidad_ordinaria', horas: 3, tarifa: 1.25, monto: 7.5 }]);
        expect(r.montoTotal).toBe(7.5);
    });

    it('día ordinario con horas extra, sin nocturnidad (8:00-19:00 neto, jornada 8h → 3h HED)', () => {
        const r = calcularConceptosDelDia(
            [{ entrada: '2026-07-20T08:00:00', salida: '2026-07-20T19:00:00' }],
            8, SUELDO, false
        );
        expect(r.horasTrabajadas).toBe(11);
        expect(r.detalle).toEqual([{ concepto: 'hed', horas: 3, tarifa: 2.0, monto: 12 }]);
    });

    it('feriado/descanso cruzando medianoche, todo en franja nocturna (20:00-04:00)', () => {
        const r = calcularConceptosDelDia(
            [{ entrada: '2026-07-19T20:00:00', salida: '2026-07-20T04:00:00' }],
            0, SUELDO, true
        );
        expect(r.horasTrabajadas).toBe(8);
        expect(r.detalle).toEqual([{ concepto: 'feriado_nocturno', horas: 8, tarifa: 2.25, monto: 36 }]);
    });

    it('tramo único de 9h crudas (8:00-17:00) sobre jornada de 8h dispara advertencia de almuerzo', () => {
        const r = calcularConceptosDelDia(
            [{ entrada: '2026-07-20T08:00:00', salida: '2026-07-20T17:00:00' }],
            8, SUELDO, false
        );
        expect(r.detalle).toEqual([{ concepto: 'hed', horas: 1, tarifa: 2.0, monto: 4 }]);
        expect(r.advertencias.length).toBe(1);
    });

    it('mezcla HED y HEN cuando la nocturnidad no cubre toda la hora extra', () => {
        // 08:00-20:00 = 12h, jornada 8h -> Y=4h. Nocturno: 19:00-20:00 = 1h. Z(1) <= Y(4) -> HEN=1, HED=3.
        const r = calcularConceptosDelDia(
            [{ entrada: '2026-07-20T08:00:00', salida: '2026-07-20T20:00:00' }],
            8, SUELDO, false
        );
        expect(r.detalle).toEqual(expect.arrayContaining([
            { concepto: 'hed', horas: 3, tarifa: 2.0, monto: 12 },
            { concepto: 'hen', horas: 1, tarifa: 2.0, monto: 4 },
        ]));
    });

    it('rechaza un tramo con salida anterior o igual a la entrada', () => {
        expect(() => calcularConceptosDelDia(
            [{ entrada: '2026-07-20T10:00:00', salida: '2026-07-20T10:00:00' }],
            8, SUELDO, false
        )).toThrow();
    });
});

describe('calcularMontoHorasExtras (US-HEX-06 CA2)', () => {
    it('calcula el monto de cada categoría con las mismas tarifas del algoritmo de reloj', () => {
        const r = calcularMontoHorasExtras(SUELDO, { hed: 2, hen: 1, nocturnidad: 3, feriado: 0 });
        expect(r.detalle).toEqual(expect.arrayContaining([
            { concepto: 'hed', horas: 2, tarifa: 2.0, monto: 8 },
            { concepto: 'hen', horas: 1, tarifa: 2.0, monto: 4 },
            { concepto: 'nocturnidad_ordinaria', horas: 3, tarifa: 1.25, monto: 7.5 },
        ]));
        expect(r.montoTotal).toBe(19.5);
    });

    it('omite categorías en cero del detalle', () => {
        const r = calcularMontoHorasExtras(SUELDO, { hed: 0, hen: 0, nocturnidad: 0, feriado: 4 });
        expect(r.detalle).toEqual([{ concepto: 'feriado_diurno', horas: 4, tarifa: 2.0, monto: 16 }]);
    });

    it('devuelve monto 0 y detalle vacío cuando todas las horas son cero', () => {
        const r = calcularMontoHorasExtras(SUELDO, { hed: 0, hen: 0, nocturnidad: 0, feriado: 0 });
        expect(r.detalle).toEqual([]);
        expect(r.montoTotal).toBe(0);
    });
});
