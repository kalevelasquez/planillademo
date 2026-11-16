import { describe, it, expect } from 'vitest';
import { mapAfpColumna, clasificarDescuentoRecibo, calcularHorasExtrasDesglose, resolverSueldoVigenteEnFecha } from './reciboSueldoUtils';
import type { HorasExtrasManualRow } from '../services/horasExtrasManualService';
import type { EdicionSueldo } from './reciboSueldoUtils';

describe('mapAfpColumna', () => {
    it('mapea cada tipo de afiliación a su columna', () => {
        expect(mapAfpColumna('afp_confia')).toBe('confia');
        expect(mapAfpColumna('afp_crecer')).toBe('crecer');
        expect(mapAfpColumna('ipsfa')).toBe('ipsfa');
        expect(mapAfpColumna('upiss')).toBe('upiss');
    });

    it('jubilado y null no tienen columna propia (afp_empleado ya es 0)', () => {
        expect(mapAfpColumna('jubilado')).toBeNull();
        expect(mapAfpColumna(null)).toBeNull();
    });
});

describe('clasificarDescuentoRecibo', () => {
    it('Préstamo bancario, Financiera y Vehículo van todos a FINANCIERAS', () => {
        expect(clasificarDescuentoRecibo('Préstamo bancario', 'Banco Promerica')).toBe('financieras');
        expect(clasificarDescuentoRecibo('Financiera', null)).toBe('financieras');
        expect(clasificarDescuentoRecibo('Vehículo', null)).toBe('financieras');
    });

    it('Vivienda se separa en FSV/HABITAT según la institución', () => {
        expect(clasificarDescuentoRecibo('Vivienda', 'Fondo Social para la Vivienda')).toBe('fsv');
        expect(clasificarDescuentoRecibo('Vivienda', 'Habitad para la Humanidad')).toBe('habitat');
    });

    it('Vivienda sin institución reconocida no tiene fila propia', () => {
        expect(clasificarDescuentoRecibo('Vivienda', null)).toBeNull();
        expect(clasificarDescuentoRecibo('Vivienda', 'Cooperativa X')).toBeNull();
    });

    it('el literal exacto de anticipo mapea a ANTICIPO DE SALARIO', () => {
        expect(clasificarDescuentoRecibo('Anticipo de salario', null)).toBe('anticipo');
    });

    it('Lentes, Factura de producto y Uniforme mapean directo', () => {
        expect(clasificarDescuentoRecibo('Lentes', null)).toBe('lentes');
        expect(clasificarDescuentoRecibo('Factura de producto', null)).toBe('factura');
        expect(clasificarDescuentoRecibo('Descuento compra producto', null)).toBe('factura');
        expect(clasificarDescuentoRecibo('Uniforme', null)).toBe('uniforme');
        expect(clasificarDescuentoRecibo('Calzado y Uniformes', null)).toBe('uniforme');
    });

    it('categorías sin fila propia en el formato real devuelven null (sin perder el monto del total)', () => {
        expect(clasificarDescuentoRecibo('Faltante de caja', null)).toBeNull();
        expect(clasificarDescuentoRecibo('Permiso sin goce', null)).toBeNull();
        expect(clasificarDescuentoRecibo('Procuraduría', null)).toBeNull();
        expect(clasificarDescuentoRecibo('Categoría inventada', null)).toBeNull();
    });
});

