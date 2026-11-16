import { describe, it, expect } from 'vitest';
import { calcularDiasHabiles, encontrarQuincenaAnterior } from './quincenaUtils';

describe('calcularDiasHabiles (IMPL-11, revisión épica por épica)', () => {
    it('cuenta Lunes-Sábado, excluye domingo, sin feriados', () => {
        // 2026-03-01, 08 y 15 son domingo — rango de 15 días con 3 domingos
        expect(calcularDiasHabiles('2026-03-01', '2026-03-15')).toBe(12);
    });

    it('descuenta feriados dentro del rango además de los domingos', () => {
        // 2026-03-10 es martes (día hábil normal) — se marca como feriado
        expect(calcularDiasHabiles('2026-03-01', '2026-03-15', ['2026-03-10'])).toBe(11);
    });

    it('ignora feriados fuera del rango', () => {
        expect(calcularDiasHabiles('2026-03-01', '2026-03-15', ['2026-04-01'])).toBe(12);
    });
});

describe('encontrarQuincenaAnterior (IMPL-10, revisión épica por épica)', () => {
    const q = (id: string, tipo: 'normal' | 'aguinaldo', fecha_inicio: string) => ({ id, tipo, fecha_inicio });

    it('encuentra la más reciente del mismo tipo anterior a la actual', () => {
        const actual = q('c', 'normal', '2026-03-16');
        const quincenas = [q('a', 'normal', '2026-02-01'), q('b', 'normal', '2026-03-01'), actual];
        expect(encontrarQuincenaAnterior(quincenas, actual)?.id).toBe('b');
    });

    it('ignora quincenas de otro tipo', () => {
        const actual = q('b', 'normal', '2026-03-01');
        const quincenas = [q('a', 'aguinaldo', '2026-02-01'), actual];
        expect(encontrarQuincenaAnterior(quincenas, actual)).toBeNull();
    });

    it('devuelve null si no hay ninguna anterior', () => {
        const actual = q('a', 'normal', '2026-01-01');
        expect(encontrarQuincenaAnterior([actual], actual)).toBeNull();
    });
});
