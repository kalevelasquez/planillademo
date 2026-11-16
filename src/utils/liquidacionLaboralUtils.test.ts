import { describe, it, expect } from 'vitest';
import {
    calcularPorcentajeIndemnizacionPorRetiro,
    resolverSalarioMinimoDiarioVigente,
    calcularAniosServicioFraccional,
    calcularIndemnizacion,
    calcularDiasPeriodoVacacionActual,
    calcularDiasPeriodoAguinaldoActual,
    calcularAniosAntiguedad,
    calcularDiasAguinaldoSegunAntiguedad,
    calcularVacacionProporcional,
    calcularAguinaldoProporcional,
    calcularQuincena25Proporcional,
    calcularPartidaContableLiquidacion,
    calcularLiquidacionLaboral,
    seleccionarUltimoCalculoAntesDe,
    PROMEDIO_COMISION_6_MESES,
    CUENTAS_LIQUIDACION,
} from './liquidacionLaboralUtils';
import type { CalculoEmpleado } from '../services/calculoPlanillaService';
import type { Quincena } from '../services/quincenasService';
import { round2 } from './calculoPlanillaUtils';

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
        descuentos_detalle: [], total_no_gravable: 0, neto_a_pagar: 200, isss_patronal: 8.16, afp_patronal: 19.55, ipsfa_patronal: 0, insaforp_patronal: 2.38,
        config_fiscal_id: 'cfg1', tramos_renta_vigente_desde: '2026-01-01', tipo_quincena: 'normal', calculado_por: null, calculado_at: quincenaId,
        ...overrides,
    };
}

function q(id: string, fechaInicio: string): Quincena {
    return {
        id, tenant_id: 't1', tipo: 'normal', nombre: `Q ${id}`, etiqueta_estandar: id,
        fecha_inicio: fechaInicio, fecha_fin: fechaInicio, dias_habiles: 10, estado: 'aprobada_cerrada',
        created_by: null, created_at: fechaInicio, deleted_at: null,
        enviada_por: null, enviada_at: null, aprobada_por: null, aprobada_at: null, aprobada_comentario: null,
        rechazada_por: null, rechazada_at: null, rechazo_motivo: null, reabierta_por: null, reabierta_at: null, reapertura_motivo: null,
        es_prueba: false,
    };
}

describe('calcularPorcentajeIndemnizacionPorRetiro (CA2)', () => {
    it('Despido = 100%', () => {
        expect(calcularPorcentajeIndemnizacionPorRetiro('despido')).toBe(100);
    });

    it('Renuncia = 50%', () => {
        expect(calcularPorcentajeIndemnizacionPorRetiro('renuncia')).toBe(50);
    });

    it('Mutuo Acuerdo usa el porcentaje capturado caso por caso, nunca un valor fijo asumido', () => {
        expect(calcularPorcentajeIndemnizacionPorRetiro('mutuo_acuerdo', 75)).toBe(75);
        expect(calcularPorcentajeIndemnizacionPorRetiro('mutuo_acuerdo', 33.5)).toBe(33.5);
    });

    it('Mutuo Acuerdo sin porcentaje capturado lanza error explícito (no asume 0 ni 100)', () => {
        expect(() => calcularPorcentajeIndemnizacionPorRetiro('mutuo_acuerdo')).toThrow();
    });

    it('Mutuo Acuerdo con porcentaje fuera de rango [0,100] lanza error', () => {
        expect(() => calcularPorcentajeIndemnizacionPorRetiro('mutuo_acuerdo', 150)).toThrow();
        expect(() => calcularPorcentajeIndemnizacionPorRetiro('mutuo_acuerdo', -10)).toThrow();
    });
});

