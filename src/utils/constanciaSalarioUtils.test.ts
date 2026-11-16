import { describe, it, expect } from 'vitest';
import {
    seleccionarQuincenasElegibles, calcularConstanciaSalarioDatos,
    construirFilasIngresosConstanciaSalario, construirFilasDeduccionesConstanciaSalario,
    type ConstanciaSalarioDatos,
} from './constanciaSalarioUtils';
import type { Quincena, EstadoQuincena } from '../services/quincenasService';
import type { CalculoEmpleado } from '../services/calculoPlanillaService';
import type { Descuento } from '../services/descuentosService';
import type { DescuentoCategoria } from '../services/descuentoCategoriasService';
import type { ConfigFiscal, TramoRenta } from './calculoPlanillaUtils';

function q(id: string, fechaInicio: string, tipo: Quincena['tipo'] = 'normal', estado: EstadoQuincena = 'aprobada_cerrada', esPrueba = false): Quincena {
    return {
        id, tenant_id: 't1', tipo, nombre: `Q ${id}`, etiqueta_estandar: id,
        fecha_inicio: fechaInicio, fecha_fin: fechaInicio, dias_habiles: 10, estado,
        created_by: null, created_at: fechaInicio, deleted_at: null,
        enviada_por: null, enviada_at: null, aprobada_por: null, aprobada_at: null, aprobada_comentario: null,
        rechazada_por: null, rechazada_at: null, rechazo_motivo: null, reabierta_por: null, reabierta_at: null, reapertura_motivo: null,
        es_prueba: esPrueba,
    };
}

function calc(quincenaId: string, overrides: Partial<CalculoEmpleado> = {}): CalculoEmpleado {
    return {
        id: `calc-${quincenaId}`, tenant_id: 't1', quincena_id: quincenaId, empleado_id: 'emp1',
        dias_habiles_quincena: 10, dias_laborados: 10, sueldo_quincenal_base: 238, sueldo_proporcional: 238,
        permisos_sin_goce_monto: 0,
        horas_extras_monto: 0, viaticos_monto: 0, viaticos_bono10_base: 0, vacaciones_monto: 0, vacaciones_bono10_base: 0,
        bonificaciones_monto: 0, otros_ingresos_gravables: 0, otros_ingresos_no_gravables: 0, otros_ingresos_bono10_base: 0,
        incapacidad_bono10_base: 0, total_ingresos_gravables: 238, isss_empleado: 7.14, afp_empleado: 17.255, ipsfa_empleado: 0,
        deduccion_fija_aplicada: 66.66, deduccion_fija_motivo: null, base_renta: 0, renta_isr: 0, base_bono10_total: 0, renta_bono10: 0,
        descuentos_obligatorios_total: 0, descuentos_no_obligatorios_solicitado: 0, descuentos_no_obligatorios_aplicado: 0,
        descuentos_tope_20_base: 0, descuentos_excedente_diferido: 0, descuentos_alerta_tope_superado: false, alerta_neto_bajo_minimo: false,
        descuentos_detalle: [], total_no_gravable: 0, neto_a_pagar: 200, isss_patronal: 0, afp_patronal: 0, ipsfa_patronal: 0, insaforp_patronal: 0,
        config_fiscal_id: 'cfg1', tramos_renta_vigente_desde: '2026-01-01', tipo_quincena: 'normal', calculado_por: null, calculado_at: quincenaId,
        ...overrides,
    };
}

function descuento(overrides: Partial<Descuento> = {}): Descuento {
    return {
        id: 'd1', tenant_id: 't1', empleado_id: 'emp1', categoria_id: 'cat-banco', codigo: 'DF-001',
        institucion: 'Banco Cuscatlán', monto_quincenal: 50, monto_total: 500, numero_cuotas: 10,
        monto_pagado: 100, cuotas_pagadas: 2, fecha_fin: null, estado: 'activo', validado_at: null,
        created_by: null, created_at: '', updated_at: '',
        ...overrides,
    };
}

function categoria(id: string, nombre: string): DescuentoCategoria {
    return { id, tenant_id: 't1', nombre, tipo: 'variable', activo: true, created_at: '', updated_at: '' };
}

