import type { Quincena } from '../services/quincenasService';
import type { CalculoEmpleado } from '../services/calculoPlanillaService';
import type { ConfigEmpresa } from '../services/empresaConfigService';
import { round2 } from './calculoPlanillaUtils';

/**
 * Año fiscal que cubre la Constancia de Retenciones (US-EXP-13/IMPL-169, CA4) — SIEMPRE el
 * ejercicio anterior COMPLETO al momento de generar el reporte, nunca "lo que va del año actual".
 * Si se genera en 2026, cubre el ejercicio 2025. `ahora` es inyectable (mismo criterio que otros
 * reportes de este módulo que resuelven una fecha "hoy") para poder testear sin mockear `Date`.
 */
export function calcularAnioFiscalAnterior(ahora: Date = new Date()): number {
    return ahora.getFullYear() - 1;
}

/**
 * Quincenas cuya fecha de inicio cae dentro del año fiscal indicado. A diferencia de la ventana
 * de 6 meses de Constancia de Salario (`seleccionarVentana6Meses`, que excluye 'aguinaldo' y
 * 'quincena_25'), acá se reporta el TOTAL RETENIDO EN EL AÑO — ningún tipo de quincena queda
 * afuera, todas suman al total anual que exige Hacienda.
 */
export function seleccionarQuincenasAnioFiscal(quincenas: Quincena[], anioFiscal: number): Quincena[] {
    return quincenas.filter((q) => Number(q.fecha_inicio.slice(0, 4)) === anioFiscal);
}

export interface ConstanciaRetencionesDatos {
    nombreCompleto: string;
    dui: string;
    razonSocialEmpresa: string;
    nitEmpresa: string;
    anioFiscal: number;
    /** Código de ingreso DGII 11 — salario regular (base gravable ordinaria, tabla de tramos de Renta). */
    ingresosCodigo11: number;
    retencionCodigo11: number;
    /** Código de ingreso DGII 60 — "Honorarios y otros ingresos". Reutiliza el mecanismo de
     * retención especial "Bono 10%" (10% flat, Paso 13 del motor de planilla) que ya alimentan
     * viáticos GG con retención especial, vacaciones no gozadas/"trabajadas" (US-VAC-06/IMPL-70) e
     * incapacidad trabajada — mismo tratamiento fiscal que servicios profesionales/honorarios. */
    ingresosCodigo60: number;
    retencionCodigo60: number;
    isss: number;
    afp: number;
}

/**
 * Arma el DTO de la Constancia de Retenciones / Impuesto sobre la Renta (US-EXP-13, IMPL-169
 * CA1-CA3). No recalcula nada del motor de planilla — solo suma sobre los snapshots ya persistidos
 * y auditados de `calculoPlanillaService`, mismo criterio que `constanciaSalarioUtils.ts`.
 *
 * Código 11 = `total_ingresos_gravables`/`renta_isr` (Paso 8/12 del motor — ingresos ordinarios
 * gravables y su retención según la tabla de tramos vigente).
 * Código 60 = `base_bono10_total`/`renta_bono10` (Paso 13 del motor, US-CALC-05/IMPL-91 — el MISMO
 * mecanismo de retención especial 10% flat ya usado para vacaciones trabajadas/no gozadas,
 * IMPL-70). No se reinventa la lógica de "servicios profesionales": es la misma columna.
 */
export function calcularConstanciaRetencionesDatos(
    empleado: { nombre_completo: string; dui: string | null },
    anioFiscal: number,
    calculosDelAnio: CalculoEmpleado[],
    configEmpresa: Pick<ConfigEmpresa, 'razon_social' | 'nit'> | null,
): ConstanciaRetencionesDatos {
    const sumar = (campo: keyof CalculoEmpleado): number =>
        round2(calculosDelAnio.reduce((acc, c) => acc + (c[campo] as number), 0));

    return {
        nombreCompleto: empleado.nombre_completo,
        dui: empleado.dui ?? '—',
        razonSocialEmpresa: configEmpresa?.razon_social ?? '',
        nitEmpresa: configEmpresa?.nit ?? '',
        anioFiscal,
        ingresosCodigo11: sumar('total_ingresos_gravables'),
        retencionCodigo11: sumar('renta_isr'),
        ingresosCodigo60: sumar('base_bono10_total'),
        retencionCodigo60: sumar('renta_bono10'),
        isss: sumar('isss_empleado'),
        afp: sumar('afp_empleado'),
    };
}
