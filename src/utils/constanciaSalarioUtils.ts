import type { Quincena } from '../services/quincenasService';
import type { CalculoEmpleado } from '../services/calculoPlanillaService';
import type { Descuento } from '../services/descuentosService';
import type { DescuentoCategoria } from '../services/descuentoCategoriasService';
import { normalizarTexto } from './fuzzyMatchUtils';
import { round2, calcularRentaISR, type ConfigFiscal, type TramoRenta } from './calculoPlanillaUtils';

const CATEGORIAS_FINANCIERAS = ['Préstamo bancario', 'Financiera'];
const CATEGORIA_VIVIENDA = 'Vivienda';

/**
 * Quincenas elegibles para la Constancia de Salario (IMPL-182) — un solo selector, usado en las
 * TRES consultas del reporte (ventana de promedios, "últimas dos" para retenciones, y quincena
 * más reciente para el viático fijo). Antes cada una asumía implícitamente su propio criterio
 * (`tipo === 'normal'` nada más): no excluía quincenas `en_proceso`/`enviada_aprobacion`/
 * `reabierta` (datos que todavía pueden cambiar), ni quincenas anteriores a la fecha de ingreso
 * del empleado — lo que dejaba entrar datos de prueba clonados en un período anterior (IMPL-169)
 * para cualquier empleado que ya trabajara ahí en esa fecha.
 *
 * Una quincena es elegible si:
 * - `tipo === 'normal'` (aguinaldo/quincena_25 no son parte del salario ordinario)
 * - `estado === 'aprobada_cerrada'` (el único estado que ya no puede cambiar)
 * - `fecha_inicio >= fechaIngresoEmpleado` (el empleado no podía tener actividad real antes de
 *   existir en la empresa)
 * - `!es_prueba` (IMPL-187 — quincenas clon de un año anterior creadas para pruebas de UAT,
 *   ej. IMPL-169, nunca deben contar como actividad real del empleado)
 *
 * `deleted_at IS NULL` no se repite acá — `quincenasService.getQuincenas()` ya lo filtra en la
 * consulta.
 */
export function seleccionarQuincenasElegibles(quincenas: Quincena[], fechaIngresoEmpleado: string): Quincena[] {
    return quincenas
        .filter((q) => q.tipo === 'normal' && q.estado === 'aprobada_cerrada' && q.fecha_inicio >= fechaIngresoEmpleado && !q.es_prueba)
        .sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio))
        .slice(0, 12);
}

export interface FilaInstitucionMonto { institucion: string; monto: number }

/**
 * Descuentos no obligatorios ACTIVOS de una categoría (IMPL-185 — recomendación de Teknergy,
 * PROVISIONAL hasta que Imporfrut/Gilda confirme el criterio de negocio):
 *
 * Antes se sumaba `descuentos_detalle` (snapshot histórico de las 2 últimas quincenas ya
 * calculadas) — ese snapshot no trae el campo `estado`, así que un descuento CANCELADO seguía
 * sumando su monto ahí aunque `resolverInstitucion` (que sí filtraba `estado === 'activo'`) ya no
 * le encontrara institución. Resultado real (caso Hernán Osorio, DF-001/Banco Cuscatlán): "$100.00"
 * junto a un nombre de institución vacío.
 *
 * Ahora se lee DIRECTO de `planilla_descuentos` (vía `descuentosService.getPorEmpleado`, ya
 * cargado por el hook) filtrando `estado === 'activo'` — un préstamo cancelado deja de aparecer
 * por completo, monto e institución siempre salen del mismo registro (nunca más desalineados,
 * IMPL-183 CA5), y cada institución activa de la categoría genera su propio renglón con su propio
 * monto (IMPL-183 CA3) en vez de una sola cifra combinada.
 *
 * `monto_quincenal × 2` — la constancia declara un ingreso MENSUAL integrado (mismo criterio que
 * IMPL-186 para el viático fijo); `planilla_descuentos.monto_quincenal` está registrado por
 * quincena.
 */