const CATEGORIAS_FIXTURE: DescuentoCategoria[] = [
    categoria('cat-banco', 'Préstamo bancario'),
    categoria('cat-vivienda', 'Vivienda'),
];

/** Tasas/topes reales del seed (`20260817090000_create_planilla_config_fiscal.sql`) — ISSS 3%
 * tope $500 quincenal, AFP 7.25% sin tope. */
const CONFIG_FISCAL_FIXTURE: ConfigFiscal = {
    isssTasaEmpleado: 0.03,
    isssTopeBase: 500,
    afpTasaEmpleado: 0.0725,
    afpTopeBase: null,
    deduccionFijaAnual: 1600,
    deduccionFijaTopeIngresoAnual: 8000,
    bono10Tasa: 0.10,
    topeDescuentosNoObligatoriosPct: 0.20,
    salarioMinimoInembargable: null,
};

/** Tramos quincenales reales de la BD — Tramo II ya corregido (IMPL-188): exceso_sobre $275.00,
 * confirmado por el Decreto Ejecutivo No. 10/2025 (Diario Oficial, Ministerio de Hacienda) y por
 * el archivo de cálculo real que Imporfrut compartió. Ninguno de los tests de este archivo
 * ejercita directamente el Tramo II (los casos reales usados acá caen en Tramo III), así que este
 * fix no cambia ningún valor esperado existente. */
const TRAMOS_RENTA_FIXTURE: TramoRenta[] = [
    { orden: 1, desde: 0.01, hasta: 275.00, tasaPct: 0, excesoSobre: 0, montoFijo: 0 },
    { orden: 2, desde: 275.01, hasta: 447.62, tasaPct: 0.10, excesoSobre: 275.00, montoFijo: 8.83 },
    { orden: 3, desde: 447.63, hasta: 1019.05, tasaPct: 0.20, excesoSobre: 447.62, montoFijo: 30.00 },
    { orden: 4, desde: 1019.06, hasta: null, tasaPct: 0.30, excesoSobre: 1019.05, montoFijo: 144.28 },
];

describe('seleccionarQuincenasElegibles (IMPL-182/187)', () => {
    const fechaIngreso = '2026-01-01';

    it('excluye quincenas de aguinaldo/quincena_25 y ordena desc, tomando las 12 más recientes', () => {
        const quincenas: Quincena[] = [
            q('q1', '2026-01-01'), q('q2', '2026-01-15'), q('agu', '2026-12-12', 'aguinaldo'),
            q('q3', '2026-02-01'), q('q25', '2026-02-25', 'quincena_25'),
        ];
        const ventana = seleccionarQuincenasElegibles(quincenas, fechaIngreso);
        expect(ventana.map((v) => v.id)).toEqual(['q3', 'q2', 'q1']);
    });

    it('recorta a las 12 más recientes cuando hay más quincenas normales', () => {
        const quincenas: Quincena[] = Array.from({ length: 15 }, (_, i) => q(`q${i}`, `2026-01-${String(i + 1).padStart(2, '0')}`));
        expect(seleccionarQuincenasElegibles(quincenas, fechaIngreso)).toHaveLength(12);
    });

    it('excluye una quincena en_proceso y una anterior a la fecha de ingreso del empleado', () => {
        const quincenas: Quincena[] = [
            q('clon2025', '2025-07-01'), // anterior a fecha_ingreso (2026-01-01)
            q('jul1', '2026-07-01'),
            q('sep1', '2026-09-01', 'normal', 'en_proceso'), // todavía puede cambiar
        ];
        const elegibles = seleccionarQuincenasElegibles(quincenas, fechaIngreso);
        expect(elegibles.map((v) => v.id)).toEqual(['jul1']);
    });

    it('excluye una quincena marcada es_prueba aunque cumpla fecha/estado (IMPL-187)', () => {
        const quincenas: Quincena[] = [
            q('clon2025', '2025-07-01', 'normal', 'aprobada_cerrada', true), // clon de datos de prueba, IMPL-169
            q('jul1', '2026-07-01'),
        ];
        // fecha_ingreso anterior al clon, para aislar que lo excluido es por es_prueba, no por fecha.
        const elegibles = seleccionarQuincenasElegibles(quincenas, '2025-01-01');
        expect(elegibles.map((v) => v.id)).toEqual(['jul1']);
    });
});

