import type { Empleado } from '../services/planillaEmpleadosService';
import type { Quincena } from '../services/quincenasService';
import { round2 } from './calculoPlanillaUtils';
import { detectarRangoQuincenal } from './quincenaUtils';

export interface ResolucionInstitucionPrevisional {
    institucionPrevisional: 'MAX' | 'COF' | 'ISS' | '';
    codigoObservacion2: string | null;
}

/**
 * IMPL-99 (US-EXP-01) — mapeo de `tipo_afiliacion` a la columna "Institución Previsional" y al
 * "Código de observación 2" de la Planilla Única ISSS/AFP.
 *
 * CONFIRMADO por Imporfrut (2026-09-21) — basado en evidencia real de
 * `docs/formatos-reportes/1.12 Planilla SSF.xlsx` y validado contra la muestra observada:
 * - `upiss` → `ISS`, sin código (caso real: Margarita Urbina, fila 31).
 * - `jubilado` → mantiene el AFP de origen, + código `04` (2 casos observados con AFP distinta
 *   cada uno, ambos con código 04 — patrón consistente, catálogo de códigos de observación
 *   confirmado por Imporfrut, ver comentario Jira 2026-09-18).
 * - `ipsfa` → institución vacía, + código `13` (caso real: Oscar Orlando Reyes, fila 64 —
 *   confirmado como regla general, no coincidencia puntual).
 *
 * `afpOrigenJubilado` debe reconstruirse desde el audit log de cambios de `tipo_afiliacion`
 * (mismo patrón que `resolverSueldoVigenteEnFecha` en `reciboSueldoUtils.ts` para IMPL-158) —
 * `tipo_afiliacion` no preserva el AFP anterior una vez que pasa a `'jubilado'`. Esa integración
 * con el audit log todavía no está hecha (no hay reporte/hook que use esta función todavía).
 */
