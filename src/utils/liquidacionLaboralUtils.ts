import type { Empleado } from '../services/planillaEmpleadosService';
import type { CalculoEmpleado } from '../services/calculoPlanillaService';
import type { Quincena } from '../services/quincenasService';
import { round2 } from './calculoPlanillaUtils';
import { mapAfpColumna } from './reciboSueldoUtils';

/**
 * Liquidación Laboral (US-EXP-08, IMPL-161). El CA1 (Indemnización, Art. 58 CT) quedó pendiente
 * mucho tiempo por el "salario base": un caso real (Dora Amanda Quintanilla) mostró dos salarios
 * mensuales distintos en la misma hoja de cálculo ($2,872.21 vs $1,635.20), usando el segundo sin
 * explicación documentada. Imporfrut CONFIRMÓ (2026-09-21): usar el sueldo mensual ACTIVO del
 * empleado en el momento del cálculo (`sueldo_mensual`), sin promedio de comisiones ni otras
 * variables — el propio archivo de referencia de este ticket (`1.3 Liquidación laboral.xlsx`,
 * caso Marvin Ernesto García Anaya) es compatible: su fórmula sumaría un promedio de comisión de
 * 6 meses al salario base, pero en ese caso ese promedio es $0, así que el salario usado termina
 * siendo el sueldo base puro. Esa misma hoja también reveló una inconsistencia propia del cliente
 * (Calculo: $892.01 vs Finiquito/partida: $893.32 hardcodeado a mano, misma persona) — se usa la
 * hoja "Calculo" (con fórmula) como fuente de verdad, no el valor manual.
 *
 * Si `sectorEconomico` no está configurado (Datos Fiscales de la Empresa), `calcularIndemnizacion`
 * devuelve `pendiente_definir` en vez de asumir un tope — el salario base ya está confirmado, pero
 * el TOPE legal (4× salario mínimo diario, Art. 58) varía por sector y necesita esa configuración.
 *
 * Fuente de verdad para las fórmulas de período (CA3/CA4): se verificaron dígito por dígito
 * contra el caso real de la hoja "Calculo" del Excel de referencia (Marvin Ernesto García Anaya,
 * ingreso 31-jul-2024, salida 15-jun-2026, sueldo $476.00/mes) — ver comentarios en cada función.
 */

export type TipoRetiro = 'despido' | 'renuncia' | 'mutuo_acuerdo';
export type MetodoPago = 'transferencia' | 'cheque';

const MS_POR_DIA = 1000 * 60 * 60 * 24;

function parseFechaLocal(fecha: string): Date {
    return new Date(`${fecha}T00:00:00`);
}

/** Cuenta días de forma INCLUSIVA (ambos extremos cuentan) — mismo criterio que
 * `calcularDiasVacacion` (vacacionesUtils.ts), y el mismo que usa el Excel real de Imporfrut para
 * "No. DIAS" (31-jul-25 → 15-jun-26 = 320, no 319). */
function diasInclusive(inicio: Date, fin: Date): number {
    return Math.max(0, Math.round((fin.getTime() - inicio.getTime()) / MS_POR_DIA) + 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// CA2 — Tipo de Retiro determina el % de indemnización
// ─────────────────────────────────────────────────────────────────────────────

const PORCENTAJE_DESPIDO = 100;
const PORCENTAJE_RENUNCIA = 50;

/**
 * CA2. Despido = 100%, Renuncia = 50%, Mutuo Acuerdo = % variable capturado caso por caso al
 * generar la liquidación (NUNCA un valor fijo asumido — por eso lanza si falta o está fuera de
 * rango, en vez de defaultear a 0/100 silenciosamente).
 */
export function calcularPorcentajeIndemnizacionPorRetiro(tipoRetiro: TipoRetiro, porcentajeMutuoAcuerdo?: number): number {
    if (tipoRetiro === 'despido') return PORCENTAJE_DESPIDO;
    if (tipoRetiro === 'renuncia') return PORCENTAJE_RENUNCIA;

    if (porcentajeMutuoAcuerdo === undefined || porcentajeMutuoAcuerdo === null || Number.isNaN(porcentajeMutuoAcuerdo)) {
        throw new Error('El porcentaje de Mutuo Acuerdo es obligatorio (CA2) — se captura caso por caso, no tiene un valor por defecto.');
    }
    if (porcentajeMutuoAcuerdo < 0 || porcentajeMutuoAcuerdo > 100) {
        throw new Error('El porcentaje de Mutuo Acuerdo debe estar entre 0 y 100.');
    }
    return porcentajeMutuoAcuerdo;
}

// ─────────────────────────────────────────────────────────────────────────────
// CA1 — Indemnización: tope por sector económico (Decretos Ejecutivos 11 y 12 de 2025)
// ─────────────────────────────────────────────────────────────────────────────

export type SectorEconomico = 'comercio_servicios_industria' | 'maquila_textil' | 'beneficio_cafe_cana' | 'agropecuario_pesca';

interface SalarioMinimoDiarioVigencia {
    sector: SectorEconomico;
    vigenteDesde: string;
    salarioMinimoDiario: number;
}

/**
 * Tabla histórica de salario mínimo diario por sector — vigente desde jun/2025 (Decretos
 * Ejecutivos 11 y 12 de 2025). Agregar filas NUEVAS con su propia `vigenteDesde` cuando cambie el
 * decreto — nunca reemplazar/borrar una fila existente: se necesita para liquidar retiros con
 * fecha anterior al cambio (CA1 exige histórico, no solo el valor actual).
 */
const SALARIOS_MINIMOS_DIARIOS: SalarioMinimoDiarioVigencia[] = [
    { sector: 'comercio_servicios_industria', vigenteDesde: '2025-06-01', salarioMinimoDiario: 13.44 },
    { sector: 'maquila_textil', vigenteDesde: '2025-06-01', salarioMinimoDiario: 13.227 },
    { sector: 'beneficio_cafe_cana', vigenteDesde: '2025-06-01', salarioMinimoDiario: 10.035 },
    { sector: 'agropecuario_pesca', vigenteDesde: '2025-06-01', salarioMinimoDiario: 8.96 },
];

/** Salario mínimo diario vigente para un sector en una fecha dada (el decreto más reciente con
 * `vigenteDesde <= fecha`) — `null` si no hay ningún decreto registrado para ese sector a esa fecha. */
export function resolverSalarioMinimoDiarioVigente(sector: SectorEconomico, fecha: string): number | null {
    const vigentes = SALARIOS_MINIMOS_DIARIOS
        .filter((v) => v.sector === sector && v.vigenteDesde <= fecha)
        .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde));
    return vigentes[0]?.salarioMinimoDiario ?? null;
}

