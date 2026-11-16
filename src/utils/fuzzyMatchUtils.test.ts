import { describe, it, expect } from 'vitest';
import { similitudDice, buscarEmpleadoPorNombre, normalizarTexto } from './fuzzyMatchUtils';

describe('fuzzyMatchUtils - normalizarTexto (US-VIA-01, helper de buscarEmpleadoPorNombre)', () => {
    it('quita acentos y normaliza mayúsculas/espacios', () => {
        expect(normalizarTexto('José  Pérez')).toBe('jose perez');
    });
});

describe('fuzzyMatchUtils - similitudDice (US-VIA-01, helper de buscarEmpleadoPorNombre)', () => {
    it('devuelve 1 para strings idénticos', () => {
        expect(similitudDice('Carlos Martínez', 'Carlos Martínez')).toBe(1);
    });

    it('devuelve un score alto para variantes con typo menor', () => {
        expect(similitudDice('Carlos Martinez', 'Carlos Martínez')).toBeGreaterThanOrEqual(0.8);
    });

    it('devuelve un score bajo para nombres distintos', () => {
        expect(similitudDice('Carlos Martínez', 'Ana López')).toBeLessThan(0.3);
    });

    it('devuelve 0 si alguno de los strings está vacío', () => {
        expect(similitudDice('', 'Carlos')).toBe(0);
    });
});

describe('fuzzyMatchUtils - buscarEmpleadoPorNombre (US-VIA-01 CA2)', () => {
    const empleados = [
        { id: '1', nombre_completo: 'Carlos Martínez' },
        { id: '2', nombre_completo: 'Ana López' },
        { id: '3', nombre_completo: 'María Fernanda Gómez' },
    ];

    it('encuentra el mejor match sobre el umbral', () => {
        const resultado = buscarEmpleadoPorNombre('Carlos Martinez', empleados);
        expect(resultado?.id).toBe('1');
    });

    it('devuelve null si ningún empleado supera el umbral', () => {
        const resultado = buscarEmpleadoPorNombre('Roberto Sánchez', empleados);
        expect(resultado).toBeNull();
    });
});
