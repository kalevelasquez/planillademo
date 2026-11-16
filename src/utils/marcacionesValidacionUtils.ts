import type { MarcacionCruda } from './excelUtils';
import { horasEnTramo, calcularConceptosDelDia, type Tramo, type ConceptoHorasExtras } from './horasExtrasUtils';
import { resolveJornadaOrdinaria, obtenerDiaSemana, type JornadaOverride } from './jornadaUtils';
import { similitudDice, UMBRAL_FUZZY_NOMBRE, buscarEmpleadoPorNombre } from './fuzzyMatchUtils';

export interface EmpleadoMatch {
    id: string;
    codigo_empleado_manual: string | null;
    nombre_completo: string;
    estado: 'activo' | 'inactivo';
    cargo: string | null;
    departamento: string | null;
    /** Defecto real (2026-09-23): necesario para poder calcular `monto_total` en dinero al
     * confirmar la importación — antes esta pantalla solo mostraba horas, nunca persistía plata
     * real para empleados matcheados automáticamente por el reloj (ver `handleConfirmar` en
     * `ImportacionMarcacionesSection.tsx`). */
    sueldo_mensual: number | null;
    /** Gap real IMPL-28 (US-HEX-10 CA1/CA2, 2026-09-24): ubicación ASIGNADA al empleado en su
     * perfil — necesaria para atribuir sus horas ahí, no a la ubicación de la pantalla donde se
     * subió el Excel, cuando trabajó físicamente en una ubicación distinta a la suya. Opcional
     * (no `string | null` a secas) para no romper fixtures de test existentes que no la
     * necesitan — en código real siempre viene de `planilla_empleados.ubicacion_id`. */
    ubicacion_id?: string | null;
}

export interface FilaValidacion {
    idUsuarioArchivo: string;
    nombreArchivo: string;
    fecha: string;
    tramos: Tramo[];
    empleadoId: string | null;
    empleadoNombre: string | null;
    empleadoEstado: 'activo' | 'inactivo' | 'liquidado' | null;
    empleadoCargo: string | null;
    empleadoDepartamento: string | null;
    /** IMPL-22 CA4 — siempre calculadas, nunca captura manual en este flujo (CA5). Derivadas de
     * `calcularConceptosDelDia` vía `calcularHorasDeFila`. */
    horasRegulares: number;
    hed: number;
    hen: number;
    nocturnidad: number;
    feriado: number;
    /** IMPL-27 (US-HEX-09 CA1) — déficit de horas del día (llegada tarde/salida anticipada),
     * vía `detectarCorto`. Siempre 0 en feriado/domingo (jornada ordinaria = 0 esos días, nunca
     * negativo). Se compensa contra HEN/HED del período completo en
     * `compensarCortosPorEmpleado`, nunca acá a nivel de un solo día. */
    corto: number;
    /** IMPL-28 (US-HEX-10 CA1) — ubicación real bajo la que se van a atribuir las horas de
     * esta fila al confirmar (la del PERFIL del empleado matcheado, no necesariamente la
     * pantalla actual). `null` si el empleado no tiene ubicación asignada en su perfil — ese
     * caso cae a la ubicación de la pantalla como respaldo (ver `handleConfirmar`). */
    empleadoUbicacionId: string | null;
    errores: string[];
    advertencias: string[];
    informativos: string[];
    descartada: boolean;
    editadoManualmente: boolean;
}

export interface ContextoCalculoHoras {
    overrides: JornadaOverride[];
    /** Fechas ISO (YYYY-MM-DD) del catálogo de feriados. */
    feriados: Set<string>;
}

/**
 * IMPL-22 CA4/CA5 (wiring de IMPL-80, reunión con Imporfrut sept. 2026) — deriva las 5
 * columnas de horas de una fila a partir de `calcularConceptosDelDia` (US-HEX-03), resolviendo
 * la jornada ordinaria del empleado (`resolveJornadaOrdinaria`, US-HEX-01) y si el día es
 * feriado/domingo. `sueldoMensual` se pasa en 0 a propósito: solo afecta el campo `monto` de
 * `calcularConceptosDelDia` (no usado acá, esta tabla muestra horas, no dinero) — evita tener
 * que propagar el sueldo hasta este flujo solo para un cálculo que no se muestra.
 */