describe('resolverSalarioMinimoDiarioVigente — tabla histórica por sector (Decretos Ejecutivos 11/12 de 2025)', () => {
    it('devuelve el salario mínimo diario vigente para cada sector desde jun/2025', () => {
        expect(resolverSalarioMinimoDiarioVigente('comercio_servicios_industria', '2026-06-15')).toBe(13.44);
        expect(resolverSalarioMinimoDiarioVigente('maquila_textil', '2026-06-15')).toBe(13.227);
        expect(resolverSalarioMinimoDiarioVigente('beneficio_cafe_cana', '2026-06-15')).toBe(10.035);
        expect(resolverSalarioMinimoDiarioVigente('agropecuario_pesca', '2026-06-15')).toBe(8.96);
    });

    it('devuelve null si la fecha es anterior a la vigencia del decreto', () => {
        expect(resolverSalarioMinimoDiarioVigente('comercio_servicios_industria', '2025-01-01')).toBeNull();
    });
});

describe('calcularAniosServicioFraccional — años de servicio EN FRACCIÓN (para Indemnización, distinto de calcularAniosAntiguedad)', () => {
    it('reproduce el caso real (684 días / 365 ≈ 1.874 años)', () => {
        expect(calcularAniosServicioFraccional('2024-07-31', '2026-06-15')).toBeCloseTo(684 / 365, 6);
    });

    it('fecha de retiro anterior al ingreso da 0', () => {
        expect(calcularAniosServicioFraccional('2026-06-15', '2024-07-31')).toBe(0);
    });
});

describe('calcularIndemnizacion (CA1) — salario_diario_computable × 30 × años_de_servicio × % retiro', () => {
    it('sin sector económico configurado, devuelve "pendiente_definir" con motivo explícito, SIN campo `monto`', () => {
        const resultado = calcularIndemnizacion(476, null, '2026-06-15', 684 / 365, 'despido');
        expect(resultado.estado).toBe('pendiente_definir');
        if (resultado.estado === 'pendiente_definir') expect(resultado.motivo).toMatch(/sector económico/i);
        expect('monto' in resultado).toBe(false);
    });

    it('conserva el porcentaje según tipo de retiro incluso pendiente, para cuando se configure el sector', () => {
        expect(calcularIndemnizacion(476, null, '2026-06-15', 1, 'renuncia').porcentajeSegunTipoRetiro).toBe(50);
        expect(calcularIndemnizacion(476, null, '2026-06-15', 1, 'mutuo_acuerdo', 40).porcentajeSegunTipoRetiro).toBe(40);
    });

    it('reproduce EXACTO el caso real (Marvin Ernesto García Anaya: sueldo $476, 684 días → $892.01 antes del % de retiro, hoja "Calculo" del Excel de referencia)', () => {
        const resultado = calcularIndemnizacion(476, 'comercio_servicios_industria', '2026-06-15', 684 / 365, 'despido');
        expect(resultado.estado).toBe('confirmado');
        if (resultado.estado === 'confirmado') {
            expect(resultado.monto).toBe(892.01);
            expect(resultado.salarioMinimoDiarioVigente).toBe(13.44);
        }
    });

    it('aplica el tope de 4× salario mínimo diario cuando el sueldo/30 lo supera', () => {
        // Sector comercio_servicios_industria: tope = 4 × 13.44 = 53.76/día. Sueldo $3000/mes → $100/día, muy por encima.
        const resultado = calcularIndemnizacion(3000, 'comercio_servicios_industria', '2026-06-15', 1, 'despido');
        expect(resultado.estado).toBe('confirmado');
        if (resultado.estado === 'confirmado') {
            expect(resultado.salarioDiarioComputable).toBe(53.76);
            expect(resultado.monto).toBe(round2(53.76 * 30 * 1));
        }
    });

    it('aplica el % de Tipo de Retiro sobre el monto ya calculado (Renuncia = 50%)', () => {
        const resultado = calcularIndemnizacion(476, 'comercio_servicios_industria', '2026-06-15', 684 / 365, 'renuncia');
        expect(resultado.estado).toBe('confirmado');
        if (resultado.estado === 'confirmado') expect(resultado.monto).toBe(round2((476 / 30) * 30 * (684 / 365) * 0.5));
    });
});

