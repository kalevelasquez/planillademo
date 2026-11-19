import type { Empleado } from '../services/planillaEmpleadosService';
import type { CalculoEmpleado } from '../services/calculoPlanillaService';
import type { LiquidacionLaboralDatos, Indemnizacion } from './liquidacionLaboralUtils';
import { round2 } from './calculoPlanillaUtils';
import { normalizarTexto } from './fuzzyMatchUtils';

const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
const DIECIS = [
    'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
    'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
];
const VEINTIS = [
    'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO',
    'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE',
];
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = [
    '', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
    'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS',
];

/** Convierte un grupo de 0-999 a letras. */
function convertirGrupo(n: number): string {
    if (n === 0) return '';
    if (n === 100) return 'CIEN';

    const centena = Math.floor(n / 100);
    const resto = n % 100;
    const partes: string[] = [];

    if (centena > 0) partes.push(CENTENAS[centena]);

    if (resto > 0) {
        if (resto < 10) partes.push(UNIDADES[resto]);
        else if (resto < 20) partes.push(DIECIS[resto - 10]);
        else if (resto < 30) partes.push(VEINTIS[resto - 20]);
        else {
            const decena = Math.floor(resto / 10);
            const unidad = resto % 10;
            partes.push(unidad === 0 ? DECENAS[decena] : `${DECENAS[decena]} Y ${UNIDADES[unidad]}`);
        }
    }

    return partes.join(' ');
}

/** "UNO"→"UN", "VEINTIUNO"→"VEINTIÚN" — apócope obligatoria antes de "MIL"/"MILLÓN". */
function apocopar(texto: string): string {
    if (texto.endsWith('VEINTIUNO')) return `${texto.slice(0, -3)}ÚN`;
    if (texto.endsWith('UNO')) return `${texto.slice(0, -3)}UN`;
    return texto;
}

/** Convierte un entero no negativo a letras, sin límite práctico (hasta miles de millones). */
function convertirNumeroALetras(n: number): string {
    if (n === 0) return 'CERO';

    const millones = Math.floor(n / 1_000_000);
    const miles = Math.floor((n % 1_000_000) / 1000);
    const resto = n % 1000;
    const partes: string[] = [];

    if (millones > 0) {
        partes.push(millones === 1 ? 'UN MILLÓN' : `${apocopar(convertirGrupo(millones))} MILLONES`);
    }
    if (miles > 0) {
        partes.push(miles === 1 ? 'MIL' : `${apocopar(convertirGrupo(miles))} MIL`);
    }
    if (resto > 0) {
        partes.push(convertirGrupo(resto));
    }

    return partes.join(' ');
}

/**
 * IMPL-162 CA5 — "monto en letras" para la cláusula del Finiquito ("Recibí... la cantidad de
 * NUEVE MIL SETECIENTOS OCHO CON 90/100..."). Distinto del CA2 original (DUI dígito por dígito),
 * que quedó descartado al reescribirse el ticket: los ejemplos vigentes (Melvin/Dora) usan el
 * DUI en formato plano, y el documento viejo que pedía el deletreo resultó ser una plantilla
 * reciclada de otra empresa. Este conversor sí sigue siendo necesario — los 3 ejemplos coinciden
 * en escribir el monto total en palabras.
 *
 * Devuelve solo la parte numérica ("NUEVE MIL... CON 90/100"); el texto legal alrededor
 * ("Recibí... la cantidad de ... DÓLARES...") lo arma la plantilla del reporte.
 */
