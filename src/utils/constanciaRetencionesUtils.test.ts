import { describe, it, expect } from 'vitest';
import {
    calcularAnioFiscalAnterior,
    seleccionarQuincenasAnioFiscal,
    calcularConstanciaRetencionesDatos,
} from './constanciaRetencionesUtils';
import type { Quincena } from '../services/quincenasService';
import type { CalculoEmpleado } from '../services/calculoPlanillaService';

function q(id: string, fechaInicio: string, tipo: Quincena['tipo'] = 'normal'): Quincena {
    return {
        id, tenant_id: 't1', tipo, nombre: `Q ${id}`, etiqueta_estandar: id,
        fecha_inicio: fechaInicio, fecha_fin: fechaInicio, dias_habiles: 10, estado: 'aprobada_cerrada',
        created_by: null, created_at: fechaInicio, deleted_at: null,
        enviada_por: null, enviada_at: null, aprobada_por: null, aprobada_at: null, aprobada_comentario: null,
        rechazada_por: null, rechazada_at: null, rechazo_motivo: null, reabierta_por: null, reabierta_at: null, reapertura_motivo: null,
        es_prueba: false,
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

describe('calcularAnioFiscalAnterior', () => {
    it('devuelve el año anterior completo respecto a la fecha de generación (CA4)', () => {
        expect(calcularAnioFiscalAnterior(new Date('2026-08-18T00:00:00'))).toBe(2025);
    });

    it('funciona también cruzando el cambio de año (generado en enero)', () => {
        expect(calcularAnioFiscalAnterior(new Date('2027-01-05T00:00:00'))).toBe(2026);
    });
});

describe('seleccionarQuincenasAnioFiscal', () => {
    it('incluye TODOS los tipos de quincena del año (normal, aguinaldo, quincena_25) — a diferencia de la ventana de 6 meses de Constancia de Salario', () => {
        const quincenas: Quincena[] = [
            q('q1', '2025-01-15'),
            q('q2', '2025-06-30', 'aguinaldo'),
            q('q3', '2025-12-25', 'quincena_25'),
            q('q4', '2026-01-15'), // año siguiente, debe excluirse
            q('q5', '2024-12-31'), // año anterior, debe excluirse
        ];
        const resultado = seleccionarQuincenasAnioFiscal(quincenas, 2025);
        expect(resultado.map((r) => r.id).sort()).toEqual(['q1', 'q2', 'q3']);
    });

    it('devuelve vacío si no hay quincenas en el año fiscal indicado', () => {
        const quincenas: Quincena[] = [q('q1', '2026-01-15')];
        expect(seleccionarQuincenasAnioFiscal(quincenas, 2025)).toEqual([]);
    });
});

describe('calcularConstanciaRetencionesDatos', () => {
    const empleado = { nombre_completo: 'Belarmino Elsides Olivar', dui: '02081954-2' };
    const configEmpresa = { razon_social: 'Importadora de Frutas, S.A. de C.V', nit: '0614-070297-103-7' };

    it('suma Código 11 (ingresos ordinarios gravables + retención ISR de tabla de tramos) a través de todas las quincenas del año', () => {
        const calculos = [
            calc('q1', { total_ingresos_gravables: 400, renta_isr: 40 }),
            calc('q2', { total_ingresos_gravables: 415.95, renta_isr: 41.6 }),
        ];
        const datos = calcularConstanciaRetencionesDatos(empleado, 2025, calculos, configEmpresa);
        expect(datos.ingresosCodigo11).toBe(815.95);
        expect(datos.retencionCodigo11).toBe(81.6);
    });

    it('suma Código 60 (Honorarios y otros ingresos) reutilizando el mecanismo de retención especial Bono 10% (base_bono10_total/renta_bono10) — mismo mecanismo de vacaciones no gozadas/trabajadas (IMPL-70) y viáticos GG (IMPL-91)', () => {
        const calculos = [
            calc('q1', { base_bono10_total: 600, renta_bono10: 60 }),
            calc('q2', { base_bono10_total: 622.91, renta_bono10: 0 }),
        ];
        const datos = calcularConstanciaRetencionesDatos(empleado, 2025, calculos, configEmpresa);
        expect(datos.ingresosCodigo60).toBe(1222.91);
        expect(datos.retencionCodigo60).toBe(60);
    });

    it('suma el desglose de Descuentos (ISSS/AFP) del mismo período (CA3)', () => {
        const calculos = [
            calc('q1', { isss_empleado: 18.5, afp_empleado: 44.5 }),
            calc('q2', { isss_empleado: 18.19, afp_empleado: 44.16 }),
        ];
        const datos = calcularConstanciaRetencionesDatos(empleado, 2025, calculos, configEmpresa);
        expect(datos.isss).toBe(36.69);
        expect(datos.afp).toBe(88.66);
    });

    it('toma razón social y NIT de la Configuración de Empresa (CA5), y usa vacíos si todavía no hay configuración', () => {
        const datosConConfig = calcularConstanciaRetencionesDatos(empleado, 2025, [], configEmpresa);
        expect(datosConConfig.razonSocialEmpresa).toBe('Importadora de Frutas, S.A. de C.V');
        expect(datosConConfig.nitEmpresa).toBe('0614-070297-103-7');

        const datosSinConfig = calcularConstanciaRetencionesDatos(empleado, 2025, [], null);
        expect(datosSinConfig.razonSocialEmpresa).toBe('');
        expect(datosSinConfig.nitEmpresa).toBe('');
    });

    it('usa un placeholder cuando el empleado no tiene DUI cargado', () => {
        const datos = calcularConstanciaRetencionesDatos({ nombre_completo: 'Sin Dui', dui: null }, 2025, [], configEmpresa);
        expect(datos.dui).toBe('—');
    });

    it('deja todo en 0 si el empleado no tiene cálculos en el año fiscal (sin planilla procesada ese año)', () => {
        const datos = calcularConstanciaRetencionesDatos(empleado, 2025, [], configEmpresa);
        expect(datos.ingresosCodigo11).toBe(0);
        expect(datos.retencionCodigo11).toBe(0);
        expect(datos.ingresosCodigo60).toBe(0);
        expect(datos.retencionCodigo60).toBe(0);
        expect(datos.isss).toBe(0);
        expect(datos.afp).toBe(0);
    });

    it('registra el año fiscal cubierto en el DTO para que quede impreso explícitamente (CA4)', () => {
        const datos = calcularConstanciaRetencionesDatos(empleado, 2025, [], configEmpresa);
        expect(datos.anioFiscal).toBe(2025);
    });
});