function resolverFilasDescuentoActivoPorCategoria(
    descuentosEmpleado: Descuento[],
    categorias: DescuentoCategoria[],
    nombresCategoria: string[],
): FilaInstitucionMonto[] {
    const idsCategoria = new Set(
        categorias.filter((c) => nombresCategoria.some((n) => normalizarTexto(n) === normalizarTexto(c.nombre))).map((c) => c.id),
    );
    return descuentosEmpleado
        .filter((d) => idsCategoria.has(d.categoria_id) && d.estado === 'activo')
        .map((d) => ({ institucion: d.institucion ?? '', monto: round2(d.monto_quincenal * 2) }));
}

export interface ConstanciaSalarioDatos {
    nombreCompleto: string;
    cargo: string;
    fechaIngreso: string;
    sueldoBase: number;
    bonificacionPromedio: number;
    horasExtrasPromedio: number;
    viaticos: number;
    totalIngresos: number;
    isss: number;
    afp: number;
    descuentosFinancieros: FilaInstitucionMonto[];
    isrSueldo: number;
    isrViaticos: number;
    isrBonificacion: number;
    descuentosVivienda: FilaInstitucionMonto[];
    totalDeducciones: number;
}

/**
 * Arma el DTO completo de la Constancia de Salario (US-EXP-04, IMPL-157 CA1-CA3).
 *
 * IMPL-184 (recomendación de Teknergy, Opción A — PROVISIONAL hasta confirmar con Imporfrut/
 * Gilda): ISSS/AFP/Renta sobre Sueldo YA NO son la suma de retenciones reales de las últimas 2
 * quincenas (que podían venir de una base gravable distinta a la que muestra la tabla de
 * Ingresos — ej. incluían Vacaciones gravables que la constancia nunca mostraba como ingreso).
 * Ahora se RECALCULAN teóricamente sobre los mismos ingresos gravables que ya se muestran
 * (sueldo + bonificación promedio + horas extra promedio — viáticos queda afuera porque no es
 * gravable, mismo criterio que `v_total_gravable` en el motor real), para que el documento
 * cuadre internamente. ISSS/AFP son tasas planas — se aplican directo sobre la base MENSUAL con
 * el tope mensual (tope quincenal × 2). Renta ISR es progresiva y la única tabla de tramos que
 * existe es quincenal (`planilla_renta_tramos`) — se calcula sobre la base quincenal (mensual/2)
 * y el resultado se duplica para expresarlo como mensual (NO existe una tabla de tramos mensual
 * en el sistema).
 *
 * IMPL-184 CA7-CA9 (ampliación 2026-09-28; corregido 2026-10-20 tras confirmar con Imporfrut):
 * si el empleado tiene `retencion_especial_viatico`, el ISR sobre viáticos se recalcula igual que
 * ISSS/AFP/ISR-sueldo, pero la base NO es el total de viáticos mostrado en Ingresos (fijo +
 * variable) — Imporfrut confirmó que el 10% se aplica SOLO al viático FIJO de gerencia, el resto
 * (ruta/kilometraje) nunca paga esa retención. Se promedia `viaticos_bono10_base` (la misma
 * columna que el motor real ya calcula correctamente — Paso 4 de `calcular_planilla_empleado`
 * solo suma ahí los registros `tipo='fijo'`), NO `viaticos_monto` — antes de esta corrección se
 * usaba el total, sobrestimando la retención para cualquier empleado con viático variable además
 * del fijo. Reemplaza a `isrBonificacion` para ese empleado (no se suman los dos: en el motor
 * real, `viaticos_bono10_base` ya es una de las piezas que arma `base_bono10_total`/`renta_bono10`
 * junto con vacaciones no gozadas/bonificaciones/otros ingresos bono10 — sumar ambos renglones
 * duplicaría la parte de viáticos). Limitación conocida (documentada en el propio ticket, CA10):
 * si el mismo empleado tuviera ADEMÁS otro ingreso bono10 real (ej. una bonificación con
 * retención propia), esa parte no tiene hoy una columna separada en el motor de la que
 * recalcularse — el campo hoy solo aplica a Gerencia General, así que el caso combinado no se da
 * en la práctica.
 *
 * `isrBonificacion` (Renta sobre Bono 10%) sigue como suma real de las últimas 2 quincenas SOLO
 * para empleados SIN retención especial de viático.
 */