export function calcularHorasDeFila(
    fecha: string,
    tramos: Tramo[],
    cargo: string | null,
    departamento: string | null,
    contexto: ContextoCalculoHoras
): Pick<FilaValidacion, 'horasRegulares' | 'hed' | 'hen' | 'nocturnidad' | 'feriado' | 'corto'> {
    if (tramos.length === 0) {
        return { horasRegulares: 0, hed: 0, hen: 0, nocturnidad: 0, feriado: 0, corto: 0 };
    }
    const diaSemana = obtenerDiaSemana(fecha);
    const esDomingo = diaSemana === 'domingo';
    const esFeriadoODescanso = esDomingo || contexto.feriados.has(fecha);
    const jornadaOrdinariaHoras = esDomingo ? 0 : resolveJornadaOrdinaria(cargo, departamento, contexto.overrides)[diaSemana];

    let resultado;
    try {
        resultado = calcularConceptosDelDia(tramos, jornadaOrdinariaHoras, 0, esFeriadoODescanso);
    } catch {
        // Tramo inválido (salida <= entrada) — ya queda reportado como error de validación;
        // acá simplemente no hay horas que mostrar todavía.
        return { horasRegulares: 0, hed: 0, hen: 0, nocturnidad: 0, feriado: 0, corto: 0 };
    }
    const buscar = (c: ConceptoHorasExtras) => resultado.detalle.find((d) => d.concepto === c)?.horas ?? 0;
    return {
        horasRegulares: esFeriadoODescanso ? 0 : Math.min(resultado.horasTrabajadas, jornadaOrdinariaHoras),
        hed: buscar('hed'),
        hen: buscar('hen'),
        nocturnidad: buscar('nocturnidad_ordinaria'),
        feriado: buscar('feriado_diurno') + buscar('feriado_nocturno'),
        // IMPL-27 (US-HEX-09 CA1) — `jornadaOrdinariaHoras` ya es 0 en feriado/domingo, así que
        // `detectarCorto` da 0 naturalmente esos días sin necesitar un guard aparte acá.
        corto: detectarCorto(tramos, jornadaOrdinariaHoras),
    };
}

/**
 * Normaliza una hora de texto ("8:00", "08:00", "08:00:00") a "HH:MM:SS". Asume que el
 * archivo trae la hora como texto plano (igual que la plantilla generada en US-HEX-02) — NO
 * maneja celdas de Excel con tipo fecha/hora nativo, ver gap en planilla-contexto.md.
 */
function normalizarHora(hora: string): string {
    const partes = hora.trim().split(':').map((p) => p.padStart(2, '0'));
    while (partes.length < 3) partes.push('00');
    return partes.slice(0, 3).join(':');
}

function construirTramo(fecha: string, horaEntrada: string, horaSalida: string): Tramo {
    return {
        entrada: `${fecha}T${normalizarHora(horaEntrada)}`,
        salida: `${fecha}T${normalizarHora(horaSalida)}`,
    };
}

/**
 * Turno que cruza medianoche (hallazgo UAT 2026-10-19, confirmado por Gilda/Imporfrut): el
 * reloj marcador está configurado en 24 horas y, cuando un turno sigue después de medianoche,
 * lo reporta partido en DOS filas de calendario usando `00:00` como punto de corte/reanudación
 * — ej. entrada 20:59 / salida 00:00 el día N, seguido de entrada 00:00 / salida 09:16 el día
 * N+1. Verificado contra el archivo real completo (no solo una muestra): de 53 filas con solo
 * la salida en 00:00, 45 (85%) tienen exactamente esta pareja al día siguiente inmediato — el
 * resto queda sin pareja clara (hueco de varios días sin marcación en el medio) y se trata como
 * antes, con error para revisión humana.
 *
 * Se cose en un ÚNICO tramo, atribuido al día en que el empleado ENTRÓ (decisión del usuario,
 * criterio estándar de nómina para turnos nocturnos) — SOLO cuando el emparejamiento es
 * inequívoco: exactamente una fila "abierta" (salida 00:00, entrada real) ese día, y exactamente
 * una fila "cierre" (entrada 00:00, salida real) al día siguiente inmediato, sin huecos. Ante
 * cualquier ambigüedad (0 o 2+ candidatos) no se cose — se deja como estaba, para que el
 * Preparador lo revise a mano.
 *
 * Las filas con AMBOS lados en 00:00 (sin ninguna marcación real ese día — ausencia, descanso)
 * se filtran directo en el loop principal (no generan tramo ni error), caso aparte y sin
 * ambigüedad.
 */
function detectarTurnosQueCruzanMedianoche(marcaciones: MarcacionCruda[]): {
    tramoMergeadoPorMarcacion: Map<MarcacionCruda, Tramo>;
    marcacionesConsumidas: Set<MarcacionCruda>;
} {
    const tramoMergeadoPorMarcacion = new Map<MarcacionCruda, Tramo>();
    const marcacionesConsumidas = new Set<MarcacionCruda>();

    const porEmpleado = new Map<string, MarcacionCruda[]>();
    for (const m of marcaciones) {
        const lista = porEmpleado.get(m.idUsuario) ?? [];
        lista.push(m);
        porEmpleado.set(m.idUsuario, lista);
    }

    for (const lista of porEmpleado.values()) {
        const porFecha = new Map<string, MarcacionCruda[]>();
        for (const m of lista) {
            const arr = porFecha.get(m.fecha) ?? [];
            arr.push(m);
            porFecha.set(m.fecha, arr);
        }
        for (const [fecha, filasDelDia] of porFecha) {
            const abiertas = filasDelDia.filter((m) => m.horaSalida === '00:00' && m.horaEntrada !== '00:00');
            if (abiertas.length !== 1) continue;
            const abierta = abiertas[0];

            const filasSiguiente = porFecha.get(sumarUnDia(fecha)) ?? [];
            const cierres = filasSiguiente.filter((m) => m.horaEntrada === '00:00' && m.horaSalida !== '00:00');
            if (cierres.length !== 1) continue;
            const cierre = cierres[0];

            tramoMergeadoPorMarcacion.set(abierta, {
                entrada: `${abierta.fecha}T${normalizarHora(abierta.horaEntrada)}`,
                salida: `${cierre.fecha}T${normalizarHora(cierre.horaSalida)}`,
            });
            marcacionesConsumidas.add(cierre);
        }
    }

    return { tramoMergeadoPorMarcacion, marcacionesConsumidas };
}

