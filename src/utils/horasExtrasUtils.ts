/**
 * Algoritmo de Cálculo de Horas Extras (US-HEX-03). Módulo puro — sin tabla, sin RPC, sin
 * UI todavía: nadie lo consume hasta que exista la importación (US-HEX-02) o la carga manual
 * (US-HEX-06). Los timestamps de entrada/salida se esperan como hora LOCAL sin sufijo de zona
 * horaria (mismo patrón que `new Date(`${iso}T00:00:00`)` usado en quincenaUtils.ts) — pasar
 * timestamps con 'Z'/offset UTC rompería la clasificación día/noche.
 *
 * Contrato importante: `tramos` debe venir ya neteado de almuerzo (si un día tiene un solo
 * tramo de punta a punta sin marcar la pausa, esta función NO puede distinguir eso de horas
 * genuinamente trabajadas — ver advertencia heurística más abajo y el gap documentado en
 * planilla-contexto.md). Un tramo que cruza medianoche se atribuye por completo al día
 * calendario de su `entrada` para efectos de jornada ordinaria / feriado.
 */

export interface Tramo {
    entrada: string;
    salida: string;
}

export type ConceptoHorasExtras = 'hed' | 'hen' | 'nocturnidad_ordinaria' | 'feriado_diurno' | 'feriado_nocturno';

export interface DetalleConcepto {
    concepto: ConceptoHorasExtras;
    horas: number;
    tarifa: number;
    monto: number;
}

export interface ResultadoDiaHorasExtras {
    horasTrabajadas: number;
    detalle: DetalleConcepto[];
    montoTotal: number;
    advertencias: string[];
}

export const TARIFA_HED = 2.0;
export const TARIFA_HEN = 2.0;
export const TARIFA_NOCTURNIDAD_ORDINARIA = 1.25;
export const TARIFA_FERIADO_DIURNO = 2.0;
// "Recargo compuesto" (CA3): interpretado como exclusivo de horas Feriado/Descanso que caen
// en franja nocturna — HEN ya es por definición nocturna (aplicarle esto sería tautológico y
// contradiría su propia tarifa de 2.0x) y HED por definición nunca cae en franja nocturna. Ver
// gap: pedir confirmación explícita al cliente.
export const TARIFA_FERIADO_NOCTURNO = 2.25;

const HORA_NOCTURNA_FIN = 6; // 06:00
const HORA_NOCTURNA_INICIO = 19; // 19:00
const MS_POR_HORA = 3_600_000;

/** Valor hora (CA2). */
export function valorHora(sueldoMensual: number): number {
    return sueldoMensual / 240;
}

/** Exportada para reuso en marcacionesValidacionUtils.ts (US-HEX-04). */
export function horasEnTramo(tramo: Tramo): number {
    const ms = new Date(tramo.salida).getTime() - new Date(tramo.entrada).getTime();
    return ms / MS_POR_HORA;
}

/** Solape en horas entre [desde, hasta) y la franja nocturna del día calendario de `desde`. */
function solapeNocturnoEnDia(desde: Date, hasta: Date): number {
    const inicioNoche1 = new Date(desde); inicioNoche1.setHours(0, 0, 0, 0);
    const finNoche1 = new Date(desde); finNoche1.setHours(HORA_NOCTURNA_FIN, 0, 0, 0);
    const inicioNoche2 = new Date(desde); inicioNoche2.setHours(HORA_NOCTURNA_INICIO, 0, 0, 0);
    const finNoche2 = new Date(desde); finNoche2.setHours(24, 0, 0, 0);

    const solape1 = Math.max(0, Math.min(hasta.getTime(), finNoche1.getTime()) - Math.max(desde.getTime(), inicioNoche1.getTime()));
    const solape2 = Math.max(0, Math.min(hasta.getTime(), finNoche2.getTime()) - Math.max(desde.getTime(), inicioNoche2.getTime()));
    return (solape1 + solape2) / MS_POR_HORA;
}

/**
 * Horas de un tramo que caen en franja nocturna (19:00–6:00), partiendo el tramo en
 * segmentos por medianoche cuando cruza de un día calendario a otro (CA4a).
 */
function horasNocturnasEnTramo(tramo: Tramo): number {
    const entrada = new Date(tramo.entrada);
    const salida = new Date(tramo.salida);
    let total = 0;
    let cursor = entrada;

    while (cursor < salida) {
        const finDia = new Date(cursor);
        finDia.setHours(24, 0, 0, 0);
        const finSegmento = salida < finDia ? salida : finDia;
        total += solapeNocturnoEnDia(cursor, finSegmento);
        cursor = finSegmento;
    }
    return total;
}

