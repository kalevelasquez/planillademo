import { describe, it, expect } from 'vitest';
import { clasificarDescuento } from './descuentosPivotUtils';

describe('clasificarDescuento', () => {
    it('matchea un banco conocido bajo Préstamo bancario', () => {
        expect(clasificarDescuento('Préstamo bancario', 'Banco Promerica')).toEqual({ grupo: 'financieras', columna: 'Banco Promerica' });
    });

    it('matchea con variantes de acentos/mayúsculas (normalizarTexto)', () => {
        expect(clasificarDescuento('Financiera', 'banco cuscatlan')).toEqual({ grupo: 'financieras', columna: 'Banco Cuscatlán' });
    });

    it('un banco no reconocido cae en Otras Instituciones Financieras, sin perder el monto', () => {
        expect(clasificarDescuento('Préstamo bancario', 'Banco Desconocido S.A.')).toEqual({ grupo: 'financieras', columna: 'Otras Instituciones Financieras' });
    });

    it('institución null bajo Financiera cae en Otras Instituciones Financieras', () => {
        expect(clasificarDescuento('Financiera', null)).toEqual({ grupo: 'financieras', columna: 'Otras Instituciones Financieras' });
    });

    it('matchea Vivienda contra el catálogo conocido', () => {
        expect(clasificarDescuento('Vivienda', 'Fondo Social para la Vivienda')).toEqual({ grupo: 'vivienda', columna: 'Fondo Social para la Vivienda' });
    });

    it('una institución de Vivienda no reconocida cae en Otra Vivienda', () => {
        expect(clasificarDescuento('Vivienda', 'Cooperativa X')).toEqual({ grupo: 'vivienda', columna: 'Otra Vivienda' });
    });

    it('Vehículo va a su propia columna fija, sin importar la institución', () => {
        expect(clasificarDescuento('Vehículo', 'cualquier cosa')).toEqual({ grupo: 'vehiculo', columna: 'Vehículo' });
    });

    it('Lentes va a su propia columna fija', () => {
        expect(clasificarDescuento('Lentes', null)).toEqual({ grupo: 'lentes', columna: 'Lentes' });
    });

    it('categorías del listado Diversos matchean su propia columna', () => {
        expect(clasificarDescuento('Procuraduría', null)).toEqual({ grupo: 'diversos', columna: 'Procuraduría' });
    });

    it('una categoría heredada no listada (Uniforme) cae en el catch-all Descuento genérico', () => {
        expect(clasificarDescuento('Uniforme', null)).toEqual({ grupo: 'diversos', columna: 'Descuento genérico' });
    });

    it('una categoría completamente nueva (creada por un admin sin saber del reporte) también cae en el catch-all', () => {
        expect(clasificarDescuento('Categoría Inventada', 'algo')).toEqual({ grupo: 'diversos', columna: 'Descuento genérico' });
    });
});