function tramosSonIguales(a: Tramo, b: Tramo): boolean {
    return a.entrada === b.entrada && a.salida === b.salida;
}

/**
 * El código manual se tipea a mano tanto al dar de alta al empleado como en el archivo del
 * reloj — ninguno de los dos puntos de captura normaliza mayúsculas/espacios, así que la
 * comparación tiene que hacerlo acá para no depender de que ambos lados se hayan tipeado
 * exactamente igual (bug reportado: "EMP-2020-001" no matcheaba pese a existir).
 */
function normalizarCodigo(codigo: string): string {
    return codigo.trim().toUpperCase();
}

/**
 * Agrupa las marcaciones crudas por (idUsuario, fecha) en tramos por día — un día con
 * almuerzo marcado por separado llega como 2+ filas y se agrupa en 2 tramos (CA4: esto es
 * NORMAL, se muestra como advertencia informativa, no como error). También matchea contra
 * `codigo_empleado_manual` (CA1) y valida que la fecha caiga dentro del rango de la quincena
 * seleccionada (bloqueo agregado tras revisión de diseño, no estaba en ningún CA original
 * pero evita persistir datos fuera del período correcto).
 */
export function agruparPorEmpleadoYDia(
    marcaciones: MarcacionCruda[],
    empleados: EmpleadoMatch[],
    quincenaFechaInicio: string,
    quincenaFechaFin: string,
    contexto: ContextoCalculoHoras,
    ubicacionActualId: string
): FilaValidacion[] {
    // Bugfix (auditoría): dos empleados con código manual "EMP-001"/"emp-001" (o con espacio al
    // final) son valores DISTINTOS para el UNIQUE constraint de la BD, pero normalizan a la
    // misma clave acá — antes el Map se quedaba en silencio con el que llegara último (orden no
    // determinístico), misasignando horas/pago. Ahora un código ambiguo se trata como "no
    // encontrado" en vez de resolverse a cualquiera de los dos.
    const empleadosPorCodigo = new Map<string, EmpleadoMatch>();
    const codigosAmbiguos = new Set<string>();
    for (const e of empleados) {
        if (!e.codigo_empleado_manual) continue;
        const clave = normalizarCodigo(e.codigo_empleado_manual);
        if (empleadosPorCodigo.has(clave)) {
            codigosAmbiguos.add(clave);
        } else {
            empleadosPorCodigo.set(clave, e);
        }
    }

    const { tramoMergeadoPorMarcacion, marcacionesConsumidas } = detectarTurnosQueCruzanMedianoche(marcaciones);

    const grupos = new Map<string, MarcacionCruda[]>();
    for (const m of marcaciones) {
        // La mitad "cierre" de un turno que cruza medianoche ya quedó cosida en el tramo de la
        // mitad "abierta" (día anterior) — no genera su propia fila.
        if (marcacionesConsumidas.has(m)) continue;
        const clave = `${m.idUsuario}|${m.fecha}`;
        const grupo = grupos.get(clave) ?? [];
        grupo.push(m);
        grupos.set(clave, grupo);
    }

    const filas: FilaValidacion[] = [];

    for (const [, grupo] of grupos) {
        const primera = grupo[0];
        const errores: string[] = [];
        const advertencias: string[] = [];
        const informativos: string[] = [];

        if (primera.fecha < quincenaFechaInicio || primera.fecha > quincenaFechaFin) {
            errores.push(`La fecha ${primera.fecha} está fuera del rango de la quincena seleccionada.`);
        }

        // Filas con AMBOS lados en 00:00 (reloj marcador, confirmado por Gilda 2026-10-19): sin
        // ninguna marcación real ese día (ausencia, descanso) — no generan tramo ni error, caen
        // naturalmente a 0 horas (calcularHorasDeFila ya devuelve todo en 0 con tramos.length === 0).
        const marcacionesConTramo = grupo.filter((m) => !(m.horaEntrada === '00:00' && m.horaSalida === '00:00'));
        const tramosCrudos = marcacionesConTramo.map((m) => tramoMergeadoPorMarcacion.get(m) ?? construirTramo(m.fecha, m.horaEntrada, m.horaSalida));
        const tramos: Tramo[] = [];
        for (let i = 0; i < tramosCrudos.length; i++) {
            const t = tramosCrudos[i];
            if (tramos.some((existente) => tramosSonIguales(existente, t))) {
                advertencias.push('Se encontró un tramo duplicado idéntico (misma entrada y salida repetida) — se ignoró la repetición.');
                continue;
            }
            tramos.push(t);
            if (tramoMergeadoPorMarcacion.has(marcacionesConTramo[i])) {
                informativos.push('Turno que cruza medianoche: se unió con la marcación del día siguiente (el reloj marcador está configurado en 24 horas y parte el turno en dos filas usando 00:00 como punto de corte).');
            }
        }

        // Bugfix (auditoría): antes esta validación inicial no chequeaba el rango de horas —
        // una celda con texto/basura en vez de hora produce `Invalid Date` (NaN), y como
        // `NaN <= NaN` es siempre `false` en JS, ni un chequeo directo de rango la atraparía acá.
        // Se valida explícitamente NaN primero, y recién después el rango salida > entrada
        // (mismo criterio que ya usa `revalidarFila` tras una corrección manual).
        for (const t of tramos) {
            const entradaTime = new Date(t.entrada).getTime();
            const salidaTime = new Date(t.salida).getTime();
            if (Number.isNaN(entradaTime) || Number.isNaN(salidaTime)) {
                errores.push(`La hora de entrada o salida de la fila ${primera.fecha} no tiene un formato válido.`);
            } else if (salidaTime <= entradaTime) {
                // 2026-10-19: si llegó hasta acá con un 00:00 de por medio, es porque no se pudo
                // coser con el día siguiente/anterior de forma inequívoca (ver
                // detectarTurnosQueCruzanMedianoche) — el reloj usa 00:00 cuando falta un lado de
                // la marcación, pero acá el emparejamiento automático no fue seguro.
                const tieneCeroSospechoso = t.entrada.endsWith('T00:00:00') || t.salida.endsWith('T00:00:00');
                errores.push(tieneCeroSospechoso
                    ? 'La hora de salida debe ser posterior a la hora de entrada — el reloj marcador usa 00:00 cuando falta un lado de la marcación (ej. turno que cruza medianoche sin su par claro el día siguiente/anterior). Confirmar la hora real con el empleado o su supervisor antes de continuar.'
                    : 'La hora de salida debe ser posterior a la hora de entrada.');
            }
        }

        if (tramos.length > 1) {
            advertencias.push(`Se encontraron ${tramos.length} marcaciones para este día — se suman como tramos de la jornada.`);
        }

        const claveArchivo = normalizarCodigo(primera.idUsuario);
        let empleado = codigosAmbiguos.has(claveArchivo) ? undefined : empleadosPorCodigo.get(claveArchivo);
        let matcheadoPorNombre = false;

        // Defecto real (2026-09-23) — el ID del archivo puede no coincidir con ningún código
        // (error de tipeo en el reloj, empleado no cargado con ese código, etc.) aunque el
        // nombre sí identifique sin ambigüedad a un empleado real. No se intenta esto cuando el
        // código es AMBIGUO (varios empleados comparten la clave normalizada): ahí el problema es
        // de datos (códigos duplicados) y conviene forzar la asignación manual en vez de adivinar
        // por nombre. Mismo algoritmo/umbral que la validación cruzada de abajo — no se baja la
        // vara para autoasignar, se exige el mismo 80% de similitud, y la fila queda marcada con
        // advertencia (no queda "limpia") para que el Preparador la revise antes de confirmar.
        if (!empleado && !codigosAmbiguos.has(claveArchivo) && primera.nombreCompleto) {
            const porNombre = buscarEmpleadoPorNombre(primera.nombreCompleto, empleados, UMBRAL_FUZZY_NOMBRE);
            if (porNombre) {
                empleado = porNombre;
                matcheadoPorNombre = true;
            }
        }

        if (!empleado) {
            const nombreArchivoRef = primera.nombreCompleto ? ` (nombre en el archivo: "${primera.nombreCompleto}")` : '';
            if (codigosAmbiguos.has(claveArchivo)) {
                errores.push(`Hay más de un empleado con un código equivalente a "${primera.idUsuario}"${nombreArchivoRef} (difieren solo en mayúsculas/espacios) — asigná el empleado manualmente para esta fila.`);
            } else {
                errores.push(`Empleado no encontrado para el ID "${primera.idUsuario}"${nombreArchivoRef} del archivo — asigná el empleado manualmente o descartá esta fila.`);
            }
        } else {
            if (empleado.estado === 'inactivo') {
                advertencias.push(`El empleado "${empleado.nombre_completo}" está marcado como Inactivo.`);
            }
            if (matcheadoPorNombre) {
                advertencias.push(`El ID "${primera.idUsuario}" del archivo no coincide con ningún empleado, pero el nombre ("${primera.nombreCompleto}") sí coincide con "${empleado.nombre_completo}" — se asignó por nombre, verificar antes de confirmar.`);
            } else if (primera.nombreCompleto && similitudDice(primera.nombreCompleto, empleado.nombre_completo) < UMBRAL_FUZZY_NOMBRE) {
                // Defecto real (2026-09-23) — el ID matchea, pero eso no garantiza que sea la
                // persona correcta (código mal asignado/tipeado a otro empleado por error). Cruzar
                // contra el nombre que trae el archivo, mismo umbral y algoritmo (Dice sobre
                // bigramas) que ya usa la extracción con IA (US-VIA-01 CA2) — no se bloquea, solo
                // se advierte, porque el nombre del archivo puede venir con variantes legítimas
                // (apodos, orden de apellidos) que no ameritan descartar el match por ID.
                advertencias.push(`El nombre del archivo ("${primera.nombreCompleto}") no se parece al nombre registrado para el código "${primera.idUsuario}" ("${empleado.nombre_completo}") — verificar que el código esté bien asignado antes de confirmar.`);
            }

            // Gap real IMPL-28 (US-HEX-10 CA1/CA2, 2026-09-24) — el empleado matcheado puede
            // pertenecer a una ubicación distinta a la de esta pantalla (trabajó físicamente
            // acá, pero su perfil dice otra sede). Sus horas se van a atribuir a SU ubicación,
            // no a esta (ver `empleadoUbicacionId` más abajo y `handleConfirmar`) — se advierte
            // para que el Preparador lo sepa antes de confirmar, no queda en silencio.
            if (empleado.ubicacion_id && empleado.ubicacion_id !== ubicacionActualId) {
                advertencias.push(`El empleado "${empleado.nombre_completo}" pertenece a otra ubicación — sus horas se van a registrar bajo su ubicación asignada, no en esta.`);
            }
        }

        const horas = calcularHorasDeFila(primera.fecha, tramos, empleado?.cargo ?? null, empleado?.departamento ?? null, contexto);

        filas.push({
            idUsuarioArchivo: primera.idUsuario,
            nombreArchivo: primera.nombreCompleto,
            fecha: primera.fecha,
            tramos,
            empleadoId: empleado?.id ?? null,
            empleadoNombre: empleado?.nombre_completo ?? null,
            empleadoEstado: empleado?.estado ?? null,
            empleadoCargo: empleado?.cargo ?? null,
            empleadoDepartamento: empleado?.departamento ?? null,
            empleadoUbicacionId: empleado?.ubicacion_id ?? null,
            ...horas,
            errores,
            advertencias,
            informativos,
            descartada: false,
            editadoManualmente: false,
        });
    }

    return filas.sort((a, b) => (a.fecha + a.idUsuarioArchivo).localeCompare(b.fecha + b.idUsuarioArchivo));
}

