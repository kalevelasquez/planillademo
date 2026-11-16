import type { Empleado } from '../services/planillaEmpleadosService';
import type { CalculoEmpleado } from '../services/calculoPlanillaService';
import type { HorasExtrasManualRow } from '../services/horasExtrasManualService';
import type { Descuento } from '../services/descuentosService';
import type { DescuentoCategoria } from '../services/descuentoCategoriasService';
import type { Quincena } from '../services/quincenasService';
import { normalizarTexto } from './fuzzyMatchUtils';
import { INSTITUCIONES_VIVIENDA } from './descuentosPivotUtils';
import { TARIFA_HED, TARIFA_HEN, TARIFA_NOCTURNIDAD_ORDINARIA, TARIFA_FERIADO_DIURNO, valorHora } from './horasExtrasUtils';

export type ColumnaAfp = 'confia' | 'crecer' | 'ipsfa' | 'upiss' | null;

/** A qué columna del Recibo va `CalculoEmpleado.afp_empleado` (US-EXP-05 CA1). `jubilado`/`null`
 * no tienen columna propia — trivial, `afp_empleado` ya es 0 por regla de negocio del motor. */
export function mapAfpColumna(tipoAfiliacion: Empleado['tipo_afiliacion']): ColumnaAfp {
    if (tipoAfiliacion === 'afp_confia') return 'confia';
    if (tipoAfiliacion === 'afp_crecer') return 'crecer';
    if (tipoAfiliacion === 'ipsfa') return 'ipsfa';
    if (tipoAfiliacion === 'upiss') return 'upiss';
    return null;
}

export type ColumnaDescuentoRecibo = 'financieras' | 'fsv' | 'habitat' | 'anticipo' | 'lentes' | 'factura' | 'uniforme' | null;

const CATEGORIAS_FINANCIERAS_RECIBO = ['Préstamo bancario', 'Financiera', 'Vehículo'];
const CATEGORIAS_FACTURA = ['Factura de producto', 'Descuento compra producto'];
const CATEGORIAS_UNIFORME = ['Uniforme', 'Calzado y Uniformes'];
const ANTICIPO_LITERAL = 'Anticipo de salario';

/**
 * Clasifica un descuento hacia su columna del Recibo de Sueldo (US-EXP-05 CA1/CA4). A diferencia
 * de `clasificarDescuento` (descuentosPivotUtils.ts, para el pivote de IMPL-167 con una columna
 * por banco), acá el Recibo solo necesita un total "FINANCIERAS" — no importa qué banco
 * específico. Categorías sin fila propia en el `.docx` real (Faltante de caja, Permiso sin goce,
 * Procuraduría, Reintegro de viaje, categoría catálogo 'Anticipos', etc.) devuelven `null`: su
 * monto sigue contando en TOTAL DESCUENTOS (que se toma de la fuente ya auditada del motor), pero
 * no tienen línea propia — decisión confirmada con el usuario, fiel al formato real entregado.
 */
export function clasificarDescuentoRecibo(categoriaNombre: string, institucion: string | null): ColumnaDescuentoRecibo {
    const normalizada = normalizarTexto(categoriaNombre);

    if (CATEGORIAS_FINANCIERAS_RECIBO.some((c) => normalizarTexto(c) === normalizada)) return 'financieras';

    if (normalizada === normalizarTexto('Vivienda')) {
        if (institucion && normalizarTexto(institucion) === normalizarTexto(INSTITUCIONES_VIVIENDA[1])) return 'fsv'; // Fondo Social para la Vivienda
        if (institucion && normalizarTexto(institucion) === normalizarTexto(INSTITUCIONES_VIVIENDA[0])) return 'habitat'; // Habitad para la Humanidad
        return null;
    }

    if (normalizada === normalizarTexto(ANTICIPO_LITERAL)) return 'anticipo';
    if (normalizada === normalizarTexto('Lentes')) return 'lentes';
    if (CATEGORIAS_FACTURA.some((c) => normalizarTexto(c) === normalizada)) return 'factura';
    if (CATEGORIAS_UNIFORME.some((c) => normalizarTexto(c) === normalizada)) return 'uniforme';

    return null;
}

export interface EdicionSueldo {
    /** Timestamp ISO de cuándo se registró el cambio (`audit_log.created_at`). */
    created_at: string;
    anterior: number;
    nuevo: number;
}