export function resolverInstitucionPrevisionalPlanillaUnica(
    tipoAfiliacion: Empleado['tipo_afiliacion'],
    afpOrigenJubilado: 'afp_crecer' | 'afp_confia' | null,
): ResolucionInstitucionPrevisional {
    switch (tipoAfiliacion) {
        case 'afp_crecer':
            return { institucionPrevisional: 'MAX', codigoObservacion2: null };
        case 'afp_confia':
            return { institucionPrevisional: 'COF', codigoObservacion2: null };
        case 'upiss':
            return { institucionPrevisional: 'ISS', codigoObservacion2: null };
        case 'jubilado':
            return {
                institucionPrevisional: afpOrigenJubilado === 'afp_crecer' ? 'MAX' : afpOrigenJubilado === 'afp_confia' ? 'COF' : '',
                codigoObservacion2: '04',
            };
        case 'ipsfa':
            return { institucionPrevisional: '', codigoObservacion2: '13' };
        default:
            return { institucionPrevisional: '', codigoObservacion2: null };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Valores fijos confirmados por Imporfrut (CA3b) o sin variación evidenciada
// ─────────────────────────────────────────────────────────────────────────────

/** CA3b — valor estándar fijo exigido por el formato del portal, no lo define Imporfrut, no
 * varía por Ubicación/Sucursal. Confirmado contra las 128 filas del archivo real, sin excepción. */
export const CORRELATIVO_CENTRO_TRABAJO = '001';

/** CA1 col.6 — el sistema hoy no distingue DUI de pasaporte (no hay ningún empleado extranjero
 * evidenciado ni campo que lo indique); se deja fijo en '01' (DUI) hasta que aparezca un caso
 * real que lo contradiga. */
export const TIPO_DOCUMENTO_DUI = '01';

/** CA1 col.18 — jornada estándar por día, mismo criterio que el Correlativo: no hay evidencia de
 * horarios variables por empleado en ningún módulo del sistema. */
export const HORAS_JORNADA_ESTANDAR = '08';

/** CA1 col.5 — el archivo exige el DUI sin guiones ("02697943-9" → "026979439"). */
export function limpiarDui(dui: string | null): string {
    return (dui ?? '').replace(/-/g, '');
}

/** CA1 col.3 — Periodo en formato MM+AAAA (ej. junio 2026 → "062026"). */
export function formatearPeriodoPlanillaUnica(mes0: number, anio: number): string {
    return `${String(mes0 + 1).padStart(2, '0')}${anio}`;
}

/** CA1 col.17 — "Días" son los días CALENDARIO del mes (ej. 30), no días laborados. */
export function calcularDiasCalendarioMes(mes0: number, anio: number): number {
    return new Date(anio, mes0 + 1, 0).getDate();
}

// ─────────────────────────────────────────────────────────────────────────────
// CA1 — detección de "mes completo" (ambas quincenas normales del mes, cerradas)
// ─────────────────────────────────────────────────────────────────────────────

export interface EstadoMesCompletoPlanillaUnica {
    habilitado: boolean;
    motivo: string;
    primeraQuincenaId?: string;
    segundaQuincenaId?: string;
    mes0?: number;
    anio?: number;
}

type QuincenaMesCompleto = Pick<Quincena, 'id' | 'tipo' | 'fecha_inicio' | 'fecha_fin' | 'estado'>;

/**
 * CA1/CA4 — habilita la Planilla Única SOLO cuando la quincena actual es la 2da quincena normal
 * del mes Y su hermana (1ra quincena normal, mismo mes/año) también existe y ambas están
 * `aprobada_cerrada`. No existía ninguna primitiva de "mes completo" en el proyecto — se
 * construye sobre `detectarRangoQuincenal` (ya usado para el mismo propósito en
 * `BonificacionesView.tsx`, IMPL-74 CA3), sin duplicar su lógica de fechas.
 */
export function resolverMesCompletoPlanillaUnica(
    quincenaActual: QuincenaMesCompleto,
    todasLasQuincenas: QuincenaMesCompleto[],
): EstadoMesCompletoPlanillaUnica {
    if (quincenaActual.tipo !== 'normal') {
        return { habilitado: false, motivo: 'La Planilla Única solo aplica a quincenas normales (no Aguinaldo/Quincena 25).' };
    }

    const rangoActual = detectarRangoQuincenal(quincenaActual.fecha_inicio, quincenaActual.fecha_fin);
    if (!rangoActual || rangoActual.periodo !== '2da') {
        return { habilitado: false, motivo: 'Solo se habilita al cerrar la 2da quincena del mes.' };
    }

    const primera = todasLasQuincenas.find((q) => {
        if (q.tipo !== 'normal') return false;
        const rango = detectarRangoQuincenal(q.fecha_inicio, q.fecha_fin);
        return rango?.periodo === '1ra' && rango.mes0 === rangoActual.mes0 && rango.anio === rangoActual.anio;
    });
    if (!primera) {
        return { habilitado: false, motivo: 'Falta la 1ra quincena del mes — no se puede consolidar sin ella.' };
    }

    if (primera.estado !== 'aprobada_cerrada' || quincenaActual.estado !== 'aprobada_cerrada') {
        return { habilitado: false, motivo: 'Ambas quincenas del mes deben estar Aprobadas y Cerradas.' };
    }

    return {
        habilitado: true,
        motivo: '',
        primeraQuincenaId: primera.id,
        segundaQuincenaId: quincenaActual.id,
        mes0: rangoActual.mes0,
        anio: rangoActual.anio,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// CA1 — armado de filas (21 columnas), incluyendo repetición por código de observación múltiple
// ─────────────────────────────────────────────────────────────────────────────

export interface EmpleadoPlanillaUnicaInput {
    id: string;
    nombreCompleto: string;
    dui: string | null;
    fechaIngreso: string;
    tipoAfiliacion: Empleado['tipo_afiliacion'];
    numeroAfiliadoIsss: string | null;
    /** Ver gotcha en `resolverInstitucionPrevisionalPlanillaUnica` — hoy siempre `null` porque la
     * reconstrucción vía audit log todavía no está construida; institución queda vacía para
     * jubilados hasta que exista. */
    afpOrigenJubilado: 'afp_crecer' | 'afp_confia' | null;
}

/** Agregado de vacaciones del empleado que se solapan con el mes — `montoTotal` incluye TODAS
 * (gozadas y no_gozadas, ambas se pagan); `diasGozados` excluye `no_gozada` (esos días no fueron
 * una ausencia real, ver `vacacionesService.getActivasPorEmpleados`). */
export interface AgregadoVacacionesMesEmpleado {
    montoTotal: number;
    diasGozados: number;
}

export interface DatosEmpleadoMesPlanillaUnica {
    /** `total_ingresos_gravables` de cada quincena del mes en que el empleado tuvo cálculo (0, 1
     * o 2 elementos) — "Salario" es la suma, mismo campo que ya usan los topes de ISSS/AFP
     * (`exportacionesContablesService`), consistente con "el salario ya calculado completo,
     * incluye todo lo variable" (CA3a, confirmado por Imporfrut). */
    totalIngresosGravablesPorQuincena: number[];
    vacacionesDelMes: AgregadoVacacionesMesEmpleado;
    /** Solapa con el mes en `planilla_incapacidades` (código 06). */
    tieneIncapacidadEsteMes: boolean;
}

export interface FilaPlanillaUnica {
    nitDuiEmpleador: string;
    numeroPatronalIsss: string;
    periodo: string;
    correlativoCentroTrabajo: string;
    numeroDocumentoAfiliado: string;
    tipoDocumentoAfiliado: string;
    numeroIsssAfiliado: string;
    institucionPrevisional: string;
    /** Columnas 9-13 — SIEMPRE vacías: el sistema solo guarda `nombre_completo` como un único
     * string. Partirlo automáticamente por espacios produciría datos incorrectos con apellidos
     * compuestos reales, y "apellido de casada" es un dato legal que no existe en ningún lado del
     * modelo — no se inventa, queda en blanco con aviso visible en la UI (decisión explícita del
     * usuario, 2026-09-21). */
    primerNombre: string;
    segundoNombre: string;
    primerApellido: string;
    segundoApellido: string;
    apellidoCasada: string;
    salario: number;
    /** Columna 15 — SIEMPRE vacía: no hay una definición confirmada de qué monto va acá (CA3a
     * confirmó que "Salario" ya incluye horas extra/variables, así que "Pago adicional" no puede
     * ser lo mismo sin duplicar el monto; no se adivina cuál es). */
    pagoAdicional: string;
    montoVacacion: number;
    dias: number;
    horas: string;
    diasVacacion: number;
    /** Fijo en '01' ("sin cambios respecto al mes anterior") — no hay evidencia en el archivo de
     * referencia de que esta columna tome otro valor; los códigos de estado/evento (04/06/08/09/13)
     * se observaron siempre en la columna 21, nunca en la 20. */
    codigoObservacion1: string;
    codigoObservacion2: string;
}

/**
 * CA1 — arma las filas de UN empleado para el mes. Genera una fila por cada código de
 * observación aplicable (columna 21) — mismo patrón ya usado para incapacidades en
 * `exportacionesContablesService.generarFilasIsss` (Map código→lista + loop, repite todos los
 * demás campos). Prioridad de códigos: el que depende de `tipo_afiliacion` (04 pensionado / 13
 * ipsfa, vía `resolverInstitucionPrevisionalPlanillaUnica`) primero, luego 08 (nuevo ingreso este
 * mes), luego 06 (incapacidad), luego 09 (vacaciones/pago de vacaciones). Si ninguno aplica,
 * una sola fila con columna 21 vacía (columna 20 ya dice "01 sin cambios").
 *
 * Códigos 02 (pagos adicionales), 05 (licencia), 07 (retiro), 10 (combinación >2), 12 (subsidios
 * ISSS) NO se detectan — no existe hoy ninguna fuente de datos para ellos (07, por ejemplo, no
 * tiene ninguna tabla persistida de retiros; Liquidación Laboral solo captura `fechaRetiro` en el
 * momento de generar ese reporte, no se guarda en `planilla_empleados`).
 */
export function armarFilasEmpleadoPlanillaUnica(
    empleado: EmpleadoPlanillaUnicaInput,
    empresa: { nitDuiEmpleador: string; numeroPatronalIsss: string },
    periodo: { mes0: number; anio: number; fechaInicioMes: string; fechaFinMes: string },
    datosMes: DatosEmpleadoMesPlanillaUnica,
): FilaPlanillaUnica[] {
    const { institucionPrevisional, codigoObservacion2: codigoTipoAfiliacion } = resolverInstitucionPrevisionalPlanillaUnica(
        empleado.tipoAfiliacion, empleado.afpOrigenJubilado,
    );

    const codigos: string[] = [];
    if (codigoTipoAfiliacion) codigos.push(codigoTipoAfiliacion);
    if (empleado.fechaIngreso >= periodo.fechaInicioMes && empleado.fechaIngreso <= periodo.fechaFinMes) codigos.push('08');
    if (datosMes.tieneIncapacidadEsteMes) codigos.push('06');
    if (datosMes.vacacionesDelMes.montoTotal > 0) codigos.push('09');

    const salario = round2(datosMes.totalIngresosGravablesPorQuincena.reduce((acc, v) => acc + v, 0));
    const base: Omit<FilaPlanillaUnica, 'codigoObservacion2'> = {
        nitDuiEmpleador: empresa.nitDuiEmpleador,
        numeroPatronalIsss: empresa.numeroPatronalIsss,
        periodo: formatearPeriodoPlanillaUnica(periodo.mes0, periodo.anio),
        correlativoCentroTrabajo: CORRELATIVO_CENTRO_TRABAJO,
        numeroDocumentoAfiliado: limpiarDui(empleado.dui),
        tipoDocumentoAfiliado: TIPO_DOCUMENTO_DUI,
        numeroIsssAfiliado: empleado.numeroAfiliadoIsss ?? '',
        institucionPrevisional,
        primerNombre: '', segundoNombre: '', primerApellido: '', segundoApellido: '', apellidoCasada: '',
        salario,
        pagoAdicional: '',
        montoVacacion: round2(datosMes.vacacionesDelMes.montoTotal),
        dias: calcularDiasCalendarioMes(periodo.mes0, periodo.anio),
        horas: HORAS_JORNADA_ESTANDAR,
        diasVacacion: datosMes.vacacionesDelMes.diasGozados,
        codigoObservacion1: '01',
    };

    if (codigos.length === 0) return [{ ...base, codigoObservacion2: '' }];
    return codigos.map((codigo) => ({ ...base, codigoObservacion2: codigo }));
}
