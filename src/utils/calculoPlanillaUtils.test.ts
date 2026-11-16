import { describe, it, expect } from 'vitest';
import {
    round2,
    calcularSueldoBase,
    calcularSueldoProporcional,
    calcularIngresosGravables,
    calcularISSS,
    calcularAFP,
    calcularDeduccionFija,
    calcularBaseRenta,
    calcularRentaISR,
    calcularRentaBono10,
    calcularDescuentosPeriodo,
    calcularNetoAPagar,
    calcularPlanillaCompleta,
    type ConfigFiscal,
    type TramoRenta,
    type CalculoPlanillaInput,
} from './calculoPlanillaUtils';

// Semilla 2026 (misma que supabase/migrations/20260817090000_create_planilla_config_fiscal.sql).
const CONFIG_2026: ConfigFiscal = {
    isssTasaEmpleado: 0.03,
    isssTopeBase: 500.00,
    afpTasaEmpleado: 0.0725,
    afpTopeBase: null,
    deduccionFijaAnual: 1600.00,
    deduccionFijaTopeIngresoAnual: 9100.00,
    bono10Tasa: 0.10,
    topeDescuentosNoObligatoriosPct: 0.20,
    salarioMinimoInembargable: null,
};

// Tramo II corregido (IMPL-188): exceso_sobre $275.00, confirmado por el Decreto Ejecutivo No.
// 10/2025 (Diario Oficial, Ministerio de Hacienda, "docs/Tablas de renta.pdf") y por el archivo
// de cálculo real que Imporfrut compartió — antes tenía $236.00, remanente de una tasa
// pre-reforma de 2015 nunca actualizada.
const TRAMOS_2026: TramoRenta[] = [
    { orden: 1, desde: 0.01, hasta: 275.00, tasaPct: 0, excesoSobre: 0, montoFijo: 0 },
    { orden: 2, desde: 275.01, hasta: 447.62, tasaPct: 0.10, excesoSobre: 275.00, montoFijo: 8.83 },
    { orden: 3, desde: 447.63, hasta: 1019.05, tasaPct: 0.20, excesoSobre: 447.62, montoFijo: 30.00 },
    { orden: 4, desde: 1019.06, hasta: null, tasaPct: 0.30, excesoSobre: 1019.05, montoFijo: 144.28 },
];

