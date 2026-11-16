import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/supabaseClient', () => ({
    supabase: { from: vi.fn() },
}));

import { supabase } from '../config/supabaseClient';
import { exportacionesContablesService } from './exportacionesContablesService';
import { calculoPlanillaService, type CalculoEmpleado } from './calculoPlanillaService';
import { planillaEmpleadosService } from './planillaEmpleadosService';
import { departamentosService } from './departamentosService';

/** Emula el query builder encadenable de Supabase: cada método de filtro devuelve el propio
 * objeto, y awaitearlo (Promise.all o un await directo) resuelve a `result` — mismo contrato que
 * usa `generarFilasIsss` (sin `.single()` acá, no hace falta para este caso). */
function chain(result: { data: unknown; error: unknown }) {
    const obj: Record<string, unknown> = {};
    for (const metodo of ['select', 'eq', 'in', 'order', 'limit', 'lte', 'or']) {
        obj[metodo] = vi.fn(() => obj);
    }
    obj.then = (resolve: (v: typeof result) => void) => Promise.resolve(result).then(resolve);
    return obj;
}

const mockedFrom = vi.mocked(supabase.from);

describe('generarFilasIsss (IMPL-100, US-EXP-02 — observaciones múltiples por empleado)', () => {
    beforeEach(() => {
        mockedFrom.mockReset();
        vi.spyOn(exportacionesContablesService, 'obtenerTasasVigentes').mockResolvedValue({
            isssTasaEmpleado: 0.03,
            isssTasaPatronal: 0.075,
            afpTasaEmpleado: 0.0725,
            afpTasaPatronal: 0.0875,
            isssTopeBase: 500,
            afpTopeBase: null,
        });
    });

    it('CA2 — genera una línea NUEVA por cada incapacidad adicional, repitiendo el resto de los datos idénticos', async () => {
        mockedFrom.mockImplementation((tabla: string) => {
            if (tabla === 'planilla_calculo_empleado') {
                return chain({
                    data: [
                        { empleado_id: 'e1', total_ingresos_gravables: 1000, isss_empleado: 15, isss_patronal: 37.5 },
                        { empleado_id: 'e2', total_ingresos_gravables: 200, isss_empleado: 6, isss_patronal: 15 },
                    ],
                    error: null,
                }) as never;
            }
            if (tabla === 'planilla_incapacidades') {
                return chain({
                    data: [
                        { empleado_id: 'e1', tipo: 'enfermedad_comun' },
                        { empleado_id: 'e1', tipo: 'accidente_trabajo' },
                    ],
                    error: null,
                }) as never;
            }
            if (tabla === 'planilla_empleados') {
                return chain({
                    data: [
                        { id: 'e1', nombre_completo: 'Juan Pérez', dui: '12345678-9' },
                        { id: 'e2', nombre_completo: 'Ana Gómez', dui: '98765432-1' },
                    ],
                    error: null,
                }) as never;
            }
            throw new Error(`tabla inesperada en el mock: ${tabla}`);
        });

        const filas = await exportacionesContablesService.generarFilasIsss('q1');

        const filasE1 = filas.filter((f) => f.dui === '12345678-9');
        expect(filasE1).toHaveLength(2);
        expect(filasE1.map((f) => f.observacion).sort()).toEqual(['Accidente de Trabajo', 'Enfermedad Común']);
        // Resto de los datos idénticos entre ambas filas, solo varía la observación.
        expect(filasE1[0].nombre).toBe(filasE1[1].nombre);
        expect(filasE1[0].salarioBase).toBe(filasE1[1].salarioBase);
        expect(filasE1[0].cotizacionEmpleado).toBe(filasE1[1].cotizacionEmpleado);
        expect(filasE1[0].cotizacionPatronal).toBe(filasE1[1].cotizacionPatronal);
        expect(filasE1[0].salarioBase).toBe(500); // topado contra isssTopeBase (1000 > 500)

        const filasE2 = filas.filter((f) => f.dui === '98765432-1');
        expect(filasE2).toHaveLength(1);
        expect(filasE2[0].observacion).toBe('');
        expect(filasE2[0].salarioBase).toBe(200); // sin tope (200 < 500)
    });
});

