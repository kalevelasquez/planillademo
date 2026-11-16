/**
 * Mirror TS de los 16 pasos del motor de Cálculo de Planilla (US-CALC-04/IMPL-90). El SQL
 * (`calcular_planilla_empleado`, próximas migraciones) es la autoridad que persiste, pero esta
 * es la especificación ejecutable contra la que se valida — mismo criterio que
 * `vacacionesUtils.ts`/`descuentosUtils.ts`/etc. Redondeo a 2 decimales DESPUÉS de cada paso
 * (no solo al final), mismo patrón ya usado sin excepción en `crear_vacacion`/`crear_anticipo`/
 * `crear_descuento` — si el Excel real de Imporfrut redondea distinto, este es el primer
 * parámetro a ajustar.
 */

export type TipoAfiliacion = 'afp_crecer' | 'afp_confia' | 'upiss' | 'jubilado' | 'ipsfa' | null;

export interface ConfigFiscal {
    isssTasaEmpleado: number;
    isssTopeBase: number;
    afpTasaEmpleado: number;
    afpTopeBase: number | null;
    deduccionFijaAnual: number;
    deduccionFijaTopeIngresoAnual: number;
    bono10Tasa: number;
    topeDescuentosNoObligatoriosPct: number;
    salarioMinimoInembargable: number | null;
}

export interface TramoRenta {
    orden: number;
    desde: number;
    hasta: number | null;
    tasaPct: number;
    excesoSobre: number;
    montoFijo: number;
}

export interface SueldoBase {
    quincenal: number;
    porDia: number;
    porHora: number;
}

export interface DeduccionFijaResultado {
    aplica: boolean;
    monto: number;
    motivo: string;
}

export interface DescuentoItem {
    categoria: string;
    monto: number;
    prioridad: number;
    /** Ya no afecta el cálculo (ver `calcularDescuentosPeriodo`, corregido 2026-10-27) — el tope
     * del 20% es una validación al configurar la cuota de un préstamo (fuera de este mirror, en
     * `crear_descuento`/`actualizar_descuento`), no una distinción en tiempo de cálculo. Se deja
     * el campo por compatibilidad/clasificación, pero todo ítem se aplica completo sin importar
     * su `tipo`. */
    tipo?: 'fijo' | 'variable';
}

export interface DescuentosPeriodoResultado {
    obligatoriosTotal: number;
    noObligatoriosSolicitado: number;
    noObligatoriosAplicado: number;
    detalle: Array<DescuentoItem & { aplicado: number }>;
}

/**
 * Redondeo a 2 decimales. HALLAZGO (revisión historia por historia, caso real Manzo): la
 * multiplicación en punto flotante puede dejar un valor apenas por debajo del límite decimal real
 * (750*0.0725 da 54.37499999999999 en IEEE754, no 54.375) — Number.EPSILON es demasiado chico para
 * corregir ese error de representación, y el redondeo naive baja donde debería subir. Postgres
 * (tipo NUMERIC, decimal exacto) no tiene este problema, así que sin el `toPrecision` el mirror TS
 * podía divergir en centavos del SQL real justo en estos casos límite. `toPrecision(12)` limpia el
 * ruido de punto flotante de la operación anterior antes de redondear — de sobra para montos de
 * nómina, muy por debajo de donde 12 dígitos significativos dejarían de alcanzar.
 */
export function round2(valor: number): number {
    const limpio = Number(valor.toPrecision(12));
    return Math.round((limpio + Number.EPSILON) * 100) / 100;
}

/** Pasos 1 — US-CALC-00/IMPL-86. Siempre derivados, nunca campos editables independientes. */
export function calcularSueldoBase(sueldoMensual: number): SueldoBase {
    return {
        quincenal: round2(sueldoMensual / 2),
        porDia: round2(sueldoMensual / 30),
        porHora: round2(sueldoMensual / 240),
    };
}

/** Paso 2 — proración de días laborados (ver ambigüedad #5: solo prorratea altas contra
 * fecha_ingreso; bajas a mitad de quincena quedan fuera de alcance). */
export function calcularSueldoProporcional(sueldoQuincenal: number, diasLaborados: number, diasHabilesQuincena: number): number {
    return round2(sueldoQuincenal * (diasLaborados / diasHabilesQuincena));
}

/** Paso 8 — Total Ingresos Gravables. Los viáticos del Paso 4 quedan EXCLUIDOS a propósito. */
export function calcularIngresosGravables(input: {
    sueldoProporcional: number;
    horasExtras: number;
    vacaciones: number;
    bonificaciones: number;
    otrosIngresosGravables: number;
}): number {
    return round2(
        input.sueldoProporcional + input.horasExtras + input.vacaciones + input.bonificaciones + input.otrosIngresosGravables
    );
}

/** Paso 9 — ISSS Empleado = MIN(Total Gravable, tope) × tasa. */
export function calcularISSS(totalGravable: number, config: ConfigFiscal): number {
    const base = Math.min(totalGravable, config.isssTopeBase);
    return round2(base * config.isssTasaEmpleado);
}