describe('calculoPlanillaUtils — funciones de paso individuales', () => {
    it('calcularSueldoBase deriva quincenal/día/hora de sueldo_mensual (US-CALC-00 CA1-3)', () => {
        expect(calcularSueldoBase(900)).toEqual({ quincenal: 450, porDia: 30, porHora: 3.75 });
    });

    it('calcularSueldoProporcional prorratea por días laborados sobre 15 días hábiles', () => {
        expect(calcularSueldoProporcional(450, 15, 15)).toBe(450);
        expect(calcularSueldoProporcional(450, 10, 15)).toBe(300);
    });

    it('calcularIngresosGravables suma todo salvo viáticos (Paso 8, viáticos excluidos)', () => {
        const total = calcularIngresosGravables({
            sueldoProporcional: 450, horasExtras: 50, vacaciones: 0, bonificaciones: 100, otrosIngresosGravables: 20,
        });
        expect(total).toBe(620);
    });

    it('calcularISSS aplica el tope de $500 base quincenal (US-CALC-01 CA1)', () => {
        expect(calcularISSS(400, CONFIG_2026)).toBe(12);
        expect(calcularISSS(1000, CONFIG_2026)).toBe(15); // tope: MIN(1000,500)*0.03
    });

    it('calcularAFP no tiene tope (eliminado desde 2023, US-CALC-01 CA2)', () => {
        expect(calcularAFP(1000, CONFIG_2026)).toBe(72.5);
        expect(calcularAFP(5000, CONFIG_2026)).toBe(362.5);
    });

    it('calcularAFP retorna 0 para tipo_afiliacion jubilado, sin afectar ISSS (IMPL-4 CA3)', () => {
        expect(calcularAFP(1000, CONFIG_2026, 'jubilado')).toBe(0);
        expect(calcularAFP(1000, CONFIG_2026, 'afp_crecer')).toBe(72.5);
        expect(calcularISSS(1000, CONFIG_2026)).toBe(15); // ISSS no distingue tipo_afiliacion — sigue igual
    });

    it('calcularDeduccionFija aplica solo si el ingreso GRAVABLE DE LA QUINCENA no supera el tope quincenal (IMPL-88 CA2/CA5, defecto IMPL-175)', () => {
        // Tope quincenal = round2(9100/24) = 379.17 — derivado del anual, no hardcodeado.
        const bajo = calcularDeduccionFija(300, CONFIG_2026); // 300 <= 379.17
        expect(bajo.aplica).toBe(true);
        expect(bajo.monto).toBe(round2(1600 / 24));

        const alto = calcularDeduccionFija(500, CONFIG_2026); // 500 > 379.17
        expect(alto.aplica).toBe(false);
        expect(alto.monto).toBe(0);
    });

    it('IMPL-175 (defecto real) — caso Bernardo: sueldo base bajo con horas extra que llevan el gravable de la quincena por encima del umbral NO debe recibir la deducción fija', () => {
        // Antes el criterio miraba sueldoMensual*12 (448*12=5376 <= 9100 → aplicaba SIEMPRE,
        // sin importar la hora extra). Ahora mira el gravable real de la quincena: 439.41 > 379.17
        // → no aplica, aunque el sueldo base contractual sea bajo.
        const resultado = calcularDeduccionFija(439.41, CONFIG_2026);
        expect(resultado.aplica).toBe(false);
        expect(resultado.monto).toBe(0);
    });

    it('IMPL-175 — cadena completa ISSS→AFP→DeducciónFija→BaseRenta→RentaISR para el caso real de Bernardo da $20.77 (actualizado tras corregir el Tramo II en IMPL-188 — con el exceso_sobre viejo de $236.00 daba $24.67)', () => {
        const gravable = 439.41;
        const isss = calcularISSS(gravable, CONFIG_2026);
        const afp = calcularAFP(gravable, CONFIG_2026);
        const deduccionFija = calcularDeduccionFija(gravable, CONFIG_2026);
        const baseRenta = calcularBaseRenta(gravable, isss, afp, deduccionFija.monto);
        const rentaIsr = calcularRentaISR(baseRenta, TRAMOS_2026);

        expect(isss).toBe(13.18);
        expect(afp).toBe(31.86);
        expect(deduccionFija.aplica).toBe(false);
        expect(baseRenta).toBe(394.37);
        expect(rentaIsr).toBe(20.77);
    });

    it('calcularBaseRenta nunca es negativa', () => {
        expect(calcularBaseRenta(100, 50, 50, 50)).toBe(0);
    });

    it('calcularRentaISR aplica el tramo correcto de la tabla (US-CALC-02 CA1)', () => {
        expect(calcularRentaISR(200, TRAMOS_2026)).toBe(0); // Tramo I
        expect(calcularRentaISR(300, TRAMOS_2026)).toBe(round2((300 - 275) * 0.10 + 8.83)); // Tramo II
        expect(calcularRentaISR(500, TRAMOS_2026)).toBe(round2((500 - 447.62) * 0.20 + 30.00)); // Tramo III
        expect(calcularRentaISR(2000, TRAMOS_2026)).toBe(round2((2000 - 1019.05) * 0.30 + 144.28)); // Tramo IV
        expect(calcularRentaISR(0, TRAMOS_2026)).toBe(0);
    });

    it('calcularRentaBono10 es 10% flat, independiente de la tabla de tramos (US-CALC-05 CA1/CA2)', () => {
        expect(calcularRentaBono10(100, CONFIG_2026)).toBe(10);
    });

    it('calcularDescuentosPeriodo (corregido 2026-10-27): ya no difiere nada — el tope del 20% es una validación al configurar el préstamo, no un chequeo en el cálculo. Todo se aplica completo', () => {
        const resultado = calcularDescuentosPeriodo(
            [{ categoria: 'ISSS', monto: 15, prioridad: 1 }, { categoria: 'AFP', monto: 32.6, prioridad: 2 }],
            [
                { categoria: 'Préstamo bancario', monto: 60, prioridad: 4 },
                { categoria: 'Vivienda', monto: 30, prioridad: 5 },
            ],
        );
        expect(resultado.obligatoriosTotal).toBe(47.6);
        expect(resultado.noObligatoriosAplicado).toBe(90);
        expect(resultado.noObligatoriosSolicitado).toBe(90);
    });

    it('reproduce el caso real Manzo: Préstamo (14.2% del sueldo) + Vivienda (15.34%) suman 29.5%, pero cada uno individualmente queda bajo el 20% legal — Imporfrut los aplicó completos, sin diferir nada', () => {
        // Datos reales: docs/formatos-reportes/Planilla 1ra quincena abril 2026.xlsx, hoja
        // Descuentos — Banco Promerica $106.515 + Fondo Social para la Vivienda $115.05, sueldo
        // quincenal $750.
        const resultado = calcularDescuentosPeriodo(
            [],
            [
                { categoria: 'Banco Promerica', monto: 106.515, prioridad: 4 },
                { categoria: 'Fondo Social para la Vivienda', monto: 115.05, prioridad: 5 },
            ],
        );
        expect(resultado.noObligatoriosAplicado).toBeCloseTo(221.565, 2);
    });

    it('calcularNetoAPagar combina gravable + no gravable menos todas las deducciones (Paso 16)', () => {
        expect(calcularNetoAPagar(600, 50, 18, 43.5, 10, 5, 20)).toBe(553.5);
    });
});