describe('generarPartidaDiario — viáticos fijos van a su propia cuenta (Pregunta 8-b, confirmado por Imporfrut 2026-10-27)', () => {
    beforeEach(() => {
        mockedFrom.mockReset();
        vi.spyOn(calculoPlanillaService, 'getPorQuincena').mockResolvedValue([
            {
                empleado_id: 'e1', sueldo_proporcional: 0, horas_extras_monto: 0, viaticos_monto: 200,
                bonificaciones_monto: 0, vacaciones_monto: 0, vacaciones_bono10_base: 0,
                otros_ingresos_gravables: 0, otros_ingresos_no_gravables: 0, otros_ingresos_bono10_base: 0, incapacidad_bono10_base: 0,
                isss_patronal: 0, afp_patronal: 0, insaforp_patronal: 0, isss_empleado: 0, afp_empleado: 0,
                ipsfa_empleado: 0, ipsfa_patronal: 0,
                renta_isr: 0, renta_bono10: 0, neto_a_pagar: 0, descuentos_detalle: [],
            } as unknown as CalculoEmpleado,
        ]);
        vi.spyOn(planillaEmpleadosService, 'getEmpleadosParaReportes').mockResolvedValue([
            { id: 'e1', departamento: 'GERENCIA GENERAL' } as unknown as Awaited<ReturnType<typeof planillaEmpleadosService.getEmpleadosParaReportes>>[number],
        ]);
        vi.spyOn(departamentosService, 'getDepartamentos').mockResolvedValue([
            { nombre: 'GERENCIA GENERAL', grupo_costos: 'GASTOS ADMINISTRATIVOS' } as unknown as Awaited<ReturnType<typeof departamentosService.getDepartamentos>>[number],
        ]);
    });

    it('separa el viático fijo ($125, caso real Rina Manzo) del resto variable ($75) en 2 líneas con cuentas distintas', async () => {
        mockedFrom.mockImplementation((tabla: string) => {
            if (tabla === 'planilla_catalogo_cuentas_contables') {
                return chain({
                    data: [
                        { concepto: 'combustible_depreciacion_vendedores', grupo_costos: 'GASTOS ADMINISTRATIVOS', cuenta_codigo: '4-42-4201-03-002', cuenta_nombre: 'Gasto Depr. y Combustible Vendedores' },
                        { concepto: 'viaticos', grupo_costos: 'GASTOS ADMINISTRATIVOS', cuenta_codigo: '4-42-4201-11-002', cuenta_nombre: 'Viaticos Nacionales' },
                    ],
                    error: null,
                }) as never;
            }
            if (tabla === 'planilla_viaticos_fijos_variables') {
                return chain({ data: [{ empleado_id: 'e1', monto: 125 }], error: null }) as never;
            }
            throw new Error(`tabla inesperada en el mock: ${tabla}`);
        });

        const lineas = await exportacionesContablesService.generarPartidaDiario('q1');

        const lineaFijo = lineas.find((l) => l.concepto.startsWith('Gasto Depr. y Combustible Vendedores'));
        const lineaViaticos = lineas.find((l) => l.concepto.startsWith('Gasto Viáticos'));
        expect(lineaFijo?.monto).toBe(125);
        expect(lineaFijo?.cuenta).toBe('4-42-4201-03-002');
        expect(lineaViaticos?.monto).toBe(75);
        expect(lineaViaticos?.cuenta).toBe('4-42-4201-11-002');
    });

    it('sin viáticos fijos registrados, todo el monto sigue yendo a la cuenta genérica de Viáticos', async () => {
        mockedFrom.mockImplementation((tabla: string) => {
            if (tabla === 'planilla_catalogo_cuentas_contables') {
                return chain({
                    data: [{ concepto: 'viaticos', grupo_costos: 'GASTOS ADMINISTRATIVOS', cuenta_codigo: '4-42-4201-11-002', cuenta_nombre: 'Viaticos Nacionales' }],
                    error: null,
                }) as never;
            }
            if (tabla === 'planilla_viaticos_fijos_variables') {
                return chain({ data: [], error: null }) as never;
            }
            throw new Error(`tabla inesperada en el mock: ${tabla}`);
        });

        const lineas = await exportacionesContablesService.generarPartidaDiario('q1');

        expect(lineas.find((l) => l.concepto.startsWith('Gasto Depr. y Combustible Vendedores'))).toBeUndefined();
        expect(lineas.find((l) => l.concepto.startsWith('Gasto Viáticos'))?.monto).toBe(200);
    });

    it('bugfix (hallazgo UAT 2026-11-04): suma los campos *_bono10_base al débito de Vacaciones y Otros Ingresos, no solo al neto a pagar (IMPL-178 los agregó al crédito pero no al débito)', async () => {
        vi.spyOn(calculoPlanillaService, 'getPorQuincena').mockResolvedValueOnce([
            {
                empleado_id: 'e1', sueldo_proporcional: 0, horas_extras_monto: 0, viaticos_monto: 0,
                bonificaciones_monto: 0, vacaciones_monto: 65, vacaciones_bono10_base: 30,
                otros_ingresos_gravables: 0, otros_ingresos_no_gravables: 0, otros_ingresos_bono10_base: 500, incapacidad_bono10_base: 200,
                isss_patronal: 0, afp_patronal: 0, insaforp_patronal: 0, isss_empleado: 0, afp_empleado: 0,
                ipsfa_empleado: 0, ipsfa_patronal: 0,
                renta_isr: 0, renta_bono10: 0, neto_a_pagar: 0, descuentos_detalle: [],
            } as unknown as CalculoEmpleado,
        ]);
        mockedFrom.mockImplementation((tabla: string) => {
            if (tabla === 'planilla_catalogo_cuentas_contables') return chain({ data: [], error: null }) as never;
            if (tabla === 'planilla_viaticos_fijos_variables') return chain({ data: [], error: null }) as never;
            throw new Error(`tabla inesperada en el mock: ${tabla}`);
        });

        const lineas = await exportacionesContablesService.generarPartidaDiario('q1');

        expect(lineas.find((l) => l.concepto === 'Gasto Vacaciones')?.monto).toBe(95); // 65 + 30
        expect(lineas.find((l) => l.concepto === 'Gasto Otros Ingresos')?.monto).toBe(700); // 0 + 0 + 500 + 200
    });

    it('bugfix (hallazgo UAT 2026-11-04): funde IPSFA con AFP en débito y crédito (afiliaciones mutuamente excluyentes, mismo criterio que ResumenFinancieroSection)', async () => {
        vi.spyOn(calculoPlanillaService, 'getPorQuincena').mockResolvedValueOnce([
            {
                empleado_id: 'e1', sueldo_proporcional: 0, horas_extras_monto: 0, viaticos_monto: 0,
                bonificaciones_monto: 0, vacaciones_monto: 0, vacaciones_bono10_base: 0,
                otros_ingresos_gravables: 0, otros_ingresos_no_gravables: 0, otros_ingresos_bono10_base: 0, incapacidad_bono10_base: 0,
                isss_patronal: 0, afp_patronal: 0, insaforp_patronal: 0, isss_empleado: 0, afp_empleado: 0,
                ipsfa_empleado: 40, ipsfa_patronal: 60,
                renta_isr: 0, renta_bono10: 0, neto_a_pagar: 0, descuentos_detalle: [],
            } as unknown as CalculoEmpleado,
        ]);
        mockedFrom.mockImplementation((tabla: string) => {
            if (tabla === 'planilla_catalogo_cuentas_contables') return chain({ data: [], error: null }) as never;
            if (tabla === 'planilla_viaticos_fijos_variables') return chain({ data: [], error: null }) as never;
            throw new Error(`tabla inesperada en el mock: ${tabla}`);
        });

        const lineas = await exportacionesContablesService.generarPartidaDiario('q1');

        expect(lineas.find((l) => l.concepto.startsWith('Gasto AFP Patronal'))?.monto).toBe(60); // afp_patronal (0) + ipsfa_patronal (60)
        expect(lineas.find((l) => l.concepto === 'AFP por Pagar')?.monto).toBe(100); // afp_empleado (0) + ipsfa_empleado (40) + afp_patronal (0) + ipsfa_patronal (60)
    });

    it('bugfix (hallazgo UAT 2026-11-04): agrega la línea de crédito "INSAFORP por Pagar" (el gasto se debitaba sin contrapartida) y la Partida vuelve a cuadrar', async () => {
        vi.spyOn(calculoPlanillaService, 'getPorQuincena').mockResolvedValueOnce([
            {
                empleado_id: 'e1', sueldo_proporcional: 0, horas_extras_monto: 0, viaticos_monto: 0,
                bonificaciones_monto: 0, vacaciones_monto: 0, vacaciones_bono10_base: 0,
                otros_ingresos_gravables: 0, otros_ingresos_no_gravables: 0, otros_ingresos_bono10_base: 0, incapacidad_bono10_base: 0,
                isss_patronal: 0, afp_patronal: 0, insaforp_patronal: 10, isss_empleado: 0, afp_empleado: 0,
                ipsfa_empleado: 0, ipsfa_patronal: 0,
                renta_isr: 0, renta_bono10: 0, neto_a_pagar: 0, descuentos_detalle: [],
            } as unknown as CalculoEmpleado,
        ]);
        mockedFrom.mockImplementation((tabla: string) => {
            if (tabla === 'planilla_catalogo_cuentas_contables') return chain({ data: [], error: null }) as never;
            if (tabla === 'planilla_viaticos_fijos_variables') return chain({ data: [], error: null }) as never;
            throw new Error(`tabla inesperada en el mock: ${tabla}`);
        });

        const lineas = await exportacionesContablesService.generarPartidaDiario('q1');

        const creditoInsaforp = lineas.find((l) => l.concepto === 'INSAFORP por Pagar');
        expect(creditoInsaforp?.cuenta).toBe('2135');
        expect(creditoInsaforp?.monto).toBe(10);

        const totalDebito = lineas.filter((l) => l.tipo === 'debito').reduce((s, l) => s + l.monto, 0);
        const totalCredito = lineas.filter((l) => l.tipo === 'credito').reduce((s, l) => s + l.monto, 0);
        expect(totalDebito).toBe(totalCredito);
    });
});