/** Años de servicio EN FRACCIÓN (para la fórmula de Indemnización, que es proporcional por
 * fracciones de año) — a diferencia de `calcularAniosAntiguedad` (años completos, floor, usado
 * solo para el tramo de días de Aguinaldo). Mismo criterio de fecha que el resto del módulo. */
export function calcularAniosServicioFraccional(fechaIngreso: string, fechaRetiro: string): number {
    const ingreso = parseFechaLocal(fechaIngreso);
    const retiro = parseFechaLocal(fechaRetiro);
    if (retiro < ingreso) return 0;
    return (retiro.getTime() - ingreso.getTime()) / MS_POR_DIA / 365;
}

export interface IndemnizacionConfirmada {
    estado: 'confirmado';
    monto: number;
    porcentajeSegunTipoRetiro: number;
    salarioDiarioComputable: number;
    salarioMinimoDiarioVigente: number;
    aniosServicioFraccional: number;
}

export interface IndemnizacionPendiente {
    estado: 'pendiente_definir';
    /** Se conserva ya calculado para cuando se configure el sector — así no hay que volver a
     * pedirle el Tipo de Retiro/% al usuario, ya quedó capturado en este mismo momento. */
    porcentajeSegunTipoRetiro: number;
    motivo: string;
}

export type Indemnizacion = IndemnizacionConfirmada | IndemnizacionPendiente;

const MOTIVO_INDEMNIZACION_SIN_SECTOR =
    'PENDIENTE DE DEFINIR — no se ha configurado el sector económico de la empresa (Datos ' +
    'Fiscales) ni el salario mínimo diario vigente para ese sector, necesarios para calcular el ' +
    'tope de Indemnización (4× salario mínimo diario, Art. 58 CT). El salario base en sí ya está ' +
    'confirmado por Imporfrut (sueldo mensual activo) — falta únicamente esta configuración.';

/**
 * CA1 — Indemnización (Art. 58 CT): `salario_diario_computable = MIN(sueldo_mensual/30, 4 ×
 * salario_mínimo_diario_vigente_del_sector)`; `Indemnización = salario_diario_computable × 30 ×
 * años_de_servicio (fracción) × % según Tipo de Retiro (CA2)`. Verificado EXACTO contra el caso
 * real (Marvin Ernesto García Anaya: sueldo $476, 684 días de antigüedad → $892.01 antes del %
 * de retiro, coincide dígito por dígito con la hoja "Calculo" del Excel de referencia).
 *
 * Usa `sueldoMensual/30` SIN redondear en el paso intermedio, mismo criterio que Vacación/
 * Aguinaldo (CA3/CA4) — solo se redondea el monto final.
 */