/**
 * Paso 10 — AFP Empleado. Sin tope desde 2023 (`afpTopeBase = null`). IMPL-4 CA3: un empleado
 * `jubilado` ya no cotiza a su fondo de pensiones — se excluye de AFP. Confirmado que esto NO
 * aplica a ISSS (sigue cotizando salud mientras trabaja); el propio CA de Jira dejaba esto ⏳
 * pendiente de confirmar, resuelto acá.
 */
export function calcularAFP(totalGravable: number, config: ConfigFiscal, tipoAfiliacion?: TipoAfiliacion): number {
    if (tipoAfiliacion === 'jubilado') return 0;
    const base = config.afpTopeBase != null ? Math.min(totalGravable, config.afpTopeBase) : totalGravable;
    return round2(base * config.afpTasaEmpleado);
}

/**
 * Paso 11 (parte) — deducción fija Art. 29-7 Ley ISR (IMPL-88 CA2/CA5, defecto IMPL-175
 * corregido 2026-09-22). La evaluación es POR QUINCENA, contra el ingreso gravable REAL de esa
 * quincena específica (sueldo proporcional + horas extra + bonificaciones + otros gravables,
 * antes de restar ISSS/AFP) — nunca contra el sueldo mensual contractual proyectado a un año.
 * CA5 lo aclara sin lugar a duda: el ingreso gravable "varía quincena a quincena (horas extra,
 * bonificaciones)", lo cual solo tiene sentido si el criterio es el ingreso real de esa quincena
 * puntual, no el sueldo base fijo (que nunca cambia de una quincena a otra). El umbral
 * quincenal se deriva del tope anual configurado (`deduccionFijaTopeIngresoAnual` / 24, mismo
 * patrón que ya usa el monto de $66.67 = deduccionFijaAnual / 24) — no hay un campo separado
 * para el valor quincenal, es una única fuente de verdad.
 */
export function calcularDeduccionFija(ingresoGravableQuincena: number, config: ConfigFiscal): DeduccionFijaResultado {
    const topeQuincenal = round2(config.deduccionFijaTopeIngresoAnual / 24);
    const aplica = ingresoGravableQuincena <= topeQuincenal;
    const monto = aplica ? round2(config.deduccionFijaAnual / 24) : 0;
    const motivo = aplica
        ? `Ingreso gravable de la quincena $${ingresoGravableQuincena.toFixed(2)} <= tope $${topeQuincenal.toFixed(2)} — IMPL-88 CA2/CA5`
        : `Ingreso gravable de la quincena $${ingresoGravableQuincena.toFixed(2)} > tope $${topeQuincenal.toFixed(2)} — IMPL-88 CA2/CA5`;
    return { aplica, monto, motivo };
}

/** Paso 11 — Base Renta = Total Gravable − ISSS − AFP − Deducción Fija (si aplica). */
export function calcularBaseRenta(totalGravable: number, isss: number, afp: number, deduccionFija: number): number {
    return round2(Math.max(0, totalGravable - isss - afp - deduccionFija));
}

/** Paso 12 — Renta ISR sobre la Base Renta, según la tabla de tramos vigente. Reutilizada por
 * Aguinaldo (IMPL-96) con otra base (excedente de $1,500). */
export function calcularRentaISR(base: number, tramos: TramoRenta[]): number {
    if (base <= 0) return 0;
    // Bugfix (auditoría): un tramo sin coincidencia devuelve 0, igual que `fn_calcular_renta_isr`
    // en SQL (`IF NOT FOUND THEN RETURN 0`) — antes caía al tramo MÁS ALTO (30%) como fallback,
    // divergiendo del motor real ante una mala configuración de tramos (gap entre desde/hasta).
    const tramo = tramos.find((t) => base >= t.desde && (t.hasta === null || base <= t.hasta));
    if (!tramo) return 0;
    return round2(Math.max(0, base - tramo.excesoSobre) * tramo.tasaPct + tramo.montoFijo);
}

/**
 * Paso 13 — Renta ISR sobre "Bono 10%" (US-CALC-05/IMPL-91). Línea SEPARADA, nunca se mezcla con
 * el Paso 12 ni participa en su base. `baseBono10Total` se agrega de varias fuentes: viático
 * GG con retención especial, vacaciones no gozadas (incluye el adelanto de recargo 30% por
 * aniversario — mismo tratamiento de honorarios, ver Paso 5b en el SQL), incapacidad trabajada,
 * y otros ingresos marcados bono_10 — gap ya documentado de leer de tablas separadas.
 */
export function calcularRentaBono10(baseBono10Total: number, config: ConfigFiscal): number {
    return round2(baseBono10Total * config.bono10Tasa);
}