describe('calcularConstanciaSalarioDatos', () => {
    const empleado = { nombre_completo: 'Marvin García', cargo: 'Auxiliar', fecha_ingreso: '2025-01-01', sueldo_mensual: 476, retencion_especial_viatico: false };

    it('divide el promedio por los meses realmente encontrados, no siempre por 6 (empleado nuevo)', () => {
        const calculos = [calc('q1', { bonificaciones_monto: 20 }), calc('q2', { bonificaciones_monto: 30 })];
        const datos = calcularConstanciaSalarioDatos(empleado, calculos, [], [], CONFIG_FISCAL_FIXTURE, TRAMOS_RENTA_FIXTURE);
        // 2 quincenas encontradas = 1 mes -> promedio = (20+30)/1 = 50, no /6
        expect(datos.bonificacionPromedio).toBe(50);
    });

    it('IMPL-186 CA1/CA2: promedia TODO viaticos_monto sobre la ventana, sin distinguir fijo/variable (caso Hernán del ticket)', () => {
        // 3 quincenas encontradas = 1.5 meses; fijo quincenal ($89, $0, $45 — un mes sin registro)
        const calculos = [calc('q3', { viaticos_monto: 89 }), calc('q2', { viaticos_monto: 0 }), calc('q1', { viaticos_monto: 45 })];
        const datos = calcularConstanciaSalarioDatos(empleado, calculos, [], [], CONFIG_FISCAL_FIXTURE, TRAMOS_RENTA_FIXTURE);
        expect(datos.viaticos).toBeCloseTo((89 + 0 + 45) / 1.5, 2); // 89.33
    });

    it('IMPL-186 CA3: caso Rina — fijo registrado una vez al mes (no por quincena) da el mismo resultado que promediar directo', () => {
        // 4 quincenas encontradas = 2 meses; fijo mensual de $125 registrado en 1 de cada 2 quincenas
        const calculos = [
            calc('q4', { viaticos_monto: 0 }), calc('q3', { viaticos_monto: 125 }),
            calc('q2', { viaticos_monto: 0 }), calc('q1', { viaticos_monto: 125 }),
        ];
        const datos = calcularConstanciaSalarioDatos(empleado, calculos, [], [], CONFIG_FISCAL_FIXTURE, TRAMOS_RENTA_FIXTURE);
        expect(datos.viaticos).toBeCloseTo(125, 2); // (0+125+0+125)/2
    });

    it('isrBonificacion sigue siendo la suma real de las 2 quincenas más recientes cuando el empleado NO tiene retención especial de viático', () => {
        // calculosEnVentana debe venir ya ordenado por el hook que llama a esta función — más
        // reciente primero, para que slice(0,2) tome las 2 correctas.
        const calculos = [calc('q3', { renta_bono10: 4 }), calc('q2', { renta_bono10: 2 }), calc('q1', { renta_bono10: 1 })];
        const datos = calcularConstanciaSalarioDatos(empleado, calculos, [], [], CONFIG_FISCAL_FIXTURE, TRAMOS_RENTA_FIXTURE);
        expect(datos.isrBonificacion).toBe(6); // q3(4) + q2(2), no q1
    });

    it('IMPL-184: ISSS/AFP/Renta se recalculan teóricamente sobre los ingresos gravables mostrados (caso Hernán Osorio del ticket)', () => {
        const empleadoCaso = { nombre_completo: 'Hernán Osorio', cargo: 'Operario', fecha_ingreso: '2026-01-02', sueldo_mensual: 1000, retencion_especial_viatico: false };
        const calculos = [calc('q1', { horas_extras_monto: 16.67 })];
        const datos = calcularConstanciaSalarioDatos(empleadoCaso, calculos, [], [], CONFIG_FISCAL_FIXTURE, TRAMOS_RENTA_FIXTURE);
        // base gravable mensual mostrada = 1000 + 16.67 = 1016.67
        expect(datos.isss).toBeCloseTo(30.00, 2);
        expect(datos.afp).toBeCloseTo(73.71, 2);
        // base_renta = 1016.67 - 30 - 73.71 = 912.96; quincenal = 456.48 -> tramo III: 30 + 0.20*(456.48-447.62) = 31.77; x2 = 63.54
        expect(datos.isrSueldo).toBeCloseTo(63.54, 2);
    });

    it('IMPL-184 CA7/CA9: con retención especial de viático, isrViaticos = 10% x viático FIJO (caso Rina del ticket, 100% fijo — viaticos_bono10_base = viaticos_monto)', () => {
        const empleadoRina = { nombre_completo: 'Rina Manzo', cargo: 'Operaria', fecha_ingreso: '2026-01-01', sueldo_mensual: 500, retencion_especial_viatico: true };
        const calculos = [
            calc('q4', { viaticos_monto: 0, viaticos_bono10_base: 0 }), calc('q3', { viaticos_monto: 125, viaticos_bono10_base: 125 }),
            calc('q2', { viaticos_monto: 0, viaticos_bono10_base: 0 }), calc('q1', { viaticos_monto: 125, viaticos_bono10_base: 125 }),
        ];
        const datos = calcularConstanciaSalarioDatos(empleadoRina, calculos, [], [], CONFIG_FISCAL_FIXTURE, TRAMOS_RENTA_FIXTURE);
        expect(datos.viaticos).toBeCloseTo(125, 2);
        expect(datos.isrViaticos).toBeCloseTo(12.50, 2);
    });

    it('corregido 2026-10-20 (confirmado por Imporfrut): el 10% aplica SOLO al viático fijo de gerencia, nunca al variable — un empleado con $125 fijo + $75 variable paga 10% de $125, no de $200', () => {
        const empleadoGerencia = { nombre_completo: 'Gerente de Ejemplo', cargo: 'Gerente', fecha_ingreso: '2026-01-01', sueldo_mensual: 1000, retencion_especial_viatico: true };
        const calculos = [calc('q1', { viaticos_monto: 200, viaticos_bono10_base: 125 })];
        const datos = calcularConstanciaSalarioDatos(empleadoGerencia, calculos, [], [], CONFIG_FISCAL_FIXTURE, TRAMOS_RENTA_FIXTURE);
        expect(datos.viaticos).toBeCloseTo(200, 2); // Ingresos sigue mostrando el total (fijo + variable)
        expect(datos.isrViaticos).toBeCloseTo(12.50, 2); // pero la retención es 10% x 125 (fijo), no x 200
    });

    it('IMPL-184 CA8: sin retención especial de viático, isrViaticos queda en 0', () => {
        const datos = calcularConstanciaSalarioDatos(empleado, [calc('q1', { viaticos_monto: 100 })], [], [], CONFIG_FISCAL_FIXTURE, TRAMOS_RENTA_FIXTURE);
        expect(datos.isrViaticos).toBe(0);
    });

    it('IMPL-184: isrViaticos reemplaza a isrBonificacion cuando hay retención especial, para no duplicar la misma plata (viaticos_bono10 ya integra renta_bono10 en el motor real)', () => {
        const empleadoRetencion = { ...empleado, retencion_especial_viatico: true };
        const calculos = [calc('q2', { viaticos_monto: 100, viaticos_bono10_base: 100, renta_bono10: 10 }), calc('q1', { viaticos_monto: 100, viaticos_bono10_base: 100, renta_bono10: 10 })];
        const datos = calcularConstanciaSalarioDatos(empleadoRetencion, calculos, [], [], CONFIG_FISCAL_FIXTURE, TRAMOS_RENTA_FIXTURE);
        expect(datos.isrBonificacion).toBe(0);
        expect(datos.isrViaticos).toBeGreaterThan(0);
    });

    it('IMPL-185: solo descuentos activos entran, uno por institución, cancelados quedan afuera', () => {
        const calculos = [calc('q1')];
        const descuentosEmpleado = [
            descuento({ id: 'activo1', categoria_id: 'cat-banco', institucion: 'Banco Cuscatlán', monto_quincenal: 50, estado: 'activo' }),
            descuento({ id: 'cancelado1', categoria_id: 'cat-banco', institucion: 'Banco Agrícola', monto_quincenal: 100, estado: 'cancelado' }),
            descuento({ id: 'vivienda1', categoria_id: 'cat-vivienda', institucion: 'FSV', monto_quincenal: 20, estado: 'activo' }),
        ];
        const datos = calcularConstanciaSalarioDatos(empleado, calculos, descuentosEmpleado, CATEGORIAS_FIXTURE, CONFIG_FISCAL_FIXTURE, TRAMOS_RENTA_FIXTURE);
        expect(datos.descuentosFinancieros).toEqual([{ institucion: 'Banco Cuscatlán', monto: 100 }]); // 50 x 2, el cancelado no aparece
        expect(datos.descuentosVivienda).toEqual([{ institucion: 'FSV', monto: 40 }]); // 20 x 2
    });
});

