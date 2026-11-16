import { describe, it, expect } from 'vitest';
import { convertirMontoALetras, calcularFiniquitoDatos } from './finiquitoUtils';
import { calcularLiquidacionLaboral } from './liquidacionLaboralUtils';
import type { CalculoEmpleado } from '../services/calculoPlanillaService';
import { round2 } from './calculoPlanillaUtils';

function calc(overrides: Partial<CalculoEmpleado> = {}): CalculoEmpleado {
    return {
        id: 'calc1', tenant_id: 't1', quincena_id: 'q1', empleado_id: 'emp1',
        dias_habiles_quincena: 10, dias_laborados: 10, sueldo_quincenal_base: 238, sueldo_proporcional: 238,
        permisos_sin_goce_monto: 0,
        horas_extras_monto: 20, viaticos_monto: 10, viaticos_bono10_base: 0, vacaciones_monto: 0, vacaciones_bono10_base: 0,
        bonificaciones_monto: 50, otros_ingresos_gravables: 0, otros_ingresos_no_gravables: 0, otros_ingresos_bono10_base: 0,
        incapacidad_bono10_base: 0, total_ingresos_gravables: 238, isss_empleado: 7.14, afp_empleado: 17.255, ipsfa_empleado: 0,
        deduccion_fija_aplicada: 66.66, deduccion_fija_motivo: null, base_renta: 100, renta_isr: 5, base_bono10_total: 0, renta_bono10: 0,
        descuentos_obligatorios_total: 0, descuentos_no_obligatorios_solicitado: 0, descuentos_no_obligatorios_aplicado: 15,
        descuentos_tope_20_base: 0, descuentos_excedente_diferido: 0, descuentos_alerta_tope_superado: false, alerta_neto_bajo_minimo: false,
        descuentos_detalle: [
            { categoria: 'Uniforme', monto: 10, aplicado: 10, diferido: 0 },
            { categoria: 'Categoría inventada', monto: 5, aplicado: 5, diferido: 0 },
        ],
        total_no_gravable: 0, neto_a_pagar: 200, isss_patronal: 8.16, afp_patronal: 19.55, ipsfa_patronal: 0, insaforp_patronal: 2.38,
        config_fiscal_id: 'cfg1', tramos_renta_vigente_desde: '2026-01-01', tipo_quincena: 'normal', calculado_por: null, calculado_at: '2026-06-01',
        ...overrides,
    };
}

const empleado = { nombre_completo: 'Marvin Ernesto García Anaya', fecha_ingreso: '2024-07-31', sueldo_mensual: 476, tipo_afiliacion: 'afp_confia' as const, dui: '02697943-9' };

describe('convertirMontoALetras (IMPL-162 CA5 — "Recibí... la cantidad de X CON XX/100")', () => {
    it('convierte el ejemplo confirmado por Imporfrut', () => {
        expect(convertirMontoALetras(9708.90)).toBe('NUEVE MIL SETECIENTOS OCHO CON 90/100');
    });

    it('cero', () => {
        expect(convertirMontoALetras(0)).toBe('CERO CON 00/100');
    });

    it('unidades simples', () => {
        expect(convertirMontoALetras(1)).toBe('UNO CON 00/100');
        expect(convertirMontoALetras(5.25)).toBe('CINCO CON 25/100');
    });

    it('decenas del 10 al 19 (forma irregular)', () => {
        expect(convertirMontoALetras(15)).toBe('QUINCE CON 00/100');
        expect(convertirMontoALetras(16)).toBe('DIECISÉIS CON 00/100');
    });

    it('veintitantos (forma contraída)', () => {
        expect(convertirMontoALetras(21)).toBe('VEINTIUNO CON 00/100');
        expect(convertirMontoALetras(24)).toBe('VEINTICUATRO CON 00/100');
    });

    it('decenas con "Y" (31-99)', () => {
        expect(convertirMontoALetras(31)).toBe('TREINTA Y UNO CON 00/100');
        expect(convertirMontoALetras(99)).toBe('NOVENTA Y NUEVE CON 00/100');
    });

    it('cien exacto usa "CIEN", no "CIENTO"', () => {
        expect(convertirMontoALetras(100)).toBe('CIEN CON 00/100');
    });

    it('cientos (101-999) usan "CIENTO"', () => {
        expect(convertirMontoALetras(101)).toBe('CIENTO UNO CON 00/100');
        expect(convertirMontoALetras(999)).toBe('NOVECIENTOS NOVENTA Y NUEVE CON 00/100');
    });

    it('mil exacto es "MIL", no "UN MIL"', () => {
        expect(convertirMontoALetras(1000)).toBe('MIL CON 00/100');
    });

    it('miles con apócope "VEINTIÚN MIL" antes de "MIL" (no "veintiuno mil")', () => {
        expect(convertirMontoALetras(21000)).toBe('VEINTIÚN MIL CON 00/100');
    });

    it('miles con "Y UN" antes de "MIL"', () => {
        expect(convertirMontoALetras(31000)).toBe('TREINTA Y UN MIL CON 00/100');
    });

    it('combinación miles + cientos + decenas', () => {
        expect(convertirMontoALetras(135482)).toBe('CIENTO TREINTA Y CINCO MIL CUATROCIENTOS OCHENTA Y DOS CON 00/100');
    });

    it('un millón exacto es "UN MILLÓN", no "UNO MILLÓN"', () => {
        expect(convertirMontoALetras(1000000)).toBe('UN MILLÓN CON 00/100');
    });

    it('millones en plural', () => {
        expect(convertirMontoALetras(2500000)).toBe('DOS MILLONES QUINIENTOS MIL CON 00/100');
    });

    it('redondea centavos con precisión flotante (ej. 0.1 + 0.2 en JS)', () => {
        expect(convertirMontoALetras(10.1)).toBe('DIEZ CON 10/100');
    });
});

