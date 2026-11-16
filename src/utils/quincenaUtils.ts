export type TipoQuincena = 'normal' | 'aguinaldo' | 'quincena_25';

export const TIPO_QUINCENA_LABEL: Record<TipoQuincena, string> = {
    normal: 'Normal',
    aguinaldo: 'Aguinaldo',
    quincena_25: 'Quincena 25',
};

const MESES_ES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function parseDate(iso: string): Date {
    return new Date(`${iso}T00:00:00`);
}

function toIsoDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ultimoDiaDelMes(anio: number, mes0: number): number {
    return new Date(anio, mes0 + 1, 0).getDate();
}

/**
 * Días hábiles (Lunes-Sábado, excluyendo feriados) entre dos fechas, inclusive. Domingo no
 * es laborable según el DRN. `feriados` son fechas ISO (YYYY-MM-DD) del catálogo IMPL-15
 * (RESUELTO en revisión épica por épica — antes no descontaba feriados porque ese catálogo
 * no existía cuando se escribió esta función).
 */
export function calcularDiasHabiles(fechaInicio: string, fechaFin: string, feriados: string[] = []): number {
    const inicio = parseDate(fechaInicio);
    const fin = parseDate(fechaFin);
    if (fin < inicio) return 0;

    const feriadosSet = new Set(feriados);
    let dias = 0;
    const cursor = new Date(inicio);
    while (cursor <= fin) {
        if (cursor.getDay() !== 0 && !feriadosSet.has(toIsoDate(cursor))) dias++; // 0 = domingo
        cursor.setDate(cursor.getDate() + 1);
    }
    return dias;
}

interface QuincenaComparable {
    id: string;
    tipo: TipoQuincena;
    fecha_inicio: string;
}

/**
 * Encuentra la quincena inmediatamente anterior del MISMO tipo (por `fecha_inicio` más
 * reciente que sea estrictamente anterior a la actual) — usado para el comparativo de
 * IMPL-10 CA2 (revisión épica por épica, post-IMPL-85). No existía ningún concepto de
 * "quincena anterior" en el proyecto hasta ahora.
 */
export function encontrarQuincenaAnterior<T extends QuincenaComparable>(quincenas: T[], actual: T): T | null {
    return quincenas
        .filter((q) => q.tipo === actual.tipo && q.fecha_inicio < actual.fecha_inicio)
        .sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio))[0] ?? null;
}

interface QuincenaActivable {
    fecha_inicio: string;
    estado: string;
}

/**
 * Encuentra la quincena "activa" — la más reciente cuyo período ya comenzó
 * (`fecha_inicio <= hoy`) y que no esté Aprobada y Cerrada. El filtro por fecha es
 * necesario porque toda quincena nace en estado 'en_proceso': sin él, crear una quincena
 * futura por adelantado desplazaría a la que realmente está en curso en las 7+ pantallas
 * que dependían de este criterio (antes duplicado a mano en cada una).
 */
export function encontrarQuincenaActiva<T extends QuincenaActivable>(quincenas: T[]): T | undefined {
    const hoy = new Date().toISOString().slice(0, 10);
    return [...quincenas]
        .filter((q) => q.fecha_inicio <= hoy)
        .sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio))
        .find((q) => q.estado !== 'aprobada_cerrada');
}

/**
 * IMPL-134 (Observación General UAT) — advertencia no bloqueante cuando una fecha capturada
 * cae fuera del rango de la quincena que se está calculando. Generaliza el mismo criterio que
 * ya existía puntualmente para la Captura por IA de Viáticos por Ruta (US-VIA-02 CA2): solo
 * avisa, nunca impide guardar. `undefined` en cualquiera de los 3 argumentos significa "sin
 * datos suficientes para validar" (nunca advierte por datos faltantes).
 */
export function fechaFueraDeQuincena(fecha: string | undefined, quincenaFechaInicio: string | undefined, quincenaFechaFin: string | undefined): boolean {
    if (!fecha || !quincenaFechaInicio || !quincenaFechaFin) return false;
    return fecha < quincenaFechaInicio || fecha > quincenaFechaFin;
}

/**
 * "# Empleados" a mostrar: el conteo real de empleados vinculados (post-Cálculo de Planilla)
 * cuando existe, con el proxy de "activos totales" como fallback mientras el cálculo no corrió.
 * Mismo criterio duplicado a mano en Preparador/Aprobador/Detalle/Historial — centralizado acá
 * (7ma pasada QA, hallazgo MINOR #7).
 */
export function resolverEmpleadosCount(vinculados: number, activos: number | null | undefined): number | string {
    return vinculados > 0 ? vinculados : (activos ?? '—');
}

export interface RangoQuincenal {
    periodo: '1ra' | '2da';
    mes0: number; // 0-indexado, para MESES_ES
    anio: number;
}

/**
 * Detecta si un rango de fechas calza limpiamente con la 1ra quincena (día 1-15) o la
 * 2da quincena (día 16-fin de mes) de un mes calendario. Devuelve null si no calza —
 * caso borde que dispara la advertencia de CA4 (US-QNA-01), en vez de asumir silenciosamente.
 */
export function detectarRangoQuincenal(fechaInicio: string, fechaFin: string): RangoQuincenal | null {
    const inicio = parseDate(fechaInicio);
    const fin = parseDate(fechaFin);

    const mismoMes = inicio.getFullYear() === fin.getFullYear() && inicio.getMonth() === fin.getMonth();
    if (!mismoMes) return null;

    const anio = inicio.getFullYear();
    const mes0 = inicio.getMonth();

    if (inicio.getDate() === 1 && fin.getDate() === 15) {
        return { periodo: '1ra', mes0, anio };
    }
    if (inicio.getDate() === 16 && fin.getDate() === ultimoDiaDelMes(anio, mes0)) {
        return { periodo: '2da', mes0, anio };
    }
    return null;
}

export interface EtiquetaEstandarResult {
    etiqueta: string | null;
    /** true si el rango no calzó limpiamente y hace falta que el usuario confirme o ajuste (CA4). */
    advertencia: boolean;
}

/**
 * Genera la etiqueta estándar no editable (CA3 de US-QNA-01). Para tipo 'normal', si el
 * rango no corresponde limpiamente a 1-15 o 16-fin de mes, devuelve advertencia=true y
 * etiqueta=null en vez de generar una etiqueta incorrecta o fallar silenciosamente (CA4).
 */
export function generarEtiquetaEstandar(tipo: TipoQuincena, fechaInicio: string, fechaFin: string): EtiquetaEstandarResult {
    if (!fechaInicio || !fechaFin) return { etiqueta: null, advertencia: false };

    if (tipo === 'aguinaldo') {
        const anio = parseDate(fechaInicio).getFullYear();
        return { etiqueta: `Aguinaldo ${anio}`, advertencia: false };
    }

    if (tipo === 'quincena_25') {
        const anio = parseDate(fechaInicio).getFullYear();
        return { etiqueta: `Quincena 25 ${anio}`, advertencia: false };
    }

    const rango = detectarRangoQuincenal(fechaInicio, fechaFin);
    if (!rango) return { etiqueta: null, advertencia: true };

    const prefijo = rango.periodo === '1ra' ? '1ra Quincena de' : '2da Quincena de';
    return { etiqueta: `${prefijo} ${MESES_ES[rango.mes0]} ${rango.anio}`, advertencia: false };
}