export interface TramoMarcacionConfirmada {
    empleadoId: string;
    entrada: string;
    salida: string;
    idUsuarioArchivo: string;
    editadoManualmente: boolean;
    empleadoNombre: string;
    empleadoEstado: 'activo' | 'inactivo' | 'liquidado';
    empleadoCargo: string | null;
    empleadoDepartamento: string | null;
}

/**
 * Pedido real del jefe (2026-09-23, parte 2 de [[horas-extras-feedback-jefe-2026-09-23]]) —
 * reabrir un módulo ya confirmado forzaba re-subir el Excel completo desde cero (`reemplazar`)
 * porque no había forma de reconstruir filas EDITABLES a partir de lo ya persistido. A
 * diferencia de `agruparPorEmpleadoYDia`, acá el empleado YA está resuelto (viene directo de
 * `planilla_marcaciones.empleado_id`, no de matchear un código de archivo) — se agrupa por
 * (empleadoId, fecha), no por id_usuario_archivo, porque esa es la identidad real que importa
 * una vez confirmado (dos tramos con distinto id_usuario_archivo pero mismo empleado y día
 * deben quedar en la misma fila, no separarse).
 */
export function construirFilasDesdeConfirmadas(tramos: TramoMarcacionConfirmada[], contexto: ContextoCalculoHoras): FilaValidacion[] {
    const grupos = new Map<string, TramoMarcacionConfirmada[]>();
    for (const t of tramos) {
        const fecha = t.entrada.slice(0, 10);
        const clave = `${t.empleadoId}|${fecha}`;
        const grupo = grupos.get(clave) ?? [];
        grupo.push(t);
        grupos.set(clave, grupo);
    }

    const filas: FilaValidacion[] = [];
    for (const [, grupo] of grupos) {
        const primera = grupo[0];
        const fecha = primera.entrada.slice(0, 10);
        const advertencias: string[] = [];

        const tramosUnicos: Tramo[] = [];
        for (const t of grupo) {
            const tramo = { entrada: t.entrada, salida: t.salida };
            if (tramosUnicos.some((u) => tramosSonIguales(u, tramo))) {
                advertencias.push('Se encontró un tramo duplicado idéntico (misma entrada y salida repetida) — se ignoró la repetición.');
                continue;
            }
            tramosUnicos.push(tramo);
        }
        if (grupo.length > 1) {
            advertencias.push(`Se encontraron ${grupo.length} marcaciones para este día — se suman como tramos de la jornada.`);
        }
        if (primera.empleadoEstado === 'inactivo' || primera.empleadoEstado === 'liquidado') {
            advertencias.push(`El empleado "${primera.empleadoNombre}" está marcado como ${primera.empleadoEstado === 'liquidado' ? 'Liquidado' : 'Inactivo'}.`);
        }

        const horas = calcularHorasDeFila(fecha, tramosUnicos, primera.empleadoCargo, primera.empleadoDepartamento, contexto);

        filas.push({
            // Se usa el empleadoId como clave de fila (en vez del id_usuario_archivo original,
            // que ya no es relevante una vez confirmado y agrupado) — `editarFila`/`handleAsignarEmpleado`
            // solo necesitan una clave estable por (fila, fecha), no el ID literal del archivo.
            idUsuarioArchivo: primera.empleadoId,
            nombreArchivo: primera.empleadoNombre,
            fecha,
            tramos: tramosUnicos,
            empleadoId: primera.empleadoId,
            empleadoNombre: primera.empleadoNombre,
            empleadoEstado: primera.empleadoEstado,
            empleadoCargo: primera.empleadoCargo,
            empleadoDepartamento: primera.empleadoDepartamento,
            // IMPL-28 — las filas reconstruidas acá SIEMPRE vienen de lo ya confirmado bajo
            // ESTA ubicación (getMarcacionesPorUbicacion filtra por ubicacion_id de pantalla);
            // una fila cross-location vive bajo la ubicación del empleado y nunca aparece acá.
            // `null` hace que `handleConfirmar` use la ubicación de la pantalla como antes.
            empleadoUbicacionId: null,
            ...horas,
            errores: [],
            advertencias,
            informativos: [],
            descartada: false,
            editadoManualmente: grupo.some((t) => t.editadoManualmente),
        });
    }
    return filas;
}

