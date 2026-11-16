import { describe, it, expect } from 'vitest';
import {
    validateDescuentoImportHeaders,
    mapExcelRowToDescuentoCruda,
    validarFilasImportacionDescuentos,
    type DescuentoImportCruda,
    type ContextoValidacionImportacionDescuentos,
} from './descuentosExcelUtils';
import { DESCUENTO_IMPORT_HEADERS } from '../config/constants';

const ENCABEZADOS_COMPLETOS = Object.values(DESCUENTO_IMPORT_HEADERS);

function filaCruda(overrides: Partial<DescuentoImportCruda> = {}): DescuentoImportCruda {
    return {
        codigoEmpleado: 'EMP-2026-001',
        categoriaNombre: 'Uniforme',
        institucion: '',
        montoQuincenalRaw: 25,
        montoTotalRaw: '',
        numeroCuotasRaw: '',
        cuotaExactaRaw: '',
        fechaFinRaw: '',
        saldoInicialPagadoRaw: '',
        ...overrides,
    };
}

function contextoBase(overrides: Partial<ContextoValidacionImportacionDescuentos> = {}): ContextoValidacionImportacionDescuentos {
    return {
        empleados: [{ id: 'emp-1', codigo: 'EMP-2026-001', nombreCompleto: 'Juan Pérez' }],
        categoriasActivas: [
            { id: 'cat-uniforme', nombre: 'Uniforme' },
            { id: 'cat-prestamo', nombre: 'Préstamo bancario' },
        ],
        ...overrides,
    };
}

describe('validateDescuentoImportHeaders', () => {
    it('pasa cuando están las 3 columnas obligatorias', () => {
        const { isValid, missingHeaders } = validateDescuentoImportHeaders(ENCABEZADOS_COMPLETOS);
        expect(isValid).toBe(true);
        expect(missingHeaders).toEqual([]);
    });

    it('detecta encabezados obligatorios faltantes', () => {
        const sinCategoria = ENCABEZADOS_COMPLETOS.filter((h) => h !== DESCUENTO_IMPORT_HEADERS.CATEGORIA);
        const { isValid, missingHeaders } = validateDescuentoImportHeaders(sinCategoria);
        expect(isValid).toBe(false);
        expect(missingHeaders).toEqual([DESCUENTO_IMPORT_HEADERS.CATEGORIA]);
    });

    it('es insensible a mayúsculas/tildes al matchear encabezados', () => {
        const variante = ENCABEZADOS_COMPLETOS.map((h) => h.toUpperCase());
        expect(validateDescuentoImportHeaders(variante).isValid).toBe(true);
    });
});

describe('mapExcelRowToDescuentoCruda', () => {
    it('mapea una fila completa por nombre de encabezado', () => {
        const row: Record<string, unknown> = {
            [DESCUENTO_IMPORT_HEADERS.CODIGO_EMPLEADO]: 'EMP-2026-001',
            [DESCUENTO_IMPORT_HEADERS.CATEGORIA]: 'Uniforme',
            [DESCUENTO_IMPORT_HEADERS.MONTO_QUINCENAL]: 25,
        };
        const cruda = mapExcelRowToDescuentoCruda(row);
        expect(cruda.codigoEmpleado).toBe('EMP-2026-001');
        expect(cruda.categoriaNombre).toBe('Uniforme');
        expect(cruda.montoQuincenalRaw).toBe(25);
    });

    it('resuelve el encabezado real de la fila sin importar mayúsculas/tildes', () => {
        const row: Record<string, unknown> = { 'categoría': 'Vivienda' };
        expect(mapExcelRowToDescuentoCruda(row).categoriaNombre).toBe('Vivienda');
    });

    it('devuelve string vacío para columnas de texto ausentes', () => {
        expect(mapExcelRowToDescuentoCruda({}).institucion).toBe('');
    });
});