export function calcularIndemnizacion(
    sueldoMensual: number,
    sector: SectorEconomico | null,
    fechaRetiro: string,
    aniosServicioFraccional: number,
    tipoRetiro: TipoRetiro,
    porcentajeMutuoAcuerdo?: number,
): Indemnizacion {
    const porcentajeSegunTipoRetiro = calcularPorcentajeIndemnizacionPorRetiro(tipoRetiro, porcentajeMutuoAcuerdo);
    const salarioMinimoDiarioVigente = sector ? resolverSalarioMinimoDiarioVigente(sector, fechaRetiro) : null;

    if (!sector || salarioMinimoDiarioVigente === null) {
        return { estado: 'pendiente_definir', porcentajeSegunTipoRetiro, motivo: MOTIVO_INDEMNIZACION_SIN_SECTOR };
    }

    const salarioDiarioComputableSinRedondear = Math.min(sueldoMensual / 30, 4 * salarioMinimoDiarioVigente);
    const monto = round2(salarioDiarioComputableSinRedondear * 30 * aniosServicioFraccional * (porcentajeSegunTipoRetiro / 100));

    return {
        estado: 'confirmado',
        monto,
        porcentajeSegunTipoRetiro,
        salarioDiarioComputable: round2(salarioDiarioComputableSinRedondear),
        salarioMinimoDiarioVigente,
        aniosServicioFraccional,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// CA3 — Vacación Proporcional
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CA3 — período "de servicio actual" para Vacación: desde el último ANIVERSARIO de fecha_ingreso
 * hasta la fecha de retiro (nunca la antigüedad total: los años completos anteriores ya se
 * cubrieron en ciclos normales de planilla). Verificado contra el Excel real: ingreso 31-jul-2024,
 * salida 15-jun-2026 → período 31-jul-2025 → 15-jun-2026 = 320 días (no los 684 de antigüedad
 * total, que es lo que muestra la fila "DIAS" de la sección "FECHAS DE APLICACIÓN" — esa fila es
 * la antigüedad total usada para Indemnización, no el período de Vacación).
 */
export function calcularDiasPeriodoVacacionActual(fechaIngreso: string, fechaRetiro: string): number {
    const ingreso = parseFechaLocal(fechaIngreso);
    const retiro = parseFechaLocal(fechaRetiro);
    if (retiro < ingreso) return 0;

    let inicioPeriodo = new Date(retiro.getFullYear(), ingreso.getMonth(), ingreso.getDate());
    if (inicioPeriodo > retiro) {
        inicioPeriodo = new Date(retiro.getFullYear() - 1, ingreso.getMonth(), ingreso.getDate());
    }
    if (inicioPeriodo < ingreso) inicioPeriodo = ingreso;

    return diasInclusive(inicioPeriodo, retiro);
}

const DIAS_VACACION_ANUAL = 15;
const RECARGO_VACACIONAL = 1.3; // 30% de recargo/prima vacacional, Art. 177 CT.

/**
 * CA3 — Salario Diario × 15 días/año × (Días del período ÷ 365) × 1.30.
 *
 * OJO: usa `sueldoMensual` directamente (no el Salario Diario ya redondeado a 2 decimales que se
 * muestra en el reporte) — verificado contra el Excel real: con sueldo $476.00, el Salario Diario
 * MOSTRADO es $15.87 (476/30 redondeado), pero si se usa ESE valor redondeado en la fórmula da
 * $271.34, no los $271.25 reales. La hoja de cálculo de Imporfrut arrastra el valor sin redondear
 * (476/30 × 15 = 476/2 = $238.00 exacto) y solo redondea el resultado final. Esta es la ÚNICA
 * excepción al criterio general del motor ("redondear después de cada paso", ver `round2` en
 * calculoPlanillaUtils.ts) — se documenta acá porque diverge a propósito, no por descuido.
 */
export function calcularVacacionProporcional(sueldoMensual: number, diasPeriodoServicioActual: number): number {
    const salarioDiarioSinRedondear = sueldoMensual / 30;
    return round2(salarioDiarioSinRedondear * DIAS_VACACION_ANUAL * (diasPeriodoServicioActual / 365) * RECARGO_VACACIONAL);
}

// ─────────────────────────────────────────────────────────────────────────────
// CA4 — Aguinaldo Proporcional
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CA4 — período "de servicio actual" para Aguinaldo: Art. 198 CT usa un año de servicio FIJO en
 * el calendario, del 12 de diciembre al 11 de diciembre siguiente — NO el aniversario de ingreso
 * del empleado (a diferencia de Vacación, ver arriba). Verificado contra el Excel real: la MISMA
 * persona (ingreso 31-jul-2024) tiene período de Aguinaldo 12-dic-2025 → 15-jun-2026 = 186 días,
 * un corte de calendario totalmente distinto al de Vacación (31-jul-2025). Si el ingreso fue
 * después del último 12 de diciembre, el período arranca en fecha_ingreso (no se puede acreditar
 * antigüedad anterior a haber empezado a trabajar).
 */
export function calcularDiasPeriodoAguinaldoActual(fechaIngreso: string, fechaRetiro: string): number {
    const ingreso = parseFechaLocal(fechaIngreso);
    const retiro = parseFechaLocal(fechaRetiro);
    if (retiro < ingreso) return 0;

    let inicioPeriodo = new Date(retiro.getFullYear(), 11, 12); // 12 de diciembre del año de retiro
    if (inicioPeriodo > retiro) {
        inicioPeriodo = new Date(retiro.getFullYear() - 1, 11, 12);
    }
    if (inicioPeriodo < ingreso) inicioPeriodo = ingreso;

    return diasInclusive(inicioPeriodo, retiro);
}

/**
 * Antigüedad TOTAL en años completos (desde fecha_ingreso original, no desde el último
 * aniversario) — determina el tramo de días de aguinaldo (Art. 198) y se conserva en el
 * resultado para cuando el CA1 se resuelva (Indemnización también depende de la antigüedad
 * total, no del período parcial).
 */
export function calcularAniosAntiguedad(fechaIngreso: string, fechaRetiro: string): number {
    const ingreso = parseFechaLocal(fechaIngreso);
    const retiro = parseFechaLocal(fechaRetiro);
    if (retiro < ingreso) return 0;
    return Math.floor((retiro.getTime() - ingreso.getTime()) / MS_POR_DIA / 365);
}

/**
 * CA4 — Art. 198 CT, reformado por Decreto 399/2013: 1 a <3 años = 15 días; 3 a <10 años = 19
 * días; 10 años o más = 21 días ("diez años O MÁS" — 10 exactos ya califican). Menos de 1 año
 * NO es un tramo separado: Art. 197 dice que es "proporcional al año que se estaría por
 * completar", que es matemáticamente el mismo tramo de 15 días, no un valor distinto — por eso
 * se pliega en la misma rama que 1-<3 años.
 */
export function calcularDiasAguinaldoSegunAntiguedad(aniosAntiguedad: number): number {
    if (aniosAntiguedad >= 10) return 21;
    if (aniosAntiguedad >= 3) return 19;
    return 15;
}

/**
 * CA4 — Salario Diario × días-según-antigüedad × (Días del período ÷ 365). Misma nota que
 * Vacación: usa `sueldoMensual` sin redondear el Salario Diario intermedio, verificado contra el
 * mismo caso real ($121.28 con sueldo $476.00, 15 días de tabla, 186 días de período).
 */
export function calcularAguinaldoProporcional(sueldoMensual: number, diasAguinaldoSegunAntiguedad: number, diasPeriodoServicioActual: number): number {
    const salarioDiarioSinRedondear = sueldoMensual / 30;
    return round2(salarioDiarioSinRedondear * diasAguinaldoSegunAntiguedad * (diasPeriodoServicioActual / 365));
}

// ─────────────────────────────────────────────────────────────────────────────
// Quincena 25 Proporcional (integración con IMPL-14, confirmada por Imporfrut 2026-10-19)
// ─────────────────────────────────────────────────────────────────────────────

const DIAS_MAX_QUINCENA_25 = 365;
const TOPE_SUELDO_ELEGIBILIDAD_QUINCENA_25 = 1500;

export interface Quincena25ProporcionalConfirmada {
    estado: 'confirmado';
    monto: number;
    dias: number;
    /** `false` si `sueldoMensual` supera $1,500 — no es un tope sobre el monto, es un gate de
     * elegibilidad (ver `calcular_quincena_25_empleado` en SQL): por encima de ese sueldo, el
     * empleado no cobra nada, el monto queda en 0 real (no pendiente). */
    elegible: boolean;
}

/**
 * Integración Quincena 25 ↔ Liquidación Laboral (IMPL-14, confirmado por Imporfrut 2026-10-19 y
 * ampliado 2026-10-20): misma fórmula que el motor de enero (`calcular_quincena_25_empleado` en
 * SQL) — `0.5 × sueldo_mensual × MIN(días, 365) / 365` — pero con fecha de corte = `fechaRetiro`
 * en vez del 14 de enero (el empleado deja de acumular el día que se retira, no en una fecha fija
 * de calendario como el resto de los empleados activos). `días` es diferencia de calendario
 * SIMPLE (sin +1), mismo criterio que el motor SQL — a propósito distinto de `diasInclusive` que
 * usan Vacación/Aguinaldo arriba (esos SÍ son inclusivos, confirmado contra el Excel real de esa
 * épica; acá se mantiene la fórmula de Quincena 25 tal cual a Imporfrut la confirmó, sin mezclar
 * convenciones).
 *
 * Aplica a los 3 `tipoRetiro` (despido/renuncia/mutuo_acuerdo) — confirmado explícitamente por
 * Imporfrut 2026-10-20 ("¿esto aplica solo en el caso de despidos?" → "aplica en ambos casos"),
 * resolviendo el `pendiente_definir` que existía hasta ahora para Renuncia/Mutuo Acuerdo. Tiene
 * sentido con el resto de la respuesta: la Quincena 25 pasa a ser un beneficio legal obligatorio
 * desde enero de 2027, sin distinguir motivo de retiro — no es una regla especial de despido.
 */
export function calcularQuincena25Proporcional(
    sueldoMensual: number,
    fechaIngreso: string,
    fechaRetiro: string,
): Quincena25ProporcionalConfirmada {
    const ingreso = parseFechaLocal(fechaIngreso);
    const retiro = parseFechaLocal(fechaRetiro);
    const dias = Math.min(DIAS_MAX_QUINCENA_25, Math.max(0, Math.round((retiro.getTime() - ingreso.getTime()) / MS_POR_DIA)));

    if (sueldoMensual > TOPE_SUELDO_ELEGIBILIDAD_QUINCENA_25) {
        return { estado: 'confirmado', monto: 0, dias, elegible: false };
    }

    const monto = round2(0.5 * sueldoMensual * (dias / DIAS_MAX_QUINCENA_25));
    return { estado: 'confirmado', monto, dias, elegible: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// CA11 — Promedio Comisión: SIEMPRE $0, campo heredado sin cálculo real
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CA11 — campo heredado de una plantilla anterior. Imporfrut CONFIRMÓ que no maneja comisiones:
 * este SIEMPRE es $0.00 real e intencional (a diferencia de `calcularIndemnizacion`, que puede
 * quedar como TODO pendiente sin monto si falta el sector económico). Es una CONSTANTE, no una
 * función — no hay ningún dato de
 * entrada que pueda cambiarlo. Si algún día Imporfrut empieza a manejar comisiones, este campo
 * pasa a ser un cálculo real; hasta entonces es un cero de negocio, no un placeholder técnico.
 */
export const PROMEDIO_COMISION_6_MESES = 0;

// ─────────────────────────────────────────────────────────────────────────────
// CA10 — Partida Contable de Liquidación
// ─────────────────────────────────────────────────────────────────────────────

/** Catálogo de cuentas confirmado por Imporfrut para la partida de Liquidación (CA10). */
export const CUENTAS_LIQUIDACION = {
    salarios: '4-42-4203-01-001',
    horasExtras: '4-42-4203-01-003',
    vacacionProporcional: '2-21-2104-04-000',
    viaticos: '4-42-4203-11-002',
    aguinaldoProporcional: '2-21-2104-05-000',
    indemnizacion: '2-21-2104-01-000',
    cuotaPatronalIsss: '4-42-4201-02-001',
    cuotaPatronalAfp: '4-42-4201-02-002',
    insaforp: '4-42-4201-02-03',
    isssRetencionEmpleado: '2-21-2101-03-007',
    afpRetencionEmpleado: '2-21-2101-03-006',
    otrosDescuentos: '2-21-211-05',
    liquidacionPorPagar: '2-21-2101-03-031',
} as const;

export interface PartidaContableFila {
    concepto: string;
    cuenta: string;
    /** null = pendiente (SOLO la fila de Indemnización, mientras el CA1 no exista). */
    monto: number | null;
    pendiente?: boolean;
}

export interface PartidaContableLiquidacion {
    debe: PartidaContableFila[];
    haber: PartidaContableFila[];
    /** Suma del DEBE — incluye Indemnización cuando ya está calculada (CA1), 0 cuando está pendiente. */
    totalDebeConocido: number;
    /** Suma del HABER conocido (ISSS/AFP/Otros Descuentos), SIN el plug de Liquidación Por Pagar. */
    totalHaberConocido: number;
    /** Plug para que el HABER cuadre contra el DEBE conocido. */
    liquidacionPorPagar: number;
    /** `true` cuando la Indemnización ya tiene monto calculado (CA1 resuelto para este empleado);
     * `false` mientras siga `pendiente_definir` (falta configurar el sector económico). */
    cuadraCompleto: boolean;
    nota: string;
}

export interface PartidaContableLiquidacionInput {
    salariosPendientes: number;
    horasExtrasPendientes: number;
    viaticosPendientes: number;
    vacacionProporcional: number;
    aguinaldoProporcional: number;
    /** `null` = Indemnización pendiente (sin sector económico configurado); `number` = ya calculada. */
    indemnizacion: number | null;
    isssEmpleado: number;
    afpEmpleado: number;
    isssPatronal: number;
    afpPatronal: number;
    insaforpPatronal: number;
    otrosDescuentos: number;
    /** "AFP Crecer" | "AFP Confía" | "AFP" — ya resuelto contra `tipo_afiliacion` del empleado. */
    afpLabel: string;
}

const NOTA_PARTIDA_COMPLETA = 'La partida cuadra por completo — Indemnización incluida.';

const NOTA_PARTIDA_INCOMPLETA =
    'La partida NO puede cuadrar de forma definitiva mientras la Indemnización (CA1, Art. 58 CT) ' +
    'esté pendiente — falta configurar el sector económico en Datos Fiscales de la Empresa. Este ' +
    'es un estado esperado de este reporte, no un error del sistema. El monto de "Liquidación Por ' +
    'Pagar" mostrado EXCLUYE Indemnización y deberá recalcularse cuando se configure el sector.';

/**
 * CA10 — arma el DEBE/HABER de la partida contable de la liquidación. La fila de Indemnización
 * queda con `monto: null` SOLO si `input.indemnizacion` es `null` (nunca un $0 disimulado) — el
 * resto de las cuentas está confirmado por Imporfrut. "Salarios"/"Horas Extras"/"Viáticos" y las
 * cuotas patronales/retenciones NO se recalculan acá: son las que ya vienen calculadas y
 * persistidas por el motor de planilla (`ultimoCalculo`, ver `calcularLiquidacionLaboral`) — no
 * hay ninguna fórmula confirmada por Imporfrut para "cuánto ISSS/AFP corresponde sobre la
 * liquidación", así que no se inventa una.
 */
export function calcularPartidaContableLiquidacion(input: PartidaContableLiquidacionInput): PartidaContableLiquidacion {
    const indemnizacionCalculada = input.indemnizacion !== null;
    const debe: PartidaContableFila[] = [
        { concepto: 'Salarios', cuenta: CUENTAS_LIQUIDACION.salarios, monto: round2(input.salariosPendientes) },
        { concepto: 'Horas Extras', cuenta: CUENTAS_LIQUIDACION.horasExtras, monto: round2(input.horasExtrasPendientes) },
        { concepto: 'Vacación Proporcional', cuenta: CUENTAS_LIQUIDACION.vacacionProporcional, monto: round2(input.vacacionProporcional) },
        { concepto: 'Viáticos', cuenta: CUENTAS_LIQUIDACION.viaticos, monto: round2(input.viaticosPendientes) },
        { concepto: 'Aguinaldo Proporcional', cuenta: CUENTAS_LIQUIDACION.aguinaldoProporcional, monto: round2(input.aguinaldoProporcional) },
        {
            concepto: 'Indemnización', cuenta: CUENTAS_LIQUIDACION.indemnizacion,
            monto: indemnizacionCalculada ? round2(input.indemnizacion as number) : null,
            pendiente: !indemnizacionCalculada,
        },
        { concepto: 'Cuota Patronal ISSS', cuenta: CUENTAS_LIQUIDACION.cuotaPatronalIsss, monto: round2(input.isssPatronal) },
        { concepto: 'Cuota Patronal AFP', cuenta: CUENTAS_LIQUIDACION.cuotaPatronalAfp, monto: round2(input.afpPatronal) },
        { concepto: 'INSAFORP', cuenta: CUENTAS_LIQUIDACION.insaforp, monto: round2(input.insaforpPatronal) },
    ];
    const totalDebeConocido = round2(debe.reduce((acc, f) => acc + (f.monto ?? 0), 0));

    const haber: PartidaContableFila[] = [
        { concepto: 'ISSS — Retención Empleado', cuenta: CUENTAS_LIQUIDACION.isssRetencionEmpleado, monto: round2(input.isssEmpleado) },
        { concepto: `${input.afpLabel} — Retención Empleado`, cuenta: CUENTAS_LIQUIDACION.afpRetencionEmpleado, monto: round2(input.afpEmpleado) },
    ];
    if (input.otrosDescuentos > 0) {
        haber.push({ concepto: 'Otros Descuentos', cuenta: CUENTAS_LIQUIDACION.otrosDescuentos, monto: round2(input.otrosDescuentos) });
    }
    const totalHaberConocido = round2(haber.reduce((acc, f) => acc + (f.monto ?? 0), 0));

    // Plug: lo que falta para que el HABER cuadre contra el DEBE conocido.
    const liquidacionPorPagar = round2(totalDebeConocido - totalHaberConocido);
    haber.push({ concepto: 'Liquidación Por Pagar', cuenta: CUENTAS_LIQUIDACION.liquidacionPorPagar, monto: liquidacionPorPagar });

    return {
        debe,
        haber,
        totalDebeConocido,
        totalHaberConocido,
        liquidacionPorPagar,
        cuadraCompleto: indemnizacionCalculada,
        nota: indemnizacionCalculada ? NOTA_PARTIDA_COMPLETA : NOTA_PARTIDA_INCOMPLETA,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Selección del último cálculo persistido antes de la fecha de retiro
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca el snapshot de `planilla_calculo_empleado` de la quincena más reciente CERRADA/CALCULADA
 * antes (o en) la fecha de retiro — de ahí salen Salarios/Horas Extras/Viáticos/ISSS/AFP/cuotas
 * patronales pendientes (CA10), reutilizando datos YA auditados por el motor de planilla en vez
 * de recalcular nada nuevo, mismo criterio que `constanciaRetencionesUtils.ts`/`reciboSueldoUtils.ts`.
 */
export function seleccionarUltimoCalculoAntesDe(
    quincenas: Pick<Quincena, 'id' | 'fecha_inicio'>[],
    calculosEmpleado: CalculoEmpleado[],
    fechaRetiro: string,
): CalculoEmpleado | null {
    const quincenasElegibles = quincenas
        .filter((q) => q.fecha_inicio <= fechaRetiro)
        .sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio));

    for (const quincena of quincenasElegibles) {
        const calculo = calculosEmpleado.find((c) => c.quincena_id === quincena.id);
        if (calculo) return calculo;
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agregador principal
// ─────────────────────────────────────────────────────────────────────────────

export interface SolicitudPagoLiquidacion {
    /** Fecha de emisión del documento (hoy), formato YYYY-MM-DD. */
    fechaSolicitud: string;
    bancoEmisor: string;
    beneficiario: string;
    /** = `totalLiquidacionParcial` — ver nota ahí: incluye Indemnización solo si ya está calculada. */
    monto: number;
    metodoPago: MetodoPago;
    observaciones: string;
    /** SIEMPRE '' — el número de transferencia/cheque se asigna y se llena a mano después, el
     * sistema nunca lo genera (CA9). */
    numeroAsignado: string;
}

export interface LiquidacionLaboralInput {
    empleado: Pick<Empleado, 'nombre_completo' | 'fecha_ingreso' | 'sueldo_mensual' | 'tipo_afiliacion'>;
    fechaRetiro: string;
    tipoRetiro: TipoRetiro;
    porcentajeMutuoAcuerdo?: number;
    metodoPago: MetodoPago;
    bancoEmisor: string;
    observaciones?: string;
    /** Sector económico de la empresa (Datos Fiscales) — determina el tope de Indemnización
     * (CA1). `null` si todavía no se configuró: la Indemnización queda `pendiente_definir`. */
    sectorEconomico: SectorEconomico | null;
    /** Snapshot ya calculado de la última quincena trabajada antes del retiro (ver
     * `seleccionarUltimoCalculoAntesDe`) — `null` si el empleado se retira sin ningún cálculo
     * procesado todavía (edge case: todos los campos que dependen de esto quedan en 0). */
    ultimoCalculo: CalculoEmpleado | null;
    /** Inyectable para tests, mismo criterio que el resto de los reportes de este módulo. */
    ahora?: Date;
}

export interface LiquidacionLaboralDatos {
    nombreEmpleado: string;
    fechaIngreso: string;
    fechaRetiro: string;
    tipoRetiro: TipoRetiro;
    porcentajeIndemnizacion: number;

    diasPeriodoVacacion: number;
    vacacionProporcional: number;

    aniosAntiguedad: number;
    diasAguinaldoSegunAntiguedad: number;
    diasPeriodoAguinaldo: number;
    aguinaldoProporcional: number;

    /** IMPL-14 (2026-10-19, ampliado 2026-10-20) — aplica a los 3 tipos de retiro. Su monto SÍ
     * está incluido en `totalLiquidacionParcial` y en `solicitudPago.monto` (es plata real que se
     * le debe al empleado) — pero TODAVÍA NO está reflejado en `partidaContable` (falta que
     * Imporfrut confirme la cuenta contable real, ver `CUENTAS_LIQUIDACION` — no se inventa un
     * código de cuenta). */
    quincena25Proporcional: Quincena25ProporcionalConfirmada;

    /** CA11 — SIEMPRE 0, ver `PROMEDIO_COMISION_6_MESES`. */
    promedioComision6Meses: number;

    /** CA1 — calculado si hay sector económico configurado, pendiente si no. */
    indemnizacion: Indemnizacion;

    salariosPendientes: number;
    horasExtrasPendientes: number;
    viaticosPendientes: number;
    isssEmpleado: number;
    afpEmpleado: number;
    afpLabel: string;
    isssPatronal: number;
    afpPatronal: number;
    insaforpPatronal: number;
    otrosDescuentos: number;

    /** = `partidaContable.liquidacionPorPagar` + Quincena 25 Proporcional (si ya está confirmada,
     * IMPL-14) — Salarios + Horas Extras + Viáticos + Vacación Proporcional + Aguinaldo
     * Proporcional + Indemnización (si ya está calculada) + Quincena 25 Proporcional (si ya está
     * confirmada) − ISSS − AFP − Otros Descuentos. Quincena 25 se suma ACÁ, fuera de
     * `calcularPartidaContableLiquidacion`, porque es plata real que se le debe al empleado
     * (tiene que estar en el total a pagar) aunque todavía no tenga cuenta contable real para
     * aparecer en la Partida Contable (ver nota en `quincena25Proporcional` arriba). Sigue siendo
     * explícitamente PARCIAL mientras `indemnizacion.estado` sea `'pendiente_definir'` (ver
     * `partidaContable.cuadraCompleto`) — CA9. */
    totalLiquidacionParcial: number;

    solicitudPago: SolicitudPagoLiquidacion;
    partidaContable: PartidaContableLiquidacion;
}

function resolverAfpLabel(tipoAfiliacion: Empleado['tipo_afiliacion']): string {
    const columna = mapAfpColumna(tipoAfiliacion);
    if (columna === 'crecer') return 'AFP Crecer';
    if (columna === 'confia') return 'AFP Confía';
    return 'AFP';
}

/**
 * Arma el DTO completo de la Liquidación Laboral (US-EXP-08, IMPL-161) con TODO lo que tiene
 * fórmula/dato confirmado (CA2/CA3/CA4/CA9/CA10/CA11) y la Indemnización (CA1) como TODO
 * explícito. Un solo cálculo alimenta las 3 secciones del PDF (Liquidación, Solicitud de Pago,
 * Partida Contable) — decisión de diseño: CA9 dice que la Solicitud comparte el mismo cálculo
 * base que CA10 ("no se generan por separado"), así que no tiene sentido computarlo dos veces.
 */
export function calcularLiquidacionLaboral(input: LiquidacionLaboralInput): LiquidacionLaboralDatos {
    const sueldoMensual = input.empleado.sueldo_mensual ?? 0;

    const diasPeriodoVacacion = calcularDiasPeriodoVacacionActual(input.empleado.fecha_ingreso, input.fechaRetiro);
    const vacacionProporcional = calcularVacacionProporcional(sueldoMensual, diasPeriodoVacacion);

    const aniosAntiguedad = calcularAniosAntiguedad(input.empleado.fecha_ingreso, input.fechaRetiro);
    const diasAguinaldoSegunAntiguedad = calcularDiasAguinaldoSegunAntiguedad(aniosAntiguedad);
    const diasPeriodoAguinaldo = calcularDiasPeriodoAguinaldoActual(input.empleado.fecha_ingreso, input.fechaRetiro);
    const aguinaldoProporcional = calcularAguinaldoProporcional(sueldoMensual, diasAguinaldoSegunAntiguedad, diasPeriodoAguinaldo);

    const porcentajeIndemnizacion = calcularPorcentajeIndemnizacionPorRetiro(input.tipoRetiro, input.porcentajeMutuoAcuerdo);
    const aniosServicioFraccional = calcularAniosServicioFraccional(input.empleado.fecha_ingreso, input.fechaRetiro);
    const indemnizacion = calcularIndemnizacion(
        sueldoMensual, input.sectorEconomico, input.fechaRetiro, aniosServicioFraccional, input.tipoRetiro, input.porcentajeMutuoAcuerdo,
    );
    const quincena25Proporcional = calcularQuincena25Proporcional(sueldoMensual, input.empleado.fecha_ingreso, input.fechaRetiro);
    const montoQuincena25 = quincena25Proporcional.monto;

    const calculo = input.ultimoCalculo;
    const salariosPendientes = calculo?.sueldo_proporcional ?? 0;
    const horasExtrasPendientes = calculo?.horas_extras_monto ?? 0;
    const viaticosPendientes = calculo?.viaticos_monto ?? 0;
    const isssEmpleado = calculo?.isss_empleado ?? 0;
    const afpEmpleado = calculo?.afp_empleado ?? 0;
    const isssPatronal = calculo?.isss_patronal ?? 0;
    const afpPatronal = calculo?.afp_patronal ?? 0;
    const insaforpPatronal = calculo?.insaforp_patronal ?? 0;
    const otrosDescuentos = calculo?.descuentos_no_obligatorios_aplicado ?? 0;
    const afpLabel = resolverAfpLabel(input.empleado.tipo_afiliacion);

    const partidaContable = calcularPartidaContableLiquidacion({
        salariosPendientes, horasExtrasPendientes, viaticosPendientes, vacacionProporcional, aguinaldoProporcional,
        indemnizacion: indemnizacion.estado === 'confirmado' ? indemnizacion.monto : null,
        isssEmpleado, afpEmpleado, isssPatronal, afpPatronal, insaforpPatronal, otrosDescuentos, afpLabel,
    });

    const ahora = input.ahora ?? new Date();
    const totalLiquidacionParcial = round2(partidaContable.liquidacionPorPagar + montoQuincena25);

    return {
        nombreEmpleado: input.empleado.nombre_completo,
        fechaIngreso: input.empleado.fecha_ingreso,
        fechaRetiro: input.fechaRetiro,
        tipoRetiro: input.tipoRetiro,
        porcentajeIndemnizacion,
        diasPeriodoVacacion,
        vacacionProporcional,
        aniosAntiguedad,
        diasAguinaldoSegunAntiguedad,
        diasPeriodoAguinaldo,
        aguinaldoProporcional,
        quincena25Proporcional,
        promedioComision6Meses: PROMEDIO_COMISION_6_MESES,
        indemnizacion,
        salariosPendientes,
        horasExtrasPendientes,
        viaticosPendientes,
        isssEmpleado,
        afpEmpleado,
        afpLabel,
        isssPatronal,
        afpPatronal,
        insaforpPatronal,
        otrosDescuentos,
        totalLiquidacionParcial,
        solicitudPago: {
            fechaSolicitud: ahora.toISOString().slice(0, 10),
            bancoEmisor: input.bancoEmisor,
            beneficiario: input.empleado.nombre_completo,
            monto: totalLiquidacionParcial,
            metodoPago: input.metodoPago,
            observaciones: input.observaciones ?? '',
            numeroAsignado: '',
        },
        partidaContable,
    };
}