export function calcularConstanciaSalarioDatos(
    empleado: { nombre_completo: string; cargo: string | null; fecha_ingreso: string; sueldo_mensual: number | null; retencion_especial_viatico: boolean },
    calculosEnVentana: CalculoEmpleado[],
    descuentosEmpleado: Descuento[],
    categorias: DescuentoCategoria[],
    configFiscal: ConfigFiscal,
    tramosRenta: TramoRenta[],
): ConstanciaSalarioDatos {
    const mesesEncontrados = Math.max(1, calculosEnVentana.length / 2);
    const promediar = (valores: number[]) => valores.reduce((acc, v) => acc + v, 0) / mesesEncontrados;

    const bonificacionPromedio = promediar(calculosEnVentana.map((c) => c.bonificaciones_monto));
    const horasExtrasPromedio = promediar(calculosEnVentana.map((c) => c.horas_extras_monto));

    // IMPL-186 (reabierto 2026-09-28) — se elimina el tratamiento especial del viático fijo
    // ("quincena más reciente × 2"): un fijo puede registrarse por quincena O una sola vez al mes
    // según cómo lo carga Imporfrut (ej. "Viático Fijo Mensual" de Rina Manzo, una fila al mes, vs.
    // "Viático por gasolina quincenal" de Hernán, una fila por quincena) — no hay un campo que
    // distinga la periodicidad, así que ninguna regla que privilegie una quincena puntual funciona
    // para ambos casos. Se promedia TODO viaticos_monto (fijo + variable, ya consolidado por el
    // motor) sobre la ventana, igual que bonificaciones y horas extra — independiente de la
    // periodicidad de carga.
    const viaticos = promediar(calculosEnVentana.map((c) => c.viaticos_monto));

    const sueldoBase = empleado.sueldo_mensual ?? 0;
    const totalIngresos = sueldoBase + bonificacionPromedio + horasExtrasPromedio + viaticos;

    // IMPL-184 — base gravable MENSUAL mostrada (excluye viáticos, no gravables — mismo criterio
    // que v_total_gravable del motor real).
    const baseGravableMensual = round2(sueldoBase + bonificacionPromedio + horasExtrasPromedio);

    const topeIsssMensual = round2(configFiscal.isssTopeBase * 2);
    const isss = round2(Math.min(baseGravableMensual, topeIsssMensual) * configFiscal.isssTasaEmpleado);

    const topeAfpMensual = configFiscal.afpTopeBase !== null ? round2(configFiscal.afpTopeBase * 2) : null;
    const baseAfp = topeAfpMensual !== null ? Math.min(baseGravableMensual, topeAfpMensual) : baseGravableMensual;
    const afp = round2(baseAfp * configFiscal.afpTasaEmpleado);

    // Renta ISR — la única tabla de tramos vigente es quincenal: se calcula sobre la base
    // quincenal (mensual/2) y se duplica el resultado. No existe (ni debería inventarse) una
    // tabla de tramos "mensual" separada.
    const baseRentaMensual = Math.max(0, round2(baseGravableMensual - isss - afp));
    const baseRentaQuincenal = round2(baseRentaMensual / 2);
    const isrSueldo = round2(calcularRentaISR(baseRentaQuincenal, tramosRenta) * 2);

    // IMPL-184 CA7 — ISR sobre viáticos (retención 10%, DRN §9.3): 10% × SOLO el viático fijo de
    // gerencia (confirmado por Imporfrut 2026-10-20) — `viaticos_bono10_base`, no el total de
    // viáticos mostrado en Ingresos. CA8: si no tiene la retención especial activa, el renglón no
    // aparece (queda en 0, construirFilasDeduccionesConstanciaSalario ya oculta los renglones
    // opcionales en $0.00).
    const viaticosBono10Promedio = promediar(calculosEnVentana.map((c) => c.viaticos_bono10_base));
    const isrViaticos = empleado.retencion_especial_viatico ? round2(viaticosBono10Promedio * 0.10) : 0;

    // isrBonificacion (Renta sobre otro ingreso bono10, ej. vacaciones no gozadas) — suma real de
    // las últimas 2 quincenas SOLO para empleados SIN retención especial de viático; para los que
    // sí la tienen, isrViaticos (arriba) ya cubre esa plata sin duplicarla (ver comentario de la
    // función).
    const ultimasDos = calculosEnVentana.slice(0, 2);
    const isrBonificacion = empleado.retencion_especial_viatico ? 0 : ultimasDos.reduce((acc, c) => acc + c.renta_bono10, 0);

    const descuentosFinancieros = resolverFilasDescuentoActivoPorCategoria(descuentosEmpleado, categorias, CATEGORIAS_FINANCIERAS);
    const descuentosVivienda = resolverFilasDescuentoActivoPorCategoria(descuentosEmpleado, categorias, [CATEGORIA_VIVIENDA]);

    const totalDeducciones = round2(
        isss + afp + isrSueldo + isrViaticos + isrBonificacion
        + descuentosFinancieros.reduce((acc, d) => acc + d.monto, 0)
        + descuentosVivienda.reduce((acc, d) => acc + d.monto, 0),
    );

    return {
        nombreCompleto: empleado.nombre_completo,
        cargo: empleado.cargo ?? '—',
        fechaIngreso: empleado.fecha_ingreso,
        sueldoBase,
        bonificacionPromedio,
        horasExtrasPromedio,
        viaticos,
        totalIngresos,
        isss,
        afp,
        descuentosFinancieros,
        isrSueldo,
        isrViaticos,
        isrBonificacion,
        descuentosVivienda,
        totalDeducciones,
    };
}