/**
 * Re-evalúa una fila después de una corrección manual (US-HEX-05 CA1/CA2): recalcula rango
 * de fecha, empleado (el que esté asignado en `fila.empleadoId`, sin importar si vino de
 * matching automático o de una reasignación manual), validez de los tramos y tramos
 * duplicados/multi-tramo. NO recalcula los acumulados de 120h/domingo — eso sigue siendo
 * responsabilidad de `validarAcumulados` sobre el lote completo, que el llamador debe volver
 * a correr después de editar.
 */
export function revalidarFila(fila: FilaValidacion, quincenaFechaInicio: string, quincenaFechaFin: string, contexto: ContextoCalculoHoras): FilaValidacion {
    const errores: string[] = [];
    const advertencias: string[] = [];

    if (fila.fecha < quincenaFechaInicio || fila.fecha > quincenaFechaFin) {
        errores.push(`La fecha ${fila.fecha} está fuera del rango de la quincena seleccionada.`);
    }

    if (!fila.empleadoId) {
        const nombreArchivoRef = fila.nombreArchivo ? ` (nombre en el archivo: "${fila.nombreArchivo}")` : '';
        errores.push(`Empleado no encontrado para el ID "${fila.idUsuarioArchivo}"${nombreArchivoRef} del archivo — asigná el empleado manualmente o descartá esta fila.`);
    } else if (fila.empleadoEstado === 'inactivo' || fila.empleadoEstado === 'liquidado') {
        advertencias.push(`El empleado "${fila.empleadoNombre}" está marcado como ${fila.empleadoEstado === 'liquidado' ? 'Liquidado' : 'Inactivo'}.`);
    }

    for (const t of fila.tramos) {
        if (new Date(t.salida).getTime() <= new Date(t.entrada).getTime()) {
            errores.push('La hora de salida debe ser posterior a la hora de entrada.');
        }
    }

    const tramosUnicos: Tramo[] = [];
    for (const t of fila.tramos) {
        if (tramosUnicos.some((u) => tramosSonIguales(u, t))) {
            advertencias.push('Se encontró un tramo duplicado idéntico (misma entrada y salida repetida).');
        } else {
            tramosUnicos.push(t);
        }
    }
    if (fila.tramos.length > 1) {
        advertencias.push(`Se encontraron ${fila.tramos.length} marcaciones para este día — se suman como tramos de la jornada.`);
    }

    const horas = calcularHorasDeFila(fila.fecha, fila.tramos, fila.empleadoCargo, fila.empleadoDepartamento, contexto);

    return { ...fila, ...horas, errores, advertencias, editadoManualmente: true };
}