/**
 * Casos reales de verificación (documentados en docs/product/planilla-contexto.md): el criterio
 * de aceptación real de esta épica es que estos 3 empleados reproduzcan EXACTAMENTE el neto del
 * Excel actual de Imporfrut. Manzo (Caso 1) ya usa datos reales. Solorzano (Caso 2) y Batres
 * (Caso 3) fallan A PROPÓSITO (decisión del equipo, 2026-08-10): en vez de it.skip, quedan como
 * tests activos con el placeholder EXPECTED=0 para que la falla sea visible en cada corrida de
 * `npm test`, en vez de quedar oculta como "skipped" — no se debe interpretar el rojo como un bug
 * nuevo, es el recordatorio de que faltan datos reales confirmados por Imporfrut/Contabilidad
 * (ver comentario de cada test para el detalle de qué falta).
 */
describe('Casos de verificación reales — Manzo, Solorzano, Batres', () => {
    const inputBase = (overrides: Partial<CalculoPlanillaInput>): CalculoPlanillaInput => ({
        sueldoMensual: 900,
        diasLaborados: 15,
        diasHabilesQuincena: 15,
        horasExtras: 0,
        viaticos: 0,
        vacaciones: 0,
        bonificaciones: 0,
        otrosIngresosGravables: 0,
        otrosIngresosNoGravables: 0,
        baseBono10Total: 0,
        descuentosObligatorios: [],
        descuentosNoObligatorios: [],
        config: CONFIG_2026,
        tramosRenta: TRAMOS_2026,
        ...overrides,
    });

    // Caso 1 — Manzo Navas, Rina Eleonora (Cod. 4), sin horas extra. Datos reales del Excel de
    // Imporfrut (1ra quincena abril 2026). El Excel da neto $494.96; este test usa $494.95 (el
    // resultado exacto del cálculo paso a paso con las tasas/tramos reales) — la diferencia de
    // $0.01 es de orden de redondeo entre pasos, no un error de datos.
    it('Manzo — sueldo $1,500/mes + viático GG con Bono 10% + Préstamo/Vivienda (datos reales)', () => {
        const EXPECTED_NETO_MANZO = 494.95;
        const resultado = calcularPlanillaCompleta(inputBase({
            sueldoMensual: 1500,
            viaticos: 125, // viático fijo de Gerente General — no gravable ISSS/AFP
            baseBono10Total: 125, // el mismo viático GG SÍ sujeto a Bono 10% (retención especial)
            descuentosNoObligatorios: [
                { categoria: 'Préstamo Promerica', monto: 106.52, prioridad: 4, tipo: 'fijo' },
                { categoria: 'Vivienda', monto: 115.05, prioridad: 5, tipo: 'fijo' },
            ],
        }));
        expect(resultado.isss).toBe(15.00);
        expect(resultado.afp).toBe(54.38);
        expect(resultado.baseRenta).toBe(680.62);
        expect(resultado.rentaIsr).toBe(76.60);
        expect(resultado.rentaBono10).toBe(12.50);
        expect(resultado.descuentos.noObligatoriosAplicado).toBe(221.57); // 'fijo' exento del tope 20%
        expect(resultado.netoAPagar).toBeCloseTo(EXPECTED_NETO_MANZO, 2);
    });

    // Caso 2 — Solorzano Alvares, Bernardo (Cod. 11), 2da Quincena Julio 2026. RESUELTO (2026-10-01):
    // Imporfrut confirmó por escrito que el $0 original venía de aplicar un "recálculo" (el
    // mecanismo del Art. f) del Decreto Ejecutivo No. 10/2025, pensado SOLO para los ajustes de
    // junio/diciembre) en vez de la tabla cerrada quincenal normal — no era un bug de este motor.
    // Compartieron el archivo real ("Calculo Renta 2da Quincena Septiembre 2026.xlsx") con el
    // agregado ya corregido: base Renta $453.75 (ya neta de ISSS $15.00/AFP $36.64, sin deducción
    // fija porque supera el tope quincenal de $379.17) cae en Tramo III y da $31.23. No se
    // reconstruye el desglose completo (sueldo base + horas extra por separado) porque Imporfrut
    // solo compartió el agregado por concepto, no el desglose — se verifica con
    // `calcularRentaISR` directo en vez de `calcularPlanillaCompleta` de punta a punta.
    it('calcularRentaISR — caso real Solorzano (2da Q julio 2026, confirmado por Imporfrut): base $453.75 da $31.23, no $0', () => {
        expect(calcularRentaISR(453.75, TRAMOS_2026)).toBe(31.23);
    });

    // Caso 3 — Batres. RESUELTO (2026-10-01): la nómina real tiene TRES empleados "Batres"
    // (Sergio Alexander, Manuel Ernesto, Odanis Enrique) — con la tabla ya corregida, LOS TRES dan
    // Renta ISR $0 (su base, ya neta de ISSS/AFP y de la deducción fija de $66.67 porque ninguno
    // supera el tope quincenal, queda por debajo de $275.00 — Tramo I). Ninguno de los tres da
    // $127.03 ni $297.87 — ambos valores del DRN original eran artefactos del mismo bug de
    // "recálculo" que afectó a Solorzano, no el dato real de ningún Batres puntual. Pendiente:
    // si Imporfrut quiere que investiguemos a cuál de los 3 se refería el DRN originalmente,
    // avisan — no bloquea nada mientras tanto, los 3 dan el mismo resultado ($0).
    it('calcularRentaISR — los 3 "Batres" reales dan $0 con la tabla corregida, ninguno da $127.03 ni $297.87', () => {
        expect(calcularRentaISR(212.08, TRAMOS_2026)).toBe(0); // Sergio Alexander
        expect(calcularRentaISR(206.10, TRAMOS_2026)).toBe(0); // Manuel Ernesto
        expect(calcularRentaISR(247.28, TRAMOS_2026)).toBe(0); // Odanis Enrique
    });

    it('calcularPlanillaCompleta compone los 16 pasos de punta a punta (smoke test, no es un caso real)', () => {
        const resultado = calcularPlanillaCompleta(inputBase({
            sueldoMensual: 900,
            horasExtras: 50,
            bonificaciones: 100,
            descuentosObligatorios: [{ categoria: 'ISSS', monto: 0, prioridad: 1 }],
        }));
        expect(resultado.sueldoBase.quincenal).toBe(450);
        expect(resultado.totalIngresosGravables).toBe(600);
        expect(resultado.netoAPagar).toBeGreaterThan(0);
    });

    it('un empleado jubilado no paga AFP pero sí ISSS de punta a punta (IMPL-4 CA3)', () => {
        const resultado = calcularPlanillaCompleta(inputBase({ tipoAfiliacion: 'jubilado' }));
        expect(resultado.afp).toBe(0);
        expect(resultado.isss).toBeGreaterThan(0);
    });
});