function datosBase(overrides: Partial<ConstanciaSalarioDatos> = {}): ConstanciaSalarioDatos {
    return {
        nombreCompleto: 'Marvin García', cargo: 'Auxiliar', fechaIngreso: '2025-01-01',
        sueldoBase: 1000, bonificacionPromedio: 0, horasExtrasPromedio: 0, viaticos: 0, totalIngresos: 1000,
        isss: 30, afp: 73.71,
        descuentosFinancieros: [], isrSueldo: 63.54, isrViaticos: 0, isrBonificacion: 0,
        descuentosVivienda: [],
        totalDeducciones: 166.71,
        ...overrides,
    };
}

describe('construirFilasIngresosConstanciaSalario (IMPL-183)', () => {
    it('arma las 4 filas de ingresos con los montos del DTO', () => {
        const filas = construirFilasIngresosConstanciaSalario(datosBase({ sueldoBase: 500, bonificacionPromedio: 10, horasExtrasPromedio: 20, viaticos: 30 }));
        expect(filas).toEqual([
            { concepto: 'Sueldo base', monto: 500 },
            { concepto: 'Bonificación promedio', monto: 10 },
            { concepto: 'Horas extras promedio', monto: 20 },
            { concepto: 'Viáticos', monto: 30 },
        ]);
    });
});