/** Nota informativa de "corto" (CA2) — el llamador resuelve `jornadaOrdinariaHoras` por
 * empleado (cargo/departamento, IMPL-80) ya que esta función no conoce esa resolución. */
export function detectarCorto(tramos: Tramo[], jornadaOrdinariaHoras: number): number {
    const horasTrabajadas = tramos.reduce((sum, t) => sum + horasEnTramo(t), 0);
    return Math.max(0, jornadaOrdinariaHoras - horasTrabajadas);
}

export interface HorasNetasPorEmpleado {
    hed: number;
    hen: number;
    nocturnidad: number;
    feriado: number;
    /** Informativo — cuánto "corto" quedó sin compensar y se perdonó (CA2), nunca se usa para
     * restar nada; útil para mostrarle al Preparador que un saldo negativo existió y se descartó. */
    cortoDescartado: number;
}

/**
 * IMPL-27 (US-HEX-09) — Perdón de Saldo Negativo.
 * CA1: las horas negativas ("cortos") de cada día de la quincena se restan PRIMERO contra el
 * total de HEN del PERÍODO completo (no día por día), y si sobra saldo, después contra el HED.
 * CA2: si el corto supera toda la hora extra disponible del período, el remanente se DESCARTA
 * — nunca resta del sueldo (hed/hen nunca quedan negativos acá ni en ningún otro cálculo).
 * CA3: mismo criterio sin importar ubicación — opera sobre `FilaValidacion[]` ya calculadas por
 * `calcularHorasDeFila` (Reloj Marcador); no aplica a Carga Manual, que no tiene tramos de
 * entrada/salida de donde derivar un corto (no hay jornada real que comparar).
 */
export function compensarCortosPorEmpleado(filas: FilaValidacion[]): Map<string, HorasNetasPorEmpleado> {
    const totales = new Map<string, { hed: number; hen: number; nocturnidad: number; feriado: number; corto: number }>();
    for (const f of filas) {
        if (f.descartada || !f.empleadoId) continue;
        const acc = totales.get(f.empleadoId) ?? { hed: 0, hen: 0, nocturnidad: 0, feriado: 0, corto: 0 };
        acc.hed += f.hed;
        acc.hen += f.hen;
        acc.nocturnidad += f.nocturnidad;
        acc.feriado += f.feriado;
        acc.corto += f.corto;
        totales.set(f.empleadoId, acc);
    }

    const resultado = new Map<string, HorasNetasPorEmpleado>();
    for (const [empleadoId, t] of totales) {
        const henNeto = Math.max(0, t.hen - t.corto);
        const cortoRestante = Math.max(0, t.corto - t.hen);
        const hedNeto = Math.max(0, t.hed - cortoRestante);
        const cortoDescartado = Math.max(0, cortoRestante - t.hed);
        resultado.set(empleadoId, { hed: hedNeto, hen: henNeto, nocturnidad: t.nocturnidad, feriado: t.feriado, cortoDescartado });
    }
    return resultado;
}