function agregarDetalle(detalle: DetalleConcepto[], concepto: ConceptoHorasExtras, horas: number, tarifa: number, valorHoraCalc: number) {
    if (horas <= 0) return;
    detalle.push({ concepto, horas, tarifa, monto: horas * valorHoraCalc * tarifa });
}

/**
 * Calcula los conceptos de horas extra de UN día para UN empleado (CA1-CA5). No agrega
 * varios días ni aplica el umbral semanal de 44h (US-HEX-01 CA3/CA4, diferido — ver gap).
 */
export function calcularConceptosDelDia(
    tramos: Tramo[],
    jornadaOrdinariaHoras: number,
    sueldoMensual: number,
    esFeriadoODescanso: boolean
): ResultadoDiaHorasExtras {
    for (const tramo of tramos) {
        if (new Date(tramo.salida).getTime() <= new Date(tramo.entrada).getTime()) {
            throw new Error(`Tramo inválido: salida (${tramo.salida}) no es posterior a entrada (${tramo.entrada}).`);
        }
    }

    const valorHoraCalc = valorHora(sueldoMensual);
    const horasTrabajadas = tramos.reduce((sum, t) => sum + horasEnTramo(t), 0);
    const horasNocturnas = tramos.reduce((sum, t) => sum + horasNocturnasEnTramo(t), 0);
    const detalle: DetalleConcepto[] = [];
    const advertencias: string[] = [];

    if (esFeriadoODescanso) {
        const horasDiurnas = horasTrabajadas - horasNocturnas;
        agregarDetalle(detalle, 'feriado_diurno', horasDiurnas, TARIFA_FERIADO_DIURNO, valorHoraCalc);
        agregarDetalle(detalle, 'feriado_nocturno', horasNocturnas, TARIFA_FERIADO_NOCTURNO, valorHoraCalc);
    } else {
        const horasExtra = Math.max(0, horasTrabajadas - jornadaOrdinariaHoras); // Y (CA4b)
        const hen = horasNocturnas > horasExtra ? horasExtra : horasNocturnas; // CA4d
        const hed = horasExtra - hen;
        const nocturnidadOrdinaria = horasNocturnas - hen; // CA4e

        agregarDetalle(detalle, 'hed', hed, TARIFA_HED, valorHoraCalc);
        agregarDetalle(detalle, 'hen', hen, TARIFA_HEN, valorHoraCalc);
        agregarDetalle(detalle, 'nocturnidad_ordinaria', nocturnidadOrdinaria, TARIFA_NOCTURNIDAD_ORDINARIA, valorHoraCalc);

        if (tramos.length === 1 && jornadaOrdinariaHoras > 0) {
            const diferencia = horasTrabajadas - jornadaOrdinariaHoras;
            if (diferencia >= 0.5 && diferencia <= 1.5) {
                advertencias.push('Un solo tramo marcado (sin pausa de almuerzo separada) — verificar si el almuerzo ya está descontado antes de confirmar horas extra.');
            }
        }
    }

    const montoTotal = detalle.reduce((sum, d) => sum + d.monto, 0);
    return { horasTrabajadas, detalle, montoTotal, advertencias };
}

export interface HorasCategorizadas {
    hed: number;
    hen: number;
    nocturnidad: number;
    feriado: number;
}

/**
 * Calcula el monto de horas ya categorizadas manualmente (US-HEX-06 CA2) — a diferencia de
 * `calcularConceptosDelDia`, acá no hay tramos que clasificar: el Preparador ya escribió
 * directamente cuántas horas de cada tipo. Reusa los mismos `valorHora`/tarifas que el
 * algoritmo de reloj para que la fórmula de dinero tenga una sola fuente de verdad. "Feriado"
 * en carga manual es una tarifa plana (diurna, 2.0x) — CA1 solo pide una columna "Feriado",
 * no separa diurno/nocturno como sí hace US-HEX-03; ver gap.
 */
export function calcularMontoHorasExtras(sueldoMensual: number, horas: HorasCategorizadas): { detalle: DetalleConcepto[]; montoTotal: number } {
    const valorHoraCalc = valorHora(sueldoMensual);
    const detalle: DetalleConcepto[] = [];

    agregarDetalle(detalle, 'hed', horas.hed, TARIFA_HED, valorHoraCalc);
    agregarDetalle(detalle, 'hen', horas.hen, TARIFA_HEN, valorHoraCalc);
    agregarDetalle(detalle, 'nocturnidad_ordinaria', horas.nocturnidad, TARIFA_NOCTURNIDAD_ORDINARIA, valorHoraCalc);
    agregarDetalle(detalle, 'feriado_diurno', horas.feriado, TARIFA_FERIADO_DIURNO, valorHoraCalc);

    const montoTotal = detalle.reduce((sum, d) => sum + d.monto, 0);
    return { detalle, montoTotal };
}