describe('resolverSueldoVigenteEnFecha', () => {
    it('sin ediciones registradas, devuelve el sueldo actual tal cual', () => {
        expect(resolverSueldoVigenteEnFecha(500, [], '2026-08-15')).toBe(500);
    });

    it('la edición ocurrió DESPUÉS de la quincena — el vigente en esa fecha es el sueldo ANTERIOR, no el actual', () => {
        const ediciones: EdicionSueldo[] = [
            { created_at: '2026-09-01T10:00:00.000Z', anterior: 400, nuevo: 500 },
        ];
        // El "sueldo actual" (500) es irrelevante acá: la quincena cerró antes del aumento.
        expect(resolverSueldoVigenteEnFecha(500, ediciones, '2026-08-15')).toBe(400);
    });

    it('la edición ocurrió ANTES de la quincena — el vigente ya es el sueldo nuevo', () => {
        const ediciones: EdicionSueldo[] = [
            { created_at: '2026-07-01T10:00:00.000Z', anterior: 400, nuevo: 500 },
        ];
        expect(resolverSueldoVigenteEnFecha(500, ediciones, '2026-08-15')).toBe(500);
    });

    it('una edición registrada el MISMO día que la fecha de referencia ya cuenta como vigente', () => {
        const ediciones: EdicionSueldo[] = [
            { created_at: '2026-08-15T08:00:00.000Z', anterior: 400, nuevo: 500 },
        ];
        expect(resolverSueldoVigenteEnFecha(500, ediciones, '2026-08-15')).toBe(500);
    });

    it('con varias ediciones, elige la vigente en la fecha exacta (no la más reciente de todas)', () => {
        const ediciones: EdicionSueldo[] = [
            { created_at: '2026-01-01T00:00:00.000Z', anterior: 300, nuevo: 400 },
            { created_at: '2026-06-01T00:00:00.000Z', anterior: 400, nuevo: 450 },
            { created_at: '2026-09-01T00:00:00.000Z', anterior: 450, nuevo: 500 }, // después de la quincena
        ];
        // Quincena cerró en agosto: ya pasó el cambio de junio (450), pero no el de septiembre.
        expect(resolverSueldoVigenteEnFecha(500, ediciones, '2026-08-15')).toBe(450);
    });

    it('la fecha de referencia es ANTERIOR a la primera edición registrada — usa el "anterior" de esa primera edición', () => {
        const ediciones: EdicionSueldo[] = [
            { created_at: '2026-06-01T00:00:00.000Z', anterior: 350, nuevo: 400 },
        ];
        expect(resolverSueldoVigenteEnFecha(400, ediciones, '2026-01-01')).toBe(350);
    });

    it('no le importa el orden en que llegan las ediciones — las ordena internamente por fecha', () => {
        const ediciones: EdicionSueldo[] = [
            { created_at: '2026-09-01T00:00:00.000Z', anterior: 450, nuevo: 500 },
            { created_at: '2026-01-01T00:00:00.000Z', anterior: 300, nuevo: 400 },
            { created_at: '2026-06-01T00:00:00.000Z', anterior: 400, nuevo: 450 },
        ];
        expect(resolverSueldoVigenteEnFecha(500, ediciones, '2026-08-15')).toBe(450);
    });
});

describe('calcularHorasExtrasDesglose', () => {
    const sueldoMensual = 480; // valorHora = 480/240 = 2

    it('suma HED+HEN para la cantidad y aplica tarifas 2.0x para el monto', () => {
        const rows: HorasExtrasManualRow[] = [
            { id: '1', tenant_id: 't1', quincena_id: 'q1', ubicacion_id: 'u1', empleado_id: 'e1', horas_regulares: 0, hed: 3, hen: 2, nocturnidad: 0, feriado: 0, monto_total: 0, guardado_por: null, guardado_at: null },
        ];
        const d = calcularHorasExtrasDesglose(rows, sueldoMensual);
        expect(d.horasExtrasCantidad).toBe(5);
        expect(d.horasExtrasMonto).toBe((3 * 2.0 + 2 * 2.0) * 2); // 20
    });

    it('nocturnidad usa tarifa 1.25x, feriado usa 2.0x, HE Feriado siempre es 0', () => {
        const rows: HorasExtrasManualRow[] = [
            { id: '1', tenant_id: 't1', quincena_id: 'q1', ubicacion_id: 'u1', empleado_id: 'e1', horas_regulares: 0, hed: 0, hen: 0, nocturnidad: 4, feriado: 2, monto_total: 0, guardado_por: null, guardado_at: null },
        ];
        const d = calcularHorasExtrasDesglose(rows, sueldoMensual);
        expect(d.nocturnidadMonto).toBe(4 * 1.25 * 2); // 10
        expect(d.feriadoMonto).toBe(2 * 2.0 * 2); // 8
        expect(d.heFeriadoMonto).toBe(0);
    });

    it('sin filas de horas extra, todo el desglose es 0', () => {
        const d = calcularHorasExtrasDesglose([], sueldoMensual);
        expect(d).toEqual({ horasExtrasCantidad: 0, horasExtrasMonto: 0, nocturnidadMonto: 0, feriadoMonto: 0, heFeriadoMonto: 0 });
    });
});