describe('calcularDiasPeriodoVacacionActual (CA3) — período desde el último aniversario de ingreso', () => {
    it('reproduce el caso real verificado contra 1.3 Liquidación laboral.xlsx (ingreso 31-jul-24, salida 15-jun-26 → 320 días desde 31-jul-25)', () => {
        expect(calcularDiasPeriodoVacacionActual('2024-07-31', '2026-06-15')).toBe(320);
    });

    it('cuenta 1 día cuando la fecha de retiro coincide exactamente con el aniversario', () => {
        expect(calcularDiasPeriodoVacacionActual('2024-07-31', '2025-07-31')).toBe(1);
    });

    it('con menos de 1 año de antigüedad, el período arranca en la fecha de ingreso (no hay aniversario previo todavía)', () => {
        expect(calcularDiasPeriodoVacacionActual('2026-01-01', '2026-03-01')).toBe(60);
    });
});

describe('calcularDiasPeriodoAguinaldoActual (CA4) — Art. 198 CT: año fijo 12-dic a 11-dic, NO el aniversario de ingreso', () => {
    it('reproduce el caso real verificado (12-dic-25 → 15-jun-26 = 186 días), distinto del período de Vacación de la misma persona', () => {
        expect(calcularDiasPeriodoAguinaldoActual('2024-07-31', '2026-06-15')).toBe(186);
    });

    it('si el ingreso fue después del último 12 de diciembre, el período arranca en la fecha de ingreso', () => {
        expect(calcularDiasPeriodoAguinaldoActual('2026-01-15', '2026-03-01')).toBe(46);
    });

    it('el corte es fijo en el calendario, no depende del mes/día de ingreso del empleado', () => {
        // Ingreso un 5 de marzo, muy antiguo — el período de aguinaldo igual arranca el 12-dic anterior.
        const dias = calcularDiasPeriodoAguinaldoActual('2010-03-05', '2026-01-10');
        expect(dias).toBe(30); // 12-dic-2025 → 10-ene-2026 inclusive
    });
});

describe('calcularAniosAntiguedad — antigüedad TOTAL (para el tramo de días de aguinaldo, Art. 198)', () => {
    it('reproduce el caso real (684 días de antigüedad total → 1 año completo)', () => {
        expect(calcularAniosAntiguedad('2024-07-31', '2026-06-15')).toBe(1);
    });

    it('10 años exactos ya califican para el tramo de 21 días (CA4, "diez años o más")', () => {
        expect(calcularAniosAntiguedad('2016-01-01', '2026-01-01')).toBe(10);
    });
});

describe('calcularDiasAguinaldoSegunAntiguedad (CA4, Art. 198 reformado por Decreto 399/2013)', () => {
    it('menos de 3 años (incluye <1 año, plegado al mismo tramo por Art. 197) = 15 días', () => {
        expect(calcularDiasAguinaldoSegunAntiguedad(0)).toBe(15);
        expect(calcularDiasAguinaldoSegunAntiguedad(1)).toBe(15);
        expect(calcularDiasAguinaldoSegunAntiguedad(2)).toBe(15);
    });

    it('3 a menos de 10 años = 19 días', () => {
        expect(calcularDiasAguinaldoSegunAntiguedad(3)).toBe(19);
        expect(calcularDiasAguinaldoSegunAntiguedad(9)).toBe(19);
    });

    it('10 años o más = 21 días (10 exactos ya califican)', () => {
        expect(calcularDiasAguinaldoSegunAntiguedad(10)).toBe(21);
        expect(calcularDiasAguinaldoSegunAntiguedad(25)).toBe(21);
    });
});

describe('calcularVacacionProporcional (CA3) — Salario Diario × 15 × (días/365) × 1.30', () => {
    it('reproduce EXACTO el monto real verificado ($271.25, sueldo mensual $476.00, 320 días)', () => {
        expect(calcularVacacionProporcional(476, 320)).toBe(271.25);
    });

    it('usa el sueldo diario SIN redondear en el paso intermedio — redondear antes (a $15.87) da $271.34, no coincide con el real', () => {
        // Guarda de regresión: si alguien "optimiza" reintroduciendo el redondeo intermedio,
        // este test lo detecta.
        expect(calcularVacacionProporcional(476, 320)).not.toBe(271.34);
    });

    it('cero días de período da $0', () => {
        expect(calcularVacacionProporcional(476, 0)).toBe(0);
    });
});

