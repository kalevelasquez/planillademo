import { describe, it, expect } from 'vitest';
import { buscarRangoIncentivo, esEmpleadoElegible, calcularTotalNominaPreview, type RangoIncentivo } from './bonificacionesUtils';

const RANGOS: RangoIncentivo[] = [
    { desde: 0, hasta: 5000, bono: 50 },
    { desde: 5000.01, hasta: 10000, bono: 100 },
    { desde: 10000.01, hasta: null, bono: 200 },
];

describe('buscarRangoIncentivo (US-BON-02, IMPL-74)', () => {
    it('encuentra el rango correcto para una utilidad neta dentro de un tramo cerrado', () => {
        expect(buscarRangoIncentivo(3000, RANGOS)).toBe(50);
        expect(buscarRangoIncentivo(7000, RANGOS)).toBe(100);
    });

    it('el último rango con hasta=null es abierto (sin techo)', () => {
        expect(buscarRangoIncentivo(50000, RANGOS)).toBe(200);
    });

    it('respeta los límites exactos de cada tramo', () => {
        expect(buscarRangoIncentivo(5000, RANGOS)).toBe(50);
        expect(buscarRangoIncentivo(5000.01, RANGOS)).toBe(100);
    });

    it('sin rango configurado que cubra la utilidad neta, no hay bono', () => {
        expect(buscarRangoIncentivo(-100, RANGOS)).toBeNull();
    });

    it('sin ninguna tabla de rangos, no hay bono', () => {
        expect(buscarRangoIncentivo(3000, [])).toBeNull();
    });
});

describe('esEmpleadoElegible (US-BON-02/IMPL-74, CA3 de US-BON-01/IMPL-73)', () => {
    it('tabla apuntada a un empleado específico solo es elegible para ese empleado', () => {
        const tabla = { empleadoId: 'emp-1', grupo: null };
        expect(esEmpleadoElegible(tabla, { id: 'emp-1', departamento: 'Ventas' })).toBe(true);
        expect(esEmpleadoElegible(tabla, { id: 'emp-2', departamento: 'Ventas' })).toBe(false);
    });

    it('tabla apuntada a un grupo es elegible para todo el departamento que coincide', () => {
        const tabla = { empleadoId: null, grupo: 'Ventas' };
        expect(esEmpleadoElegible(tabla, { id: 'emp-1', departamento: 'Ventas' })).toBe(true);
        expect(esEmpleadoElegible(tabla, { id: 'emp-2', departamento: 'Producción' })).toBe(false);
    });

    it('un empleado sin tabla asignada (ni empleado ni grupo) nunca es elegible', () => {
        const tabla = { empleadoId: null, grupo: null };
        expect(esEmpleadoElegible(tabla, { id: 'emp-1', departamento: 'Ventas' })).toBe(false);
    });
});

describe('calcularTotalNominaPreview (US-BON-03, IMPL-75 CA3)', () => {
    it('multiplica el monto por empleado por la cantidad de empleados activos', () => {
        expect(calcularTotalNominaPreview(25, 40)).toBe(1000);
    });

    it('redondea a 2 decimales', () => {
        expect(calcularTotalNominaPreview(10.005, 3)).toBe(30.02);
    });
});