export interface AusenciaActiva {
    empleado_id: string;
    fecha_inicio: string;
    fecha_fin: string;
    tipo: 'incapacidad' | 'vacacion';
}

/**
 * CA7 (US-HEX-04, revisión épica por épica post-IMPL-41/63) — advierte si un empleado marcó
 * asistencia en un día donde tiene una incapacidad o vacación activa. `ausencias` ya viene
 * filtrada por el llamador (ej. sin vacaciones `no_gozada=true`, que no son ausencia real).
 * Comparación de fechas ISO como string, mismo estilo que el resto de este archivo.
 */
export function aplicarAusencias(filas: FilaValidacion[], ausencias: AusenciaActiva[]): FilaValidacion[] {
    return filas.map((fila) => {
        if (fila.descartada || !fila.empleadoId) return fila;
        const ausencia = ausencias.find(
            (a) => a.empleado_id === fila.empleadoId && fila.fecha >= a.fecha_inicio && fila.fecha <= a.fecha_fin
        );
        if (!ausencia) return fila;
        const advertencia = ausencia.tipo === 'incapacidad'
            ? `El empleado "${fila.empleadoNombre}" tiene una incapacidad activa este día — verificar antes de confirmar.`
            : `El empleado "${fila.empleadoNombre}" tiene vacaciones activas este día — verificar antes de confirmar.`;
        if (fila.advertencias.includes(advertencia)) return fila;
        return { ...fila, advertencias: [...fila.advertencias, advertencia] };
    });
}

export interface PermisoRegistrado {
    empleado_id: string;
    fecha: string;
}

export interface AusenciaInjustificada {
    empleadoId: string;
    empleadoNombre: string;
    fecha: string;
}

function sumarUnDia(fechaIso: string): string {
    const fecha = new Date(`${fechaIso}T00:00:00`);
    fecha.setDate(fecha.getDate() + 1);
    return fecha.toISOString().slice(0, 10);
}

/**
 * IMPL-82 (US-HEX-08) — CA1/CA3: detecta días en los que un empleado ACTIVO debía trabajar
 * según su jornada ordinaria (IMPL-80, por cargo/departamento) pero no tiene marcación en el
 * lote, ni una justificación registrada. CA2: se excluyen los días cubiertos por incapacidad,
 * vacación (ya filtradas por el llamador igual que `aplicarAusencias` — sin `no_gozada`, que no
 * es ausencia real), o CUALQUIER permiso registrado ese día (con o sin goce — un permiso
 * `sin_goce` ya se descuenta aparte en el motor de cálculo, Paso 2b; contarlo ACÁ TAMBIÉN sería
 * penalizar dos veces el mismo día).
 *
 * `empleados` tiene que ser el ROSTER COMPLETO de activos de la ubicación, no solo los que
 * aparecen en el archivo — si alguien no marcó ni un solo día, nunca iba a tener fila en
 * `filas` para empezar.
 *
 * Deliberadamente NO calcula ningún monto a descontar — la fórmula exacta (cuánto se descuenta
 * por un día de ausencia injustificada) no tiene fuente en DRN/Blueprint/Jira, queda pendiente
 * de confirmar con Imporfrut antes de enchufarla al motor de cálculo real. Por ahora solo
 * identifica las fechas, para mostrarlas como advertencia visible al Preparador.
 */
export function detectarAusenciasInjustificadas(
    empleados: EmpleadoMatch[],
    filas: FilaValidacion[],
    ausencias: AusenciaActiva[],
    permisos: PermisoRegistrado[],
    quincenaFechaInicio: string,
    quincenaFechaFin: string,
    contexto: ContextoCalculoHoras
): AusenciaInjustificada[] {
    const fechaConMarcacion = new Set(
        filas
            .filter((f) => !f.descartada && f.empleadoId && f.tramos.length > 0)
            .map((f) => `${f.empleadoId}|${f.fecha}`)
    );

    const resultado: AusenciaInjustificada[] = [];
    for (const empleado of empleados) {
        if (empleado.estado !== 'activo') continue;
        const jornada = resolveJornadaOrdinaria(empleado.cargo, empleado.departamento, contexto.overrides);

        for (let fecha = quincenaFechaInicio; fecha <= quincenaFechaFin; fecha = sumarUnDia(fecha)) {
            const diaSemana = obtenerDiaSemana(fecha);
            if (diaSemana === 'domingo' || jornada[diaSemana] <= 0) continue;
            if (contexto.feriados.has(fecha)) continue;
            if (fechaConMarcacion.has(`${empleado.id}|${fecha}`)) continue;

            const justificada =
                ausencias.some((a) => a.empleado_id === empleado.id && fecha >= a.fecha_inicio && fecha <= a.fecha_fin) ||
                permisos.some((p) => p.empleado_id === empleado.id && p.fecha === fecha);
            if (justificada) continue;

            resultado.push({ empleadoId: empleado.id, empleadoNombre: empleado.nombre_completo, fecha });
        }
    }
    return resultado;
}