describe('calcularAguinaldoProporcional (CA4) — Salario Diario × días-según-antigüedad × (días período / 365)', () => {
    it('reproduce EXACTO el monto real verificado ($121.28, sueldo mensual $476.00, 15 días de tabla, 186 días de período)', () => {
        expect(calcularAguinaldoProporcional(476, 15, 186)).toBe(121.28);
    });

    it('cero días de período da $0', () => {
        expect(calcularAguinaldoProporcional(476, 15, 0)).toBe(0);
    });
});

describe('calcularQuincena25Proporcional (IMPL-14, confirmado por Imporfrut 2026-10-19, ampliado a los 3 tipos de retiro 2026-10-20)', () => {
    it('antigüedad >= 365 días, sueldo elegible: cobra el 50% completo ($238 con sueldo $476)', () => {
        expect(calcularQuincena25Proporcional(476, '2024-07-31', '2026-06-15'))
            .toEqual({ estado: 'confirmado', monto: 238, dias: 365, elegible: true });
    });

    it('antigüedad < 365 días: prorratea (ej. 180 días de 476 x 0.5 x 180/365)', () => {
        const resultado = calcularQuincena25Proporcional(476, '2026-01-01', '2026-06-30');
        expect(resultado).toEqual({ estado: 'confirmado', monto: round2(0.5 * 476 * (180 / 365)), dias: 180, elegible: true });
    });

    it('sueldo mensual mayor a $1,500: NO cobra nada — es un gate de elegibilidad, no un tope sobre el monto', () => {
        expect(calcularQuincena25Proporcional(1500.01, '2024-07-31', '2026-06-15'))
            .toEqual({ estado: 'confirmado', monto: 0, dias: 365, elegible: false });
    });

    it('sueldo exactamente $1,500 SÍ es elegible (inclusive, no excluyente)', () => {
        const resultado = calcularQuincena25Proporcional(1500, '2024-07-31', '2026-06-15');
        expect(resultado.elegible).toBe(true);
    });

    it('aplica igual sin importar el motivo de retiro — Imporfrut confirmó "aplica en ambos casos" (2026-10-20), ya no recibe tipoRetiro como parámetro', () => {
        // Mismas fechas que el primer test (despido) — el resultado es idéntico porque la fórmula
        // ya no distingue tipoRetiro, confirmado explícitamente para renuncia/mutuo_acuerdo también.
        expect(calcularQuincena25Proporcional(476, '2024-07-31', '2026-06-15'))
            .toEqual({ estado: 'confirmado', monto: 238, dias: 365, elegible: true });
    });
});

describe('PROMEDIO_COMISION_6_MESES (CA11) — SIEMPRE $0, campo heredado sin cálculo real', () => {
    it('es la constante 0, no una función', () => {
        expect(PROMEDIO_COMISION_6_MESES).toBe(0);
    });
});

describe('CUENTAS_LIQUIDACION (CA10) — catálogo de cuentas confirmado', () => {
    it('coincide exactamente con las cuentas confirmadas del ticket', () => {
        expect(CUENTAS_LIQUIDACION.salarios).toBe('4-42-4203-01-001');
        expect(CUENTAS_LIQUIDACION.horasExtras).toBe('4-42-4203-01-003');
        expect(CUENTAS_LIQUIDACION.vacacionProporcional).toBe('2-21-2104-04-000');
        expect(CUENTAS_LIQUIDACION.viaticos).toBe('4-42-4203-11-002');
        expect(CUENTAS_LIQUIDACION.aguinaldoProporcional).toBe('2-21-2104-05-000');
        expect(CUENTAS_LIQUIDACION.indemnizacion).toBe('2-21-2104-01-000');
        expect(CUENTAS_LIQUIDACION.cuotaPatronalIsss).toBe('4-42-4201-02-001');
        expect(CUENTAS_LIQUIDACION.cuotaPatronalAfp).toBe('4-42-4201-02-002');
        expect(CUENTAS_LIQUIDACION.insaforp).toBe('4-42-4201-02-03');
        expect(CUENTAS_LIQUIDACION.isssRetencionEmpleado).toBe('2-21-2101-03-007');
        expect(CUENTAS_LIQUIDACION.afpRetencionEmpleado).toBe('2-21-2101-03-006');
        expect(CUENTAS_LIQUIDACION.otrosDescuentos).toBe('2-21-211-05');
        expect(CUENTAS_LIQUIDACION.liquidacionPorPagar).toBe('2-21-2101-03-031');
    });
});