describe('construirFilasDeduccionesConstanciaSalario (IMPL-183)', () => {
    it('nunca imprime los placeholders hardcodeados, aunque el monto sea > 0 sin institución resuelta', () => {
        const filas = construirFilasDeduccionesConstanciaSalario(datosBase({ descuentosFinancieros: [{ institucion: '', monto: 100 }] }));
        const conceptos = filas.map((f) => f.concepto);
        expect(conceptos.join(' ')).not.toContain('(Nombre del Banco)');
        expect(conceptos.join(' ')).not.toContain('(Nombre de la Institución)');
        expect(conceptos).toContain('Descuento bancario');
    });

    it('muestra el nombre real de la institución cuando sí se resuelve', () => {
        const filas = construirFilasDeduccionesConstanciaSalario(datosBase({ descuentosFinancieros: [{ institucion: 'Banco Cuscatlán', monto: 100 }] }));
        expect(filas.map((f) => f.concepto)).toContain('Descuento bancario: Banco Cuscatlán');
    });

    it('un renglón por institución cuando hay varias en la misma categoría (IMPL-183 CA3)', () => {
        const filas = construirFilasDeduccionesConstanciaSalario(datosBase({
            descuentosFinancieros: [
                { institucion: 'Banco Cuscatlán', monto: 100 },
                { institucion: 'Financiera Calpiá', monto: 40 },
            ],
        }));
        const conceptos = filas.map((f) => f.concepto);
        expect(conceptos).toContain('Descuento bancario: Banco Cuscatlán');
        expect(conceptos).toContain('Descuento bancario: Financiera Calpiá');
    });

    it('oculta bancario/vivienda/Renta-Bonificación en $0.00, pero siempre imprime ISSS/AFP/Renta-Sueldo', () => {
        const filas = construirFilasDeduccionesConstanciaSalario(datosBase());
        const conceptos = filas.map((f) => f.concepto);
        expect(conceptos).toEqual([
            'Instituto Salvadoreño del Seguro Social (ISSS)',
            'Administradora de Fondos de Pensiones (AFP)',
            'Impuesto sobre la Renta – Sueldo',
        ]);
    });

    it('IMPL-184 CA10: ISR de viáticos tiene etiqueta propia, no reutiliza la de Bonificación', () => {
        const filas = construirFilasDeduccionesConstanciaSalario(datosBase({ isrViaticos: 12.50 }));
        expect(filas.map((f) => f.concepto)).toContain('Impuesto sobre la Renta – Viáticos (retención 10%)');
    });
});