/**
 * Paso 14 — Descuentos (US-CALC-09/IMPL-95, corregido 2026-10-27 — ver migración
 * `20261027090000_tope_20_es_validacion_prestamo_no_diferimiento.sql`). Imporfrut confirmó, con un
 * ejemplo numérico puntual: "el tope del 20% en descuentos es un límite legal para préstamos:
 * las cuotas por préstamos con bancos o instituciones financieras... no pueden rebasar el 20% del
 * salario. Los descuentos como lentes, anticipos, etc., no son considerados dentro de esta regla;
 * se descuentan tal y como se acuerdan con el empleado." Verificado contra el caso real Manzo
 * (Préstamo $106.52 = 14.2% de su sueldo + Vivienda $115.05 = 15.34%, cada uno individualmente
 * bajo el 20% aunque sumados dan 29.5%) — el tope es POR PRÉSTAMO, nunca agregado, y se valida al
 * configurar la cuota (`crear_descuento`/`actualizar_descuento`), no en este cálculo. Por lo
 * tanto: TODO ítem activo (obligatorio o no) se aplica completo, siempre, sin excepción — no hay
 * ningún presupuesto que calcular ni nada que diferir.
 */
export function calcularDescuentosPeriodo(
    itemsObligatorios: DescuentoItem[],
    itemsNoObligatorios: DescuentoItem[],
): DescuentosPeriodoResultado {
    const obligatoriosTotal = round2(itemsObligatorios.reduce((sum, i) => sum + i.monto, 0));
    const ordenados = [...itemsNoObligatorios].sort((a, b) => a.prioridad - b.prioridad);

    const aplicado = round2(ordenados.reduce((sum, i) => sum + i.monto, 0));
    const detalle: DescuentosPeriodoResultado['detalle'] = ordenados.map((item) => ({ ...item, aplicado: item.monto }));

    return {
        obligatoriosTotal,
        noObligatoriosSolicitado: aplicado,
        noObligatoriosAplicado: aplicado,
        detalle,
    };
}

/** Paso 16 — NETO A PAGAR. */
export function calcularNetoAPagar(
    totalGravable: number,
    totalNoGravable: number,
    isss: number,
    afp: number,
    rentaIsr: number,
    rentaBono10: number,
    descuentosAplicados: number
): number {
    return round2(totalGravable + totalNoGravable - isss - afp - rentaIsr - rentaBono10 - descuentosAplicados);
}

export interface CalculoPlanillaInput {
    sueldoMensual: number;
    diasLaborados: number;
    diasHabilesQuincena: number;
    horasExtras: number;
    viaticos: number;
    vacaciones: number;
    bonificaciones: number;
    otrosIngresosGravables: number;
    otrosIngresosNoGravables: number;
    baseBono10Total: number;
    descuentosObligatorios: DescuentoItem[];
    descuentosNoObligatorios: DescuentoItem[];
    config: ConfigFiscal;
    tramosRenta: TramoRenta[];
    tipoAfiliacion?: TipoAfiliacion;
}

export interface CalculoPlanillaResultado {
    sueldoBase: SueldoBase;
    sueldoProporcional: number;
    totalIngresosGravables: number;
    totalNoGravable: number;
    isss: number;
    afp: number;
    deduccionFija: DeduccionFijaResultado;
    baseRenta: number;
    rentaIsr: number;
    rentaBono10: number;
    descuentos: DescuentosPeriodoResultado;
    netoAPagar: number;
}

/** Orquestador completo — compone los 16 pasos, usado por los tests de los 3 casos reales
 * (Manzo/Solorzano/Batres). */
export function calcularPlanillaCompleta(input: CalculoPlanillaInput): CalculoPlanillaResultado {
    const sueldoBase = calcularSueldoBase(input.sueldoMensual);
    const sueldoProporcional = calcularSueldoProporcional(sueldoBase.quincenal, input.diasLaborados, input.diasHabilesQuincena);

    const totalIngresosGravables = calcularIngresosGravables({
        sueldoProporcional,
        horasExtras: input.horasExtras,
        vacaciones: input.vacaciones,
        bonificaciones: input.bonificaciones,
        otrosIngresosGravables: input.otrosIngresosGravables,
    });

    const isss = calcularISSS(totalIngresosGravables, input.config);
    const afp = calcularAFP(totalIngresosGravables, input.config, input.tipoAfiliacion);
    const deduccionFija = calcularDeduccionFija(totalIngresosGravables, input.config);
    const baseRenta = calcularBaseRenta(totalIngresosGravables, isss, afp, deduccionFija.monto);
    const rentaIsr = calcularRentaISR(baseRenta, input.tramosRenta);
    const rentaBono10 = calcularRentaBono10(input.baseBono10Total, input.config);

    const totalNoGravable = round2(input.viaticos + input.otrosIngresosNoGravables);

    const descuentos = calcularDescuentosPeriodo(input.descuentosObligatorios, input.descuentosNoObligatorios);

    const netoAPagar = calcularNetoAPagar(
        totalIngresosGravables,
        totalNoGravable,
        isss,
        afp,
        rentaIsr,
        rentaBono10,
        descuentos.noObligatoriosAplicado
    );

    return {
        sueldoBase,
        sueldoProporcional,
        totalIngresosGravables,
        totalNoGravable,
        isss,
        afp,
        deduccionFija,
        baseRenta,
        rentaIsr,
        rentaBono10,
        descuentos,
        netoAPagar,
    };
}
