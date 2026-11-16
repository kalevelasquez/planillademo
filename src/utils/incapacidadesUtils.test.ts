import { describe, it, expect } from 'vitest';
import { calcularDiasIncapacidad, calcularCoberturaIncapacidad, DIAS_ENFERMEDAD_COMUN_SIN_SUBSIDIO } from './incapacidadesUtils';

describe('incapacidadesUtils - calcularDiasIncapacidad (US-INC-01, IMPL-43)', () => {
    it('cuenta ambos extremos inclusive', () => {
        expect(calcularDiasIncapacidad('2026-07-01', '2026-07-01')).toBe(1);
        expect(calcularDiasIncapacidad('2026-07-01', '2026-07-03')).toBe(3);
        expect(calcularDiasIncapacidad('2026-07-01', '2026-07-10')).toBe(10);
    });
});

describe('incapacidadesUtils - calcularCoberturaIncapacidad (US-INC-01 CA2/CA5)', () => {
    it('Enfermedad común 1-3 días: sin subsidio, Imporfrut paga el 100%', () => {
        expect(calcularCoberturaIncapacidad('enfermedad_comun', 1)).toEqual({ conSubsidio: false, diasCubiertosImporfrut: 1, diaInicioSubsidioIsss: null });
        expect(calcularCoberturaIncapacidad('enfermedad_comun', DIAS_ENFERMEDAD_COMUN_SIN_SUBSIDIO)).toEqual({ conSubsidio: false, diasCubiertosImporfrut: 3, diaInicioSubsidioIsss: null });
    });

    it('Enfermedad común 4+ días: subsidio desde el día 4, Imporfrut paga solo días 1-3', () => {
        expect(calcularCoberturaIncapacidad('enfermedad_comun', 4)).toEqual({ conSubsidio: true, diasCubiertosImporfrut: 3, diaInicioSubsidioIsss: 4 });
        expect(calcularCoberturaIncapacidad('enfermedad_comun', 15)).toEqual({ conSubsidio: true, diasCubiertosImporfrut: 3, diaInicioSubsidioIsss: 4 });
    });

    it('Accidente de trabajo: subsidio desde el día 1, sin importar la duración', () => {
        expect(calcularCoberturaIncapacidad('accidente_trabajo', 1)).toEqual({ conSubsidio: true, diasCubiertosImporfrut: 0, diaInicioSubsidioIsss: 1 });
        expect(calcularCoberturaIncapacidad('accidente_trabajo', 30)).toEqual({ conSubsidio: true, diasCubiertosImporfrut: 0, diaInicioSubsidioIsss: 1 });
    });

    it('Maternidad: subsidio desde el día 1', () => {
        expect(calcularCoberturaIncapacidad('maternidad', 84)).toEqual({ conSubsidio: true, diasCubiertosImporfrut: 0, diaInicioSubsidioIsss: 1 });
    });
});