describe('calcularPartidaContableLiquidacion (CA10)', () => {
    const base = {
        salariosPendientes: 0,
        horasExtrasPendientes: 0,
        viaticosPendientes: 0,
        vacacionProporcional: 271.25,
        aguinaldoProporcional: 121.28,
        indemnizacion: null,
        isssEmpleado: 8.14,
        afpEmpleado: 19.67,
        isssPatronal: 20.34,
        afpPatronal: 23.73,
        insaforpPatronal: 2.71,
        otrosDescuentos: 0,
        afpLabel: 'AFP Crecer',
    };

    it('incluye la fila de Indemnización con monto null y pendiente:true — nunca $0 disimulado', () => {
        const partida = calcularPartidaContableLiquidacion(base);
        const filaIndemnizacion = partida.debe.find((f) => f.concepto === 'Indemnización');
        expect(filaIndemnizacion?.monto).toBeNull();
        expect(filaIndemnizacion?.pendiente).toBe(true);
        expect(filaIndemnizacion?.cuenta).toBe(CUENTAS_LIQUIDACION.indemnizacion);
    });

    it('el DEBE conocido (sin Indemnización) cuadra contra el HABER conocido + el plug "Liquidación Por Pagar"', () => {
        const partida = calcularPartidaContableLiquidacion(base);
        const sumaHaber = round2(partida.haber.reduce((acc, f) => acc + (f.monto ?? 0), 0));
        expect(sumaHaber).toBe(partida.totalDebeConocido);
    });

    it('cuadraCompleto false mientras Indemnización esté pendiente, con nota explicando por qué NO es un bug', () => {
        const partida = calcularPartidaContableLiquidacion(base);
        expect(partida.cuadraCompleto).toBe(false);
        expect(partida.nota).toMatch(/Indemnización/);
        expect(partida.nota.toLowerCase()).toMatch(/no.*(bug|error)|estado esperado/);
    });

    it('con Indemnización ya calculada, la incluye en el DEBE y cuadraCompleto pasa a true', () => {
        const partida = calcularPartidaContableLiquidacion({ ...base, indemnizacion: 892.01 });
        const filaIndemnizacion = partida.debe.find((f) => f.concepto === 'Indemnización');
        expect(filaIndemnizacion?.monto).toBe(892.01);
        expect(filaIndemnizacion?.pendiente).toBe(false);
        expect(partida.cuadraCompleto).toBe(true);
        expect(partida.nota).toMatch(/cuadra/i);

        const sumaHaber = round2(partida.haber.reduce((acc, f) => acc + (f.monto ?? 0), 0));
        expect(sumaHaber).toBe(partida.totalDebeConocido);
    });

    it('omite la fila "Otros Descuentos" del HABER cuando es 0 (no ensucia el documento con líneas en $0 sin motivo)', () => {
        const partida = calcularPartidaContableLiquidacion({ ...base, otrosDescuentos: 0 });
        expect(partida.haber.find((f) => f.concepto === 'Otros Descuentos')).toBeUndefined();
    });

    it('incluye "Otros Descuentos" del HABER cuando es mayor a 0', () => {
        const partida = calcularPartidaContableLiquidacion({ ...base, otrosDescuentos: 15 });
        expect(partida.haber.find((f) => f.concepto === 'Otros Descuentos')?.monto).toBe(15);
    });

    it('etiqueta la retención de AFP con el label recibido (Crecer/Confía según afiliación, CA10)', () => {
        const partidaCrecer = calcularPartidaContableLiquidacion({ ...base, afpLabel: 'AFP Crecer' });
        expect(partidaCrecer.haber.find((f) => f.cuenta === CUENTAS_LIQUIDACION.afpRetencionEmpleado)?.concepto).toMatch(/Crecer/);

        const partidaConfia = calcularPartidaContableLiquidacion({ ...base, afpLabel: 'AFP Confía' });
        expect(partidaConfia.haber.find((f) => f.cuenta === CUENTAS_LIQUIDACION.afpRetencionEmpleado)?.concepto).toMatch(/Confía/);
    });
});