export function convertirMontoALetras(monto: number): string {
    const redondeado = Math.round(monto * 100) / 100;
    const entero = Math.floor(redondeado);
    const centavos = Math.round((redondeado - entero) * 100);
    const textoEntero = entero === 0 ? 'CERO' : convertirNumeroALetras(entero);
    return `${textoEntero} CON ${String(centavos).padStart(2, '0')}/100`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DTO del Finiquito (IMPL-162, CA1 reescrito septiembre 2026)
// ─────────────────────────────────────────────────────────────────────────────

/** Monto confirmado, o TODO explícito — mismo criterio que `IndemnizacionPendiente` de
 * `liquidacionLaboralUtils.ts`: nunca un $0.00 silencioso para algo que en realidad no se sabe. */
export type MontoOPendiente =
    | { estado: 'confirmado'; monto: number }
    | { estado: 'pendiente_definir'; motivo: string };

const MOTIVO_VACACIONES_COMPLETAS_PENDIENTE =
    'PENDIENTE DE DEFINIR — el CA1 de IMPL-162 pide "Vacaciones Completas" Y "Vacación ' +
    'Proporcional" como líneas separadas, pero el único dato de días pendientes que existe hoy ' +
    '(`VacacionesResumenSection`) ya incluye el año en curso dentro de su cálculo — combinarlo ' +
    'tal cual con la Proporcional pagaría dos veces el año actual. Pregunta enviada a Teknergy ' +
    '(2026-09-21) sobre qué representa exactamente "Completas" en el documento real (Melvin/Dora), ' +
    'sin responder todavía.';

const MOTIVO_AGUINALDO_COMPLETO_PENDIENTE =
    'PENDIENTE DE DEFINIR — mismo motivo que Vacaciones Completas: no existe hoy un cálculo de ' +
    '"Aguinaldo Completo" separado del proporcional del año en curso. Misma pregunta enviada a ' +
    'Teknergy (2026-09-21), sin responder todavía.';

/**
 * CONFIRMADO por Imporfrut (2026-09-21): la categoría se toma tal cual la ingresó el usuario en
 * el descuento — si existe una categoría "Calzado" distinta de "Uniforme", usarla; si no existe
 * todavía, un Admin debe crearla en Configuración > Categorías de Descuento (catálogo dinámico
 * por tenant, `descuentoCategoriasService.ts` — no es algo que se resuelva en código). Match
 * exacto por nombre (con `normalizarTexto` solo para tolerar tildes/mayúsculas), NUNCA la
 * categoría combinada "Calzado y Uniformes" que ya usa Recibo de Sueldo (`reciboSueldoUtils.ts`)
 * — mezclaría Uniforme dentro de esta línea.
 */
const CATEGORIA_CALZADO = 'Calzado';

/** CONFIRMADO por Imporfrut (2026-09-21): "hay que crearlo" — es una categoría nueva, distinta
 * de "Anticipo de salario". Mismo criterio de match que Calzado. */
const CATEGORIA_ANTICIPO_VACACIONES_AGUINALDO = 'Anticipo de Vacaciones y Aguinaldo';

function sumarPorCategoria(detalle: CalculoEmpleado['descuentos_detalle'], nombreCategoria: string): number {
    const normalizada = normalizarTexto(nombreCategoria);
    return detalle.filter((d) => normalizarTexto(d.categoria) === normalizada).reduce((acc, d) => acc + d.aplicado, 0);
}

export interface DetalleDescuentosFiniquito {
    isss: number;
    afp: number;
    renta: number;
    /** CONFIRMADO — suma de `descuentos_detalle` cuya categoría matchea "Calzado" exacto (ver
     * `CATEGORIA_CALZADO`). $0 real si el empleado no tuvo ningún descuento de esa categoría este
     * período, no un placeholder. */
    calzado: number;
    /** CONFIRMADO — mismo criterio, categoría "Anticipo de Vacaciones y Aguinaldo". */
    anticipoVacacionesAguinaldo: number;
    /** TODO lo de `descuentos_detalle` del último cálculo EXCLUYENDO Calzado/Anticipo V&A (esos
     * ya tienen su propia línea arriba, no se cuentan dos veces). */
    otrosDescuentos: number;
}

export interface FiniquitoDatos {
    nombreEmpleado: string;
    /** Formato plano (ej. "02697943-9") — CA2 reescrito: el deletreo dígito por dígito quedó
     * descartado, el documento vigente (Melvin/Dora) usa el DUI tal cual. */
    dui: string;
    fechaInicio: string;
    fechaFin: string;
    fechaFirma: string;

    /** CA1 — reusa EXACTO el mismo resultado de Liquidación Laboral (IMPL-161), nunca un monto
     * propio: es la misma fuente de verdad (CA4). Calculado si hay sector económico configurado,
     * pendiente si no. */
    indemnizacion: Indemnizacion;

    vacacionesCompletas: MontoOPendiente;
    vacacionProporcional: number;

    aguinaldoCompleto: MontoOPendiente;
    aguinaldoProporcional: number;

    sueldoPendiente: number;
    horasExtrasPendientes: number;
    viaticosPendientes: number;
    /** Único monto que Liquidación Laboral no expone en su DTO — se toma directo del mismo
     * snapshot (`ultimoCalculo.bonificaciones_monto`) que ya usa Liquidación Laboral por debajo,
     * no es un cálculo nuevo (CA4). */
    bonificacion: number;

    /** Suma de todo lo de arriba, SIN Indemnización/Completas (pendientes) — mismo criterio que
     * `totalLiquidacionParcial` de IMPL-161: explícitamente parcial, no el total final. */
    ingresosTotales: number;

    /** Bases YA persistidas del último cálculo (`total_ingresos_gravables`/`base_renta`) — son
     * la base que generó los descuentos de ISSS/AFP/Renta de ese período, NO un nuevo impuesto
     * calculado sobre los montos del finiquito en sí. */
    ingresosAfectosIsssAfp: number;
    ingresosGravadosRenta: number;

    detalleDescuentos: DetalleDescuentosFiniquito;
    /** ISSS + AFP + Renta + Calzado + Anticipo V&A + Otros Descuentos. */
    totalDescuentos: number;

    /** Ingresos Totales − Total Descuentos, SIN Indemnización/Completas — explícitamente parcial. */
    totalAPagarParcial: number;
    /** "Recibí... la cantidad de X CON XX/100" sobre `totalAPagarParcial` (CA5). */
    montoEnLetras: string;
}

export interface FiniquitoInput {
    empleado: Pick<Empleado, 'nombre_completo' | 'fecha_ingreso'> & { dui: string | null };
    /** Ya calculado por `calcularLiquidacionLaboral` (IMPL-161) — única fuente de verdad (CA4):
     * el Finiquito no recalcula Indemnización/Vacación/Aguinaldo Proporcional por su cuenta. */
    liquidacion: LiquidacionLaboralDatos;
    /** Mismo snapshot que ya usó `calcularLiquidacionLaboral` para armar `liquidacion` — se pasa
     * de nuevo acá solo para leer `bonificaciones_monto`/`descuentos_detalle`, que Liquidación
     * Laboral no expone en su propio DTO. */
    ultimoCalculo: CalculoEmpleado | null;
    fechaFirma?: string;
    /** Inyectable para tests, mismo criterio que el resto de los reportes de este módulo. */
    ahora?: Date;
}

/**
 * Arma el DTO del Finiquito (US-EXP-09, IMPL-162 CA1 reescrito septiembre 2026). Reusa
 * `LiquidacionLaboralDatos` como única fuente de verdad para Indemnización/Vacación
 * Proporcional/Aguinaldo Proporcional/Sueldo/Horas Extras/Viáticos/ISSS/AFP (CA4) — este DTO
 * NO vuelve a calcular ninguno de esos montos. Vacaciones Completas y Aguinaldo Completo siguen
 * `pendiente_definir` (pregunta enviada a Imporfrut, sin responder) — Calzado y Anticipo de
 * Vacaciones y Aguinaldo ya NO están pendientes (confirmado 2026-09-21: match por categoría tal
 * cual la ingresó el usuario, ver `CATEGORIA_CALZADO`/`CATEGORIA_ANTICIPO_VACACIONES_AGUINALDO`).
 */
export function calcularFiniquitoDatos(input: FiniquitoInput): FiniquitoDatos {
    const calculo = input.ultimoCalculo;
    const descuentosDetalle = calculo?.descuentos_detalle ?? [];

    const sueldoPendiente = input.liquidacion.salariosPendientes;
    const horasExtrasPendientes = input.liquidacion.horasExtrasPendientes;
    const viaticosPendientes = input.liquidacion.viaticosPendientes;
    const bonificacion = calculo?.bonificaciones_monto ?? 0;
    const vacacionProporcional = input.liquidacion.vacacionProporcional;
    const aguinaldoProporcional = input.liquidacion.aguinaldoProporcional;

    const ingresosTotales = round2(
        sueldoPendiente + horasExtrasPendientes + viaticosPendientes + bonificacion
        + vacacionProporcional + aguinaldoProporcional,
    );

    const calzado = round2(sumarPorCategoria(descuentosDetalle, CATEGORIA_CALZADO));
    const anticipoVacacionesAguinaldo = round2(sumarPorCategoria(descuentosDetalle, CATEGORIA_ANTICIPO_VACACIONES_AGUINALDO));
    const categoriasConLineaPropia = [CATEGORIA_CALZADO, CATEGORIA_ANTICIPO_VACACIONES_AGUINALDO].map(normalizarTexto);
    const otrosDescuentos = round2(
        descuentosDetalle
            .filter((d) => !categoriasConLineaPropia.includes(normalizarTexto(d.categoria)))
            .reduce((acc, d) => acc + d.aplicado, 0),
    );
    const isss = input.liquidacion.isssEmpleado;
    const afp = input.liquidacion.afpEmpleado;
    const renta = calculo?.renta_isr ?? 0;
    const totalDescuentos = round2(isss + afp + renta + calzado + anticipoVacacionesAguinaldo + otrosDescuentos);

    const totalAPagarParcial = round2(ingresosTotales - totalDescuentos);
    const ahora = input.ahora ?? new Date();

    return {
        nombreEmpleado: input.empleado.nombre_completo,
        dui: input.empleado.dui ?? '—',
        fechaInicio: input.empleado.fecha_ingreso,
        fechaFin: input.liquidacion.fechaRetiro,
        fechaFirma: input.fechaFirma ?? ahora.toISOString().slice(0, 10),

        indemnizacion: input.liquidacion.indemnizacion,

        vacacionesCompletas: { estado: 'pendiente_definir', motivo: MOTIVO_VACACIONES_COMPLETAS_PENDIENTE },
        vacacionProporcional,

        aguinaldoCompleto: { estado: 'pendiente_definir', motivo: MOTIVO_AGUINALDO_COMPLETO_PENDIENTE },
        aguinaldoProporcional,

        sueldoPendiente,
        horasExtrasPendientes,
        viaticosPendientes,
        bonificacion,

        ingresosTotales,

        ingresosAfectosIsssAfp: calculo?.total_ingresos_gravables ?? 0,
        ingresosGravadosRenta: calculo?.base_renta ?? 0,

        detalleDescuentos: {
            isss,
            afp,
            renta,
            calzado,
            anticipoVacacionesAguinaldo,
            otrosDescuentos,
        },
        totalDescuentos,

        totalAPagarParcial,
        montoEnLetras: convertirMontoALetras(totalAPagarParcial),
    };
}