describe('validarFilasImportacionDescuentos', () => {
    it('happy path: fila indefinida (sin monto total) produce "listo" con empleado y categoría resueltos', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda()], contextoBase());
        expect(fila.errores).toEqual([]);
        expect(fila.listo).not.toBeNull();
        expect(fila.listo?.empleado_id).toBe('emp-1');
        expect(fila.listo?.categoria_id).toBe('cat-uniforme');
        expect(fila.listo?.monto_quincenal).toBe(25);
        expect(fila.listo?.monto_total).toBeNull();
    });

    it('marca como obligatorios: código empleado, categoría y monto quincenal', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({
            codigoEmpleado: '', categoriaNombre: '', montoQuincenalRaw: '',
        })], contextoBase());
        expect(fila.listo).toBeNull();
        expect(fila.errores).toEqual(expect.arrayContaining([
            'Código Empleado es obligatorio.',
            'Categoría es obligatoria.',
            'Monto Quincenal es obligatorio.',
        ]));
    });

    it('rechaza un Código Empleado que no existe', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({ codigoEmpleado: 'EMP-9999' })], contextoBase());
        expect(fila.errores).toContain('Código Empleado "EMP-9999" no existe.');
    });

    it('resuelve el Código Empleado insensible a mayúsculas', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({ codigoEmpleado: 'emp-2026-001' })], contextoBase());
        expect(fila.listo?.empleado_id).toBe('emp-1');
    });

    it('rechaza una Categoría que no existe en el catálogo activo', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({ categoriaNombre: 'Categoría Fantasma' })], contextoBase());
        expect(fila.errores).toContain('Categoría "Categoría Fantasma" no existe. Verificá el nombre exacto.');
    });

    it('resuelve la Categoría insensible a mayúsculas/tildes', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({ categoriaNombre: 'uniforme' })], contextoBase());
        expect(fila.listo?.categoria_id).toBe('cat-uniforme');
    });

    it('rechaza Monto Quincenal no numérico', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({ montoQuincenalRaw: 'veinticinco' })], contextoBase());
        expect(fila.errores).toContain('Monto Quincenal debe ser numérico.');
    });

    it('rechaza Monto Quincenal menor o igual a cero', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({ montoQuincenalRaw: 0 })], contextoBase());
        expect(fila.errores).toContain('Monto Quincenal debe ser mayor a cero.');
    });

    it('categoría "Préstamo bancario" sin Monto Total ni Número de Cuotas/Cuota Exacta rechaza la fila (mismo criterio que crear_descuento)', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({ categoriaNombre: 'Préstamo bancario' })], contextoBase());
        expect(fila.listo).toBeNull();
        expect(fila.errores).toEqual(expect.arrayContaining([
            'La categoría "Préstamo bancario" requiere Monto Total.',
            'La categoría "Préstamo bancario" requiere Número de Cuotas o Cuota Exacta.',
        ]));
    });

    it('categoría "Préstamo bancario" con Monto Total + Número de Cuotas pasa', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({
            categoriaNombre: 'Préstamo bancario', montoTotalRaw: 1000, numeroCuotasRaw: 10,
        })], contextoBase());
        expect(fila.errores).toEqual([]);
        expect(fila.listo?.monto_total).toBe(1000);
        expect(fila.listo?.numero_cuotas).toBe(10);
        expect(fila.listo?.cuota_exacta).toBeNull();
    });

    it('categoría "Préstamo bancario" con Monto Total + Cuota Exacta pasa (alternativa a Número de Cuotas)', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({
            categoriaNombre: 'Préstamo bancario', montoTotalRaw: 1000, cuotaExactaRaw: 100,
        })], contextoBase());
        expect(fila.errores).toEqual([]);
        expect(fila.listo?.cuota_exacta).toBe(100);
        expect(fila.listo?.numero_cuotas).toBeNull();
    });

    it('rechaza Número de Cuotas y Cuota Exacta indicados a la vez (ambiguo, la fila manda una de las dos)', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({
            montoTotalRaw: 1000, numeroCuotasRaw: 10, cuotaExactaRaw: 100,
        })], contextoBase());
        expect(fila.errores).toContain('No puede indicar Número de Cuotas y Cuota Exacta al mismo tiempo — use solo una de las dos.');
    });

    it('rechaza Número de Cuotas sin Monto Total (violaría el CHECK de la tabla)', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({ numeroCuotasRaw: 10 })], contextoBase());
        expect(fila.errores).toContain('Número de Cuotas / Cuota Exacta requieren que Monto Total esté definido.');
    });

    it('rechaza Monto Total sin Número de Cuotas ni Cuota Exacta (violaría el CHECK de la tabla)', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({ montoTotalRaw: 1000 })], contextoBase());
        expect(fila.errores).toContain('Monto Total requiere Número de Cuotas o Cuota Exacta.');
    });

    it('acepta Fecha Fin con formato DD/MM/AAAA válido', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({ fechaFinRaw: '31/12/2026' })], contextoBase());
        expect(fila.errores).toEqual([]);
        expect(fila.listo?.fecha_fin).toBe('2026-12-31');
    });

    it('rechaza Fecha Fin con formato inválido', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({ fechaFinRaw: '31 de diciembre' })], contextoBase());
        expect(fila.errores).toContain('Fecha Fin con formato inválido (use DD/MM/AAAA).');
    });

    it('rechaza Saldo Inicial Pagado sin Monto Total definido', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({ saldoInicialPagadoRaw: 50 })], contextoBase());
        expect(fila.errores).toContain('Saldo Inicial Pagado solo aplica si Monto Total está definido.');
    });

    it('rechaza Saldo Inicial Pagado mayor al Monto Total', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({
            montoTotalRaw: 1000, numeroCuotasRaw: 10, saldoInicialPagadoRaw: 1500,
        })], contextoBase());
        expect(fila.errores).toContain('El Saldo Inicial Pagado no puede superar el Monto Total.');
    });

    it('acepta Saldo Inicial Pagado válido dentro del Monto Total', () => {
        const [fila] = validarFilasImportacionDescuentos([filaCruda({
            montoTotalRaw: 1000, numeroCuotasRaw: 10, saldoInicialPagadoRaw: 300,
        })], contextoBase());
        expect(fila.errores).toEqual([]);
        expect(fila.listo?.monto_pagado_inicial).toBe(300);
    });

    it('numera cada fila como si viniera del Excel (fila 1 = encabezados, primera fila de datos = 2)', () => {
        const filas = validarFilasImportacionDescuentos([filaCruda(), filaCruda({ codigoEmpleado: 'EMP-9999' })], contextoBase());
        expect(filas[0].numeroFilaExcel).toBe(2);
        expect(filas[1].numeroFilaExcel).toBe(3);
    });
});