describe('calcularFiniquitoDatos (IMPL-162 CA1/CA4 — reusa Liquidación Laboral, IMPL-161, como única fuente de verdad)', () => {
    const ultimoCalculo = calc();
    const liquidacion = calcularLiquidacionLaboral({
        empleado, fechaRetiro: '2026-06-15', tipoRetiro: 'despido', metodoPago: 'transferencia', bancoEmisor: 'Banco X', sectorEconomico: null, ultimoCalculo,
    });

    it('identificación: nombre, DUI PLANO (no dígito por dígito, CA2 revertido), fechas', () => {
        const datos = calcularFiniquitoDatos({ empleado, liquidacion, ultimoCalculo, fechaFirma: '2026-06-20' });
        expect(datos.nombreEmpleado).toBe('Marvin Ernesto García Anaya');
        expect(datos.dui).toBe('02697943-9');
        expect(datos.fechaInicio).toBe('2024-07-31');
        expect(datos.fechaFin).toBe('2026-06-15');
        expect(datos.fechaFirma).toBe('2026-06-20');
    });

    it('DUI ausente usa el placeholder "—", mismo criterio que el resto de reportes', () => {
        const datos = calcularFiniquitoDatos({ empleado: { ...empleado, dui: null }, liquidacion, ultimoCalculo });
        expect(datos.dui).toBe('—');
    });

    it('Indemnización, Vacaciones Completas y Aguinaldo Completo quedan PENDIENTE DE DEFINIR — nunca un $0 silencioso', () => {
        const datos = calcularFiniquitoDatos({ empleado, liquidacion, ultimoCalculo });
        expect(datos.indemnizacion.estado).toBe('pendiente_definir');
        expect(datos.vacacionesCompletas.estado).toBe('pendiente_definir');
        expect(datos.aguinaldoCompleto.estado).toBe('pendiente_definir');
    });

    it('Vacaciones Completas y Aguinaldo Completo documentan que la pregunta ya se envió a Imporfrut', () => {
        const datos = calcularFiniquitoDatos({ empleado, liquidacion, ultimoCalculo });
        if (datos.vacacionesCompletas.estado === 'pendiente_definir') expect(datos.vacacionesCompletas.motivo).toMatch(/enviada a Imporfrut/i);
        if (datos.aguinaldoCompleto.estado === 'pendiente_definir') expect(datos.aguinaldoCompleto.motivo).toMatch(/enviada a Imporfrut/i);
    });

    it('Vacación/Aguinaldo Proporcional vienen EXACTOS de Liquidación Laboral, no se recalculan', () => {
        const datos = calcularFiniquitoDatos({ empleado, liquidacion, ultimoCalculo });
        expect(datos.vacacionProporcional).toBe(liquidacion.vacacionProporcional);
        expect(datos.aguinaldoProporcional).toBe(liquidacion.aguinaldoProporcional);
    });

    it('Sueldo/Horas Extras/Viáticos pendientes vienen de Liquidación Laboral; Bonificación viene directo del último cálculo', () => {
        const datos = calcularFiniquitoDatos({ empleado, liquidacion, ultimoCalculo });
        expect(datos.sueldoPendiente).toBe(238);
        expect(datos.horasExtrasPendientes).toBe(20);
        expect(datos.viaticosPendientes).toBe(10);
        expect(datos.bonificacion).toBe(50);
    });

    it('Ingresos Afectos a ISSS/AFP y Gravados Renta son las bases ya persistidas del último cálculo, no un nuevo impuesto sobre el finiquito', () => {
        const datos = calcularFiniquitoDatos({ empleado, liquidacion, ultimoCalculo });
        expect(datos.ingresosAfectosIsssAfp).toBe(238); // total_ingresos_gravables
        expect(datos.ingresosGravadosRenta).toBe(100); // base_renta
    });

    it('Ingresos Totales = suma de todo lo conocido, SIN Indemnización/Completas (que son pendientes)', () => {
        const datos = calcularFiniquitoDatos({ empleado, liquidacion, ultimoCalculo });
        const esperado = round2(238 + 20 + 10 + 50 + liquidacion.vacacionProporcional + liquidacion.aguinaldoProporcional);
        expect(datos.ingresosTotales).toBe(esperado);
    });

    it('Detalle de Descuentos: ISSS/AFP/Renta vienen del último cálculo; Calzado y Anticipo Vacaciones/Aguinaldo son $0 reales cuando no hay descuento de esa categoría (CONFIRMADO por Imporfrut 2026-09-21, ya no pendientes)', () => {
        const datos = calcularFiniquitoDatos({ empleado, liquidacion, ultimoCalculo });
        expect(datos.detalleDescuentos.isss).toBe(7.14);
        expect(datos.detalleDescuentos.afp).toBe(17.255);
        expect(datos.detalleDescuentos.renta).toBe(5);
        expect(datos.detalleDescuentos.calzado).toBe(0);
        expect(datos.detalleDescuentos.anticipoVacacionesAguinaldo).toBe(0);
    });

    it('Otros Descuentos: lo de descuentos_detalle que NO es Calzado ni Anticipo V&A cae acá (Uniforme, categorías inventadas, etc.)', () => {
        const datos = calcularFiniquitoDatos({ empleado, liquidacion, ultimoCalculo });
        expect(datos.detalleDescuentos.otrosDescuentos).toBe(15); // 10 (Uniforme) + 5 (Categoría inventada)
    });

    it('Calzado y Anticipo V&A se extraen por categoría exacta y se excluyen de Otros Descuentos (no se cuentan dos veces)', () => {
        const conCalzadoYAnticipo = calc({
            descuentos_detalle: [
                { categoria: 'Uniforme', monto: 10, aplicado: 10, diferido: 0 },
                { categoria: 'Calzado', monto: 20, aplicado: 20, diferido: 0 },
                { categoria: 'anticipo de vacaciones y aguinaldo', monto: 30, aplicado: 30, diferido: 0 }, // minúsculas — debe matchear igual
                { categoria: 'Calzado y Uniformes', monto: 99, aplicado: 99, diferido: 0 }, // categoría combinada vieja — NO debe mezclarse con "Calzado"
            ],
        });
        const liquidacionConCalzado = calcularLiquidacionLaboral({
            empleado, fechaRetiro: '2026-06-15', tipoRetiro: 'despido', metodoPago: 'transferencia', bancoEmisor: 'Banco X', sectorEconomico: null, ultimoCalculo: conCalzadoYAnticipo,
        });
        const datos = calcularFiniquitoDatos({ empleado, liquidacion: liquidacionConCalzado, ultimoCalculo: conCalzadoYAnticipo });
        expect(datos.detalleDescuentos.calzado).toBe(20);
        expect(datos.detalleDescuentos.anticipoVacacionesAguinaldo).toBe(30);
        expect(datos.detalleDescuentos.otrosDescuentos).toBe(109); // 10 (Uniforme) + 99 (Calzado y Uniformes) — NO incluye los 20+30 ya separados
    });

    it('Total Descuentos = ISSS + AFP + Renta + Calzado + Anticipo V&A + Otros Descuentos', () => {
        const datos = calcularFiniquitoDatos({ empleado, liquidacion, ultimoCalculo });
        expect(datos.totalDescuentos).toBe(round2(7.14 + 17.255 + 5 + 0 + 0 + 15));
    });

    it('Total a Pagar parcial = Ingresos Totales − Total Descuentos, y el monto en letras corresponde a ese total', () => {
        const datos = calcularFiniquitoDatos({ empleado, liquidacion, ultimoCalculo });
        expect(datos.totalAPagarParcial).toBe(round2(datos.ingresosTotales - datos.totalDescuentos));
        expect(datos.montoEnLetras).toBe(convertirMontoALetras(datos.totalAPagarParcial));
    });

    it('sin último cálculo (empleado se retira sin ningún cálculo procesado): todo lo derivado de ahí queda en 0, no revienta', () => {
        const liquidacionSinCalculo = calcularLiquidacionLaboral({
            empleado, fechaRetiro: '2026-06-15', tipoRetiro: 'despido', metodoPago: 'transferencia', bancoEmisor: 'Banco X', sectorEconomico: null, ultimoCalculo: null,
        });
        const datos = calcularFiniquitoDatos({ empleado, liquidacion: liquidacionSinCalculo, ultimoCalculo: null });
        expect(datos.sueldoPendiente).toBe(0);
        expect(datos.bonificacion).toBe(0);
        expect(datos.detalleDescuentos.otrosDescuentos).toBe(0);
    });

    it('fechaFirma por defecto usa hoy si no se pasa explícita', () => {
        const datos = calcularFiniquitoDatos({ empleado, liquidacion, ultimoCalculo, ahora: new Date('2026-06-25T00:00:00') });
        expect(datos.fechaFirma).toBe('2026-06-25');
    });
});