/**
 * Reconstruye el sueldo mensual que estaba VIGENTE en una fecha específica, a partir del
 * historial de auditoría `EDICION_SUELDO` (IMPL-158, hallazgo UAT del 2026-09-11) — el desglose
 * de horas extra del Recibo de Sueldo debe usar el sueldo vigente EN esa quincena, no el sueldo
 * actual del empleado: si hubo un aumento/ajuste después de esa quincena, usar el sueldo actual
 * da un desglose que no cuadra contra `horas_extras_monto` ya auditado de esa quincena.
 *
 * Una edición registrada el MISMO día que `fechaReferencia` cuenta como ya vigente para esa
 * fecha (se compara contra el fin de ese día, no la medianoche) — evita que una quincena que
 * cerró el mismo día del cambio de sueldo quede excluida por unas horas de diferencia horaria.
 */
export function resolverSueldoVigenteEnFecha(
    sueldoActual: number,
    edicionesSueldo: EdicionSueldo[],
    fechaReferencia: string,
): number {
    if (edicionesSueldo.length === 0) return sueldoActual;

    const finDiaReferencia = new Date(`${fechaReferencia}T23:59:59.999`).getTime();
    const ordenadas = [...edicionesSueldo].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    let vigente: number | null = null;
    for (const edicion of ordenadas) {
        if (new Date(edicion.created_at).getTime() > finDiaReferencia) break;
        vigente = edicion.nuevo;
    }
    // Si ninguna edición ocurrió antes/en la fecha de referencia, la más antigua ya es posterior
    // a esa fecha — el sueldo vigente ahí es el "anterior" de esa primera edición.
    return vigente ?? ordenadas[0].anterior;
}

export interface DesgloseHorasExtras {
    horasExtrasCantidad: number;
    horasExtrasMonto: number;
    nocturnidadMonto: number;
    feriadoMonto: number;
    heFeriadoMonto: number;
}

/** Recalcula el desglose en $ por concepto de horas extra (US-EXP-05 CA1) — el sistema nunca
 * persistió este desglose, solo un monto total agregado + las cantidades de horas. Usa las
 * tarifas ya definidas y el sueldo ACTUAL del empleado (decisión confirmada con el usuario):
 * más preciso conceptualmente, aunque si el sueldo cambió desde esa quincena el desglose podría
 * no sumar exacto contra `horas_extras_monto` ya auditado de esa quincena. `HE FERIADO` siempre
 * en $0 — el esquema actual no distingue "feriado normal" de "hora extra trabajada en feriado". */
export function calcularHorasExtrasDesglose(rows: HorasExtrasManualRow[], sueldoMensual: number): DesgloseHorasExtras {
    const totales = rows.reduce(
        (acc, r) => ({ hed: acc.hed + r.hed, hen: acc.hen + r.hen, nocturnidad: acc.nocturnidad + r.nocturnidad, feriado: acc.feriado + r.feriado }),
        { hed: 0, hen: 0, nocturnidad: 0, feriado: 0 },
    );
    const valorHoraCalc = valorHora(sueldoMensual);

    return {
        horasExtrasCantidad: totales.hed + totales.hen,
        horasExtrasMonto: (totales.hed * TARIFA_HED + totales.hen * TARIFA_HEN) * valorHoraCalc,
        nocturnidadMonto: totales.nocturnidad * TARIFA_NOCTURNIDAD_ORDINARIA * valorHoraCalc,
        feriadoMonto: totales.feriado * TARIFA_FERIADO_DIURNO * valorHoraCalc,
        heFeriadoMonto: 0,
    };
}

export interface ReciboSueldoDatos {
    codigoEmpleado: string;
    nombreEmpleado: string;
    cargo: string;
    diasTrabajados: number;
    quincenaNombre: string;
    sueldo: number;
    vacaciones: number;
    bono: number;
    viaticos: number;
    horasExtrasCantidad: number;
    horasExtrasMonto: number;
    nocturnidad: number;
    feriado: number;
    heFeriado: number;
    totalIngresos: number;
    isss: number;
    afpConfia: number;
    afpCrecer: number;
    ipsfa: number;
    upiss: number;
    isrBonificacion: number;
    isrSalario: number;
    financieras: number;
    fsv: number;
    habitat: number;
    anticipo: number;
    lentes: number;
    factura: number;
    uniforme: number;
    totalDescuentos: number;
    totalARecibir: number;
}

/** Arma el DTO completo de un Recibo de Sueldo (US-EXP-05, IMPL-158). Sirve para el modo
 * individual y para cada empleado del modo masivo — no recalcula ISSS/AFP/Renta/Neto (vienen ya
 * auditados de `CalculoEmpleado`), solo el desglose de horas extra (ver arriba) y la
 * clasificación de descuentos por institución.
 *
 * `edicionesSueldo` (hallazgo UAT, IMPL-158): historial de `EDICION_SUELDO` del empleado — el
 * desglose de horas extra usa el sueldo VIGENTE en `quincena.fecha_fin`, no `sueldo_mensual`
 * actual, para no desalinearse si el sueldo cambió después de esa quincena. Vacío por defecto
 * (empleado sin ediciones registradas) — en ese caso el sueldo actual y el vigente coinciden. */