export interface FilaConstanciaSalario { concepto: string; monto: number }

/** Filas de la tabla "Ingresos" — compartida entre PDF y DOCX (IMPL-183 CA6), para que ambos
 * formatos no puedan divergir por tener cada uno su propia lista hardcodeada. */
export function construirFilasIngresosConstanciaSalario(datos: ConstanciaSalarioDatos): FilaConstanciaSalario[] {
    return [
        { concepto: 'Sueldo base', monto: datos.sueldoBase },
        { concepto: 'Bonificación promedio', monto: datos.bonificacionPromedio },
        { concepto: 'Horas extras promedio', monto: datos.horasExtrasPromedio },
        { concepto: 'Viáticos', monto: datos.viaticos },
    ];
}

/**
 * Filas de la tabla "Deducciones" — compartida entre PDF y DOCX (IMPL-183 CA6).
 *
 * IMPL-183 CA1/CA2 — nunca se imprime el placeholder "(Nombre del Banco)"/"(Nombre de la
 * Institución)": si la institución no se pudo resolver, el renglón muestra solo el concepto
 * genérico, sin paréntesis vacíos ni texto de relleno.
 *
 * IMPL-183 CA3 — un renglón por institución activa, cada uno con su propio monto (ya no una
 * cifra combinada) — ver `resolverFilasDescuentoActivoPorCategoria` (IMPL-185).
 *
 * IMPL-183 CA4 — un renglón de deducción NO obligatoria (bancario, vivienda, Renta sobre
 * Bonificación) en $0.00 no se imprime; ISSS, AFP y Renta sobre Sueldo sí se imprimen siempre.
 */
export function construirFilasDeduccionesConstanciaSalario(datos: ConstanciaSalarioDatos): FilaConstanciaSalario[] {
    const filas: FilaConstanciaSalario[] = [
        { concepto: 'Instituto Salvadoreño del Seguro Social (ISSS)', monto: datos.isss },
        { concepto: 'Administradora de Fondos de Pensiones (AFP)', monto: datos.afp },
    ];
    for (const d of datos.descuentosFinancieros) {
        if (d.monto <= 0) continue;
        filas.push({ concepto: d.institucion ? `Descuento bancario: ${d.institucion}` : 'Descuento bancario', monto: d.monto });
    }
    filas.push({ concepto: 'Impuesto sobre la Renta – Sueldo', monto: datos.isrSueldo });
    // IMPL-184 CA10 — etiqueta propia para el ISR de viáticos, no reutiliza "Bonificación": son
    // dos orígenes distintos de retención 10%, cada uno con su propio renglón cuando aplica.
    if (datos.isrViaticos > 0) filas.push({ concepto: 'Impuesto sobre la Renta – Viáticos (retención 10%)', monto: datos.isrViaticos });
    if (datos.isrBonificacion > 0) filas.push({ concepto: 'Impuesto sobre la Renta – Bonificación', monto: datos.isrBonificacion });
    for (const d of datos.descuentosVivienda) {
        if (d.monto <= 0) continue;
        filas.push({ concepto: d.institucion ? `Descuento de vivienda: ${d.institucion}` : 'Descuento de vivienda', monto: d.monto });
    }
    return filas;
}
