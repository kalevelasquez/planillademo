import { describe, it, expect } from 'vitest';
import { esConceptoLavadoGasolina, puedeAplicarLavadoGasolina, CANTIDAD_LAVADOS_MINIMA } from './viaticosUtils';

describe('viaticosUtils - esConceptoLavadoGasolina (US-VIA-05)', () => {
    it('reconoce el concepto exacto', () => {
        expect(esConceptoLavadoGasolina('Lavado y gasolina')).toBe(true);
    });

    it('ignora espacios sobrantes', () => {
        expect(esConceptoLavadoGasolina('  Lavado y gasolina  ')).toBe(true);
    });

    it('no matchea otros conceptos', () => {
        expect(esConceptoLavadoGasolina('Alimentación')).toBe(false);
    });
});

describe('viaticosUtils - puedeAplicarLavadoGasolina (US-VIA-05 CA4)', () => {
    it(`requiere al menos ${CANTIDAD_LAVADOS_MINIMA} lavados`, () => {
        expect(puedeAplicarLavadoGasolina(3)).toBe(true);
        expect(puedeAplicarLavadoGasolina(4)).toBe(true);
    });

    it('rechaza menos del mínimo', () => {
        expect(puedeAplicarLavadoGasolina(2)).toBe(false);
        expect(puedeAplicarLavadoGasolina(0)).toBe(false);
    });

    it('trata null como cero', () => {
        expect(puedeAplicarLavadoGasolina(null)).toBe(false);
    });
});