export function calcularReciboSueldoDatos(
    empleado: Pick<Empleado, 'codigo_empleado_manual' | 'codigo' | 'nombre_completo' | 'cargo' | 'sueldo_mensual' | 'tipo_afiliacion'>,
    calculo: CalculoEmpleado,
    horasRows: HorasExtrasManualRow[],
    descuentosEmpleado: Descuento[],
    categorias: DescuentoCategoria[],
    quincena: Pick<Quincena, 'nombre' | 'fecha_fin'>,
    edicionesSueldo: EdicionSueldo[] = [],
): ReciboSueldoDatos {
    const sueldoVigenteEnQuincena = resolverSueldoVigenteEnFecha(empleado.sueldo_mensual ?? 0, edicionesSueldo, quincena.fecha_fin);
    const desgloseHoras = calcularHorasExtrasDesglose(horasRows, sueldoVigenteEnQuincena);

    const categoriasPorId = new Map(categorias.map((c) => [c.id, c]));
    const columnasDescuento: Record<Exclude<ColumnaDescuentoRecibo, null>, number> = {
        financieras: 0, fsv: 0, habitat: 0, anticipo: 0, lentes: 0, factura: 0, uniforme: 0,
    };
    for (const detalle of calculo.descuentos_detalle) {
        // La institución (banco/FSV/Habitat) no vive en el snapshot — se resuelve contra los
        // descuentos reales del empleado que matcheen la misma categoría.
        const descuentoReal = descuentosEmpleado.find((d) => categoriasPorId.get(d.categoria_id)?.nombre === detalle.categoria);
        const columna = clasificarDescuentoRecibo(detalle.categoria, descuentoReal?.institucion ?? null);
        if (columna) columnasDescuento[columna] += detalle.aplicado;
    }

    const columnaAfp = mapAfpColumna(empleado.tipo_afiliacion);
    const afpConfia = columnaAfp === 'confia' ? calculo.afp_empleado : 0;
    const afpCrecer = columnaAfp === 'crecer' ? calculo.afp_empleado : 0;
    const ipsfa = columnaAfp === 'ipsfa' ? calculo.afp_empleado : 0;
    const upiss = columnaAfp === 'upiss' ? calculo.afp_empleado : 0;

    const totalIngresos = calculo.sueldo_proporcional + calculo.vacaciones_monto + calculo.bonificaciones_monto + calculo.viaticos_monto
        + desgloseHoras.horasExtrasMonto + desgloseHoras.nocturnidadMonto + desgloseHoras.feriadoMonto + desgloseHoras.heFeriadoMonto;

    return {
        codigoEmpleado: empleado.codigo_empleado_manual ?? empleado.codigo,
        nombreEmpleado: empleado.nombre_completo,
        cargo: empleado.cargo ?? '—',
        diasTrabajados: calculo.dias_laborados,
        quincenaNombre: quincena.nombre,
        sueldo: calculo.sueldo_proporcional,
        vacaciones: calculo.vacaciones_monto,
        bono: calculo.bonificaciones_monto,
        viaticos: calculo.viaticos_monto,
        horasExtrasCantidad: desgloseHoras.horasExtrasCantidad,
        horasExtrasMonto: desgloseHoras.horasExtrasMonto,
        nocturnidad: desgloseHoras.nocturnidadMonto,
        feriado: desgloseHoras.feriadoMonto,
        heFeriado: desgloseHoras.heFeriadoMonto,
        totalIngresos,
        isss: calculo.isss_empleado,
        afpConfia,
        afpCrecer,
        ipsfa,
        upiss,
        isrBonificacion: calculo.renta_bono10,
        isrSalario: calculo.renta_isr,
        financieras: columnasDescuento.financieras,
        fsv: columnasDescuento.fsv,
        habitat: columnasDescuento.habitat,
        anticipo: columnasDescuento.anticipo,
        lentes: columnasDescuento.lentes,
        factura: columnasDescuento.factura,
        uniforme: columnasDescuento.uniforme,
        totalDescuentos: calculo.descuentos_obligatorios_total + calculo.descuentos_no_obligatorios_aplicado,
        totalARecibir: calculo.neto_a_pagar,
    };
}