describe('seleccionarUltimoCalculoAntesDe', () => {
    it('elige el cálculo de la quincena más reciente cuya fecha_inicio es <= fecha de retiro', () => {
        const quincenas = [q('q1', '2026-01-01'), q('q2', '2026-02-01'), q('q3', '2026-07-01')];
        const calculos = [calc('q1'), calc('q2', { neto_a_pagar: 999 })];
        const resultado = seleccionarUltimoCalculoAntesDe(quincenas, calculos, '2026-06-15');
        expect(resultado?.quincena_id).toBe('q2');
        expect(resultado?.neto_a_pagar).toBe(999);
    });

    it('devuelve null si no hay ningún cálculo persistido antes de la fecha de retiro (edge case documentado)', () => {
        const quincenas = [q('q1', '2026-08-01')];
        const calculos: CalculoEmpleado[] = [];
        expect(seleccionarUltimoCalculoAntesDe(quincenas, calculos, '2026-06-15')).toBeNull();
    });
});

describe('calcularLiquidacionLaboral — agregador completo (integración de todos los CA implementados)', () => {
    const empleado = {
        nombre_completo: 'Marvin Ernesto García Anaya',
        fecha_ingreso: '2024-07-31',
        sueldo_mensual: 476,
        tipo_afiliacion: 'afp_crecer' as const,
    };

    it('reproduce el caso real completo (Vacación $271.25, Aguinaldo $121.28) y dispara la Indemnización como pendiente sin sector configurado', () => {
        const resultado = calcularLiquidacionLaboral({
            empleado,
            fechaRetiro: '2026-06-15',
            tipoRetiro: 'despido',
            metodoPago: 'transferencia',
            bancoEmisor: 'Banco Agrícola',
            sectorEconomico: null,
            ultimoCalculo: null,
            ahora: new Date('2026-08-22T00:00:00'),
        });

        expect(resultado.vacacionProporcional).toBe(271.25);
        expect(resultado.aguinaldoProporcional).toBe(121.28);
        expect(resultado.promedioComision6Meses).toBe(0);
        expect(resultado.indemnizacion.estado).toBe('pendiente_definir');
        expect(resultado.porcentajeIndemnizacion).toBe(100);
    });

    it('con sector económico configurado, calcula la Indemnización real y la incluye en el total', () => {
        const resultado = calcularLiquidacionLaboral({
            empleado,
            fechaRetiro: '2026-06-15',
            tipoRetiro: 'despido',
            metodoPago: 'transferencia',
            bancoEmisor: 'Banco Agrícola',
            sectorEconomico: 'comercio_servicios_industria',
            ultimoCalculo: null,
            ahora: new Date('2026-08-22T00:00:00'),
        });

        expect(resultado.indemnizacion.estado).toBe('confirmado');
        if (resultado.indemnizacion.estado === 'confirmado') expect(resultado.indemnizacion.monto).toBe(892.01);
        // IMPL-14 (2026-10-19): este empleado (despido, antigüedad > 365 días, sueldo $476 <
        // $1,500) también es elegible para Quincena 25 Proporcional — 0.5 × 476 = $238.00 exacto
        // (antigüedad ya tope en 365 días). Se suma al total aunque la Partida Contable todavía
        // no la incluya (pendiente de cuenta contable real).
        expect(resultado.quincena25Proporcional).toEqual({ estado: 'confirmado', monto: 238, dias: 365, elegible: true });
        expect(resultado.totalLiquidacionParcial).toBe(round2(271.25 + 121.28 + 892.01 + 238));
        expect(resultado.partidaContable.cuadraCompleto).toBe(true);
    });

    it('el total parcial NUNCA incluye Indemnización mientras esté pendiente — es explícitamente un total incompleto (CA9)', () => {
        const resultado = calcularLiquidacionLaboral({
            empleado,
            fechaRetiro: '2026-06-15',
            tipoRetiro: 'despido',
            metodoPago: 'cheque',
            bancoEmisor: 'Banco Agrícola',
            sectorEconomico: null,
            ultimoCalculo: null,
            ahora: new Date('2026-08-22T00:00:00'),
        });
        // Vacación + Aguinaldo + Quincena 25 Proporcional (IMPL-14, ver test de arriba — mismo
        // empleado, mismo $238.00 exacto) — sin retenciones/cuotas porque ultimoCalculo es null.
        expect(resultado.totalLiquidacionParcial).toBe(round2(271.25 + 121.28 + 238));
        expect(resultado.solicitudPago.monto).toBe(resultado.totalLiquidacionParcial);
    });

    it('toma Salarios/Horas Extras/Viáticos/ISSS/AFP/cuotas patronales del último cálculo persistido, no recalcula nada del motor', () => {
        const ultimoCalculo = calc('q-final', {
            sueldo_proporcional: 50, horas_extras_monto: 10, viaticos_monto: 5,
            isss_empleado: 8.14, afp_empleado: 19.67, isss_patronal: 20.34, afp_patronal: 23.73, insaforp_patronal: 2.71,
        });
        const resultado = calcularLiquidacionLaboral({
            empleado,
            fechaRetiro: '2026-06-15',
            tipoRetiro: 'renuncia',
            metodoPago: 'transferencia',
            bancoEmisor: 'Banco Agrícola',
            sectorEconomico: null,
            ultimoCalculo,
        });
        expect(resultado.salariosPendientes).toBe(50);
        expect(resultado.horasExtrasPendientes).toBe(10);
        expect(resultado.viaticosPendientes).toBe(5);
        expect(resultado.isssEmpleado).toBe(8.14);
        expect(resultado.afpEmpleado).toBe(19.67);
        expect(resultado.isssPatronal).toBe(20.34);
        expect(resultado.afpPatronal).toBe(23.73);
        expect(resultado.insaforpPatronal).toBe(2.71);
        expect(resultado.afpLabel).toBe('AFP Crecer');
    });

    it('Mutuo Acuerdo propaga el porcentaje capturado al resultado y a la Indemnización pendiente', () => {
        const resultado = calcularLiquidacionLaboral({
            empleado,
            fechaRetiro: '2026-06-15',
            tipoRetiro: 'mutuo_acuerdo',
            porcentajeMutuoAcuerdo: 65,
            metodoPago: 'transferencia',
            bancoEmisor: 'Banco Agrícola',
            sectorEconomico: null,
            ultimoCalculo: null,
        });
        expect(resultado.porcentajeIndemnizacion).toBe(65);
        expect(resultado.indemnizacion.porcentajeSegunTipoRetiro).toBe(65);
    });

    it('la Solicitud de Pago arma correctamente los campos fijos del CA9 (beneficiario, número asignado en blanco)', () => {
        const resultado = calcularLiquidacionLaboral({
            empleado,
            fechaRetiro: '2026-06-15',
            tipoRetiro: 'despido',
            metodoPago: 'cheque',
            bancoEmisor: 'Banco Cuscatlán',
            observaciones: 'Pago único',
            sectorEconomico: null,
            ultimoCalculo: null,
            ahora: new Date('2026-08-22T00:00:00'),
        });
        expect(resultado.solicitudPago.beneficiario).toBe('Marvin Ernesto García Anaya');
        expect(resultado.solicitudPago.bancoEmisor).toBe('Banco Cuscatlán');
        expect(resultado.solicitudPago.metodoPago).toBe('cheque');
        expect(resultado.solicitudPago.observaciones).toBe('Pago único');
        expect(resultado.solicitudPago.numeroAsignado).toBe('');
        expect(resultado.solicitudPago.fechaSolicitud).toBe('2026-08-22');
    });
});