/**
 * IMPL-24 (revisión épica por épica) — advierte si, tras un matching automático o una
 * reasignación manual, el MISMO empleado queda con 2+ filas para el MISMO día en el lote
 * (ej. dos `idUsuarioArchivo` distintos del archivo reasignados a mano al mismo empleado real).
 * `validarAcumulados` sumaría esas horas sin distinguirlas — esto solo advierte, no bloquea,
 * porque un caso legítimo (empleado con 2 tramos por error de exportación del reloj) también
 * pasa por acá y ya se resuelve fusionando tramos en `agruparPorEmpleadoYDia`; esta función
 * cubre el caso post-reasignación manual, que ocurre después de ese agrupamiento.
 */
export function detectarEmpleadosDuplicados(filas: FilaValidacion[]): FilaValidacion[] {
    const conteoPorEmpleadoFecha = new Map<string, number>();
    for (const fila of filas) {
        if (fila.descartada || !fila.empleadoId) continue;
        const clave = `${fila.empleadoId}|${fila.fecha}`;
        conteoPorEmpleadoFecha.set(clave, (conteoPorEmpleadoFecha.get(clave) ?? 0) + 1);
    }

    return filas.map((fila) => {
        if (fila.descartada || !fila.empleadoId) return fila;
        const clave = `${fila.empleadoId}|${fila.fecha}`;
        if ((conteoPorEmpleadoFecha.get(clave) ?? 0) < 2) return fila;
        const advertencia = `El empleado "${fila.empleadoNombre}" aparece más de una vez para el ${fila.fecha} en este lote — verificar antes de confirmar (posible doble conteo de horas).`;
        if (fila.advertencias.includes(advertencia)) return fila;
        return { ...fila, advertencias: [...fila.advertencias, advertencia] };
    });
}

export interface MarcacionExistente {
    empleado_id: string;
    entrada: string;
    salida: string;
}

export interface ResultadoAcumulados {
    empleadosSobre120h: string[];
    empleadosDomingoTrabajado: { nombre: string; horasLunesASabado: number; superoUmbral44h: boolean }[];
}

const UMBRAL_HORAS_QUINCENA = 120; // CA3
const UMBRAL_HORAS_SEMANALES = 44; // US-HEX-01 CA4

/**
 * CA3 (>120h en la quincena, combinando lo ya persistido con el lote actual) y CA6 (domingo
 * trabajado + acumulado Lunes-Sábado vs. 44h) — ambas informativas/de advertencia, ninguna
 * reclasifica automáticamente la tarifa de un domingo (ver gap: US-HEX-01 CA3/CA4 siguen sin
 * resolver del todo, esto solo advierte).
 */
export function validarAcumulados(filas: FilaValidacion[], marcacionesExistentes: MarcacionExistente[]): ResultadoAcumulados {
    const horasPorEmpleado = new Map<string, number>();
    const horasLunesASabadoPorEmpleado = new Map<string, number>();
    const domingoTrabajadoPorEmpleado = new Set<string>();
    const nombrePorEmpleado = new Map<string, string>();

    const acumular = (empleadoId: string, horas: number, diaSemana: number) => {
        horasPorEmpleado.set(empleadoId, (horasPorEmpleado.get(empleadoId) ?? 0) + horas);
        if (diaSemana === 0) {
            domingoTrabajadoPorEmpleado.add(empleadoId);
        } else {
            horasLunesASabadoPorEmpleado.set(empleadoId, (horasLunesASabadoPorEmpleado.get(empleadoId) ?? 0) + horas);
        }
    };

    for (const fila of filas) {
        if (fila.descartada || !fila.empleadoId) continue;
        nombrePorEmpleado.set(fila.empleadoId, fila.empleadoNombre ?? '');
        const horas = fila.tramos.reduce((sum, t) => sum + horasEnTramo(t), 0);
        const diaSemana = new Date(`${fila.fecha}T00:00:00`).getDay();
        acumular(fila.empleadoId, horas, diaSemana);
    }

    for (const m of marcacionesExistentes) {
        const horas = horasEnTramo(m);
        const diaSemana = new Date(m.entrada).getDay();
        acumular(m.empleado_id, horas, diaSemana);
    }

    const empleadosSobre120h = Array.from(horasPorEmpleado.entries())
        .filter(([, horas]) => horas > UMBRAL_HORAS_QUINCENA)
        .map(([empleadoId]) => nombrePorEmpleado.get(empleadoId) || empleadoId);

    const empleadosDomingoTrabajado = Array.from(domingoTrabajadoPorEmpleado).map((empleadoId) => {
        const horasLunesASabado = horasLunesASabadoPorEmpleado.get(empleadoId) ?? 0;
        return {
            nombre: nombrePorEmpleado.get(empleadoId) || empleadoId,
            horasLunesASabado,
            superoUmbral44h: horasLunesASabado >= UMBRAL_HORAS_SEMANALES,
        };
    });

    return { empleadosSobre120h, empleadosDomingoTrabajado };
}
