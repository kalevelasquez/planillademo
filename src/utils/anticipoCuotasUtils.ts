import { generarEtiquetaEstandar } from './quincenaUtils';

export interface QuincenaScheduleLike {
    id: string;
    fecha_inicio: string;
    fecha_fin: string;
    etiqueta_estandar: string;
}

export interface EventoCuotaLike {
    quincena_id: string;
    tipo: 'pago' | 'suspension';
    monto: number | null;
    motivo_suspension: string | null;
}

export type EstadoCuotaSchedule = 'pagada' | 'pendiente' | 'suspendida';

export interface CuotaScheduleRow {
    key: string;
    etiqueta: string;
    monto: number;
    estado: EstadoCuotaSchedule;
    motivoSuspension?: string;
    /** true si la fila es una quincena futura proyectada (la quincena real todavía no existe en
     * la BD); false si corresponde a una quincena real ya creada. */
    esProyectada: boolean;
}

function parseDate(iso: string): Date {
    return new Date(`${iso.slice(0, 10)}T00:00:00`);
}

function toIso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ultimoDiaDelMes(anio: number, mes0: number): number {
    return new Date(anio, mes0 + 1, 0).getDate();
}

function mesPadded(anio: number, mes0: number): string {
    return `${anio}-${String(mes0 + 1).padStart(2, '0')}`;
}

function etiquetaDeRango(inicio: string, fin: string): string {
    return generarEtiquetaEstandar('normal', inicio, fin).etiqueta ?? `${inicio} — ${fin}`;
}

/**
 * Primer período quincenal aplicable para un anticipo: el rango estándar (1ra = 1-15, 2da =
 * 16-fin de mes) que CONTIENE a `fechaVale` — IMPL-173 CA2 (confirmado por Imporfrut, 2026-09):
 * la primera cuota siempre va en la misma quincena del vale, nunca en la siguiente. Días 1-15 →
 * 1ra del mes; días 16-fin → 2da del mes.
 */
function primerPeriodoAplicable(fechaVale: string): { fecha_inicio: string; fecha_fin: string } {
    const d = parseDate(fechaVale);
    const anio = d.getFullYear();
    const mes0 = d.getMonth();
    const mes = mesPadded(anio, mes0);
    const dia = d.getDate();
    const ultimo = String(ultimoDiaDelMes(anio, mes0)).padStart(2, '0');

    if (dia <= 15) return { fecha_inicio: `${mes}-01`, fecha_fin: `${mes}-15` };
    return { fecha_inicio: `${mes}-16`, fecha_fin: `${mes}-${ultimo}` };
}

/**
 * Siguiente período quincenal estándar después del fin de una quincena dada: si el rango terminó
 * el último día del mes → 1ra del mes siguiente; si terminó el día 15 → 2da del mismo mes.
 */
function siguientePeriodo(finReferencia: string): { fecha_inicio: string; fecha_fin: string } {
    const d = parseDate(finReferencia);
    const anio = d.getFullYear();
    const mes0 = d.getMonth();
    const mes = mesPadded(anio, mes0);

    if (d.getDate() === ultimoDiaDelMes(anio, mes0)) {
        const sig = new Date(anio, mes0 + 1, 1);
        return { fecha_inicio: toIso(sig), fecha_fin: `${mesPadded(sig.getFullYear(), sig.getMonth())}-15` };
    }
    return {
        fecha_inicio: `${mes}-16`,
        fecha_fin: `${mes}-${String(ultimoDiaDelMes(anio, mes0)).padStart(2, '0')}`,
    };
}

/**
 * US-ANT-03 CA1 (defecto UAT, 2026-08-17) — arma el detalle de cuotas COMPLETO del anticipo:
 * una fila por cuota del schedule (quincena, monto, estado), como el prototipo.
 *
 * - Cuotas pasadas y actuales: usan las quincenas REALES de la BD con `fecha_inicio >= fecha_vale`
 *   (cada una con su estado derivado del evento: Pagada con el monto real — la última puede ser
 *   parcial —, Suspendida con motivo, o Pendiente) — antes la tabla dependía de cuántas quincenas
 *   existieran en el tenant, así que podía quedar vacía o mostrar solo la quincena actual.
 * - Cuotas futuras: si las quincenas reales no alcanzan a cubrir el schedule (el tenant todavía no
 *   creó las quincenas venideras), se proyectan con la cadencia estándar 1ra/2da y estado Pendiente
 *   — el monto es el monto de la cuota real, no se inventa ninguna cifra; la etiqueta proyectada se
 *   reemplaza sola por la real cuando esa quincena se cree.
 * - El total de posiciones del timeline es `numero_cuotas + suspensiones` (cada suspensión
 *   consume una posición sin cobrar y corre el cobro una quincena). Los anticipos saldados no
 *   proyectan cuotas futuras — solo muestran las posiciones que realmente tuvieron evento.
 *
 * Bugfix (defecto UAT): un anticipo saldado (con frecuencia el caso de una sola cuota) podía
 * mostrar la tabla completamente vacía si el evento de pago quedaba "huérfano" — su quincena ya
 * no aparecía en `quincenas` (aplicables), típicamente porque se filtró por `fecha_inicio >=
 * fecha_vale` y ese cruce fallaba, o porque la quincena real se borró/editó después del pago.
 * Antes, el total de filas para 'saldado' se calculaba contando cuántas quincenas aplicables
 * tenían un evento (`posicionesConEvento`) — si ese cruce daba 0, la tabla quedaba vacía aunque
 * el evento real existiera. Ahora, para 'saldado' las filas se arman DIRECTO desde `pagos` (la
 * fuente de verdad real), sin depender de ese cruce — un anticipo saldado nunca debería mostrar
 * menos filas que eventos realmente registrados.
 */
export function armarScheduleCuotas(
    fechaVale: string,
    montoCuota: number,
    numeroCuotas: number,
    quincenas: QuincenaScheduleLike[],
    pagos: EventoCuotaLike[] | undefined,
    estado: 'activo' | 'saldado'
): CuotaScheduleRow[] {
    const quincenaPorId = new Map(quincenas.map((q) => [q.id, q]));

    if (estado === 'saldado') {
        return (pagos ?? [])
            .slice()
            .sort((a, b) => (quincenaPorId.get(a.quincena_id)?.fecha_inicio ?? '').localeCompare(quincenaPorId.get(b.quincena_id)?.fecha_inicio ?? ''))
            .map((evento) => {
                const q = quincenaPorId.get(evento.quincena_id);
                if (evento.tipo === 'suspension') {
                    return {
                        key: evento.quincena_id,
                        etiqueta: q?.etiqueta_estandar ?? evento.quincena_id,
                        monto: montoCuota,
                        estado: 'suspendida' as const,
                        motivoSuspension: evento.motivo_suspension ?? undefined,
                        esProyectada: false,
                    };
                }
                return {
                    key: evento.quincena_id,
                    etiqueta: q?.etiqueta_estandar ?? evento.quincena_id,
                    monto: evento.monto ?? montoCuota,
                    estado: 'pagada' as const,
                    esProyectada: false,
                };
            });
    }

    // IMPL-173 CA2 — la quincena aplica si todavía no había TERMINADO cuando se registró el
    // vale (`fecha_fin >= fechaVale`), no solo si empieza después. Antes se comparaba contra
    // `fecha_inicio >= fechaVale`, lo que excluía por error la quincena que contiene la fecha
    // del vale cuando el vale se registraba a mitad de esa quincena (ej. vale del 17/07 con la
    // 2da Quincena de Julio empezando el 16/07) y corría la primera cuota a la quincena
    // siguiente — mismo patrón que IMPL-150. Mismo criterio ya corregido en el RPC
    // `procesar_cuotas_anticipos_quincena` (ver migración 20260922120000).
    const aplicables = quincenas
        .filter((q) => q.fecha_fin >= fechaVale)
        .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));

    const eventosPorQuincena = new Map((pagos ?? []).map((p) => [p.quincena_id, p]));
    // Cada suspensión consume una posición del timeline sin cobrar (el cobro se corre una
    // quincena), así que el total de posiciones es numero_cuotas + suspensiones.
    const suspensiones = aplicables.filter((q) => eventosPorQuincena.get(q.id)?.tipo === 'suspension').length;
    const totalPosiciones = numeroCuotas + suspensiones;

    const realesUsadas = aplicables.slice(0, totalPosiciones);
    const filas: CuotaScheduleRow[] = realesUsadas.map((q) => {
        const evento = eventosPorQuincena.get(q.id);
        if (evento?.tipo === 'pago') {
            return {
                key: q.id,
                etiqueta: q.etiqueta_estandar,
                monto: evento.monto ?? montoCuota,
                estado: 'pagada',
                esProyectada: false,
            };
        }
        if (evento?.tipo === 'suspension') {
            return {
                key: q.id,
                etiqueta: q.etiqueta_estandar,
                monto: montoCuota,
                estado: 'suspendida',
                motivoSuspension: evento.motivo_suspension ?? undefined,
                esProyectada: false,
            };
        }
        return { key: q.id, etiqueta: q.etiqueta_estandar, monto: montoCuota, estado: 'pendiente', esProyectada: false };
    });

    const ultimaReal = realesUsadas.length > 0 ? realesUsadas[realesUsadas.length - 1] : null;
    let rango = ultimaReal ? siguientePeriodo(ultimaReal.fecha_fin) : primerPeriodoAplicable(fechaVale);
    let idx = 0;
    while (filas.length < totalPosiciones) {
        filas.push({
            key: `futura-${idx++}`,
            etiqueta: etiquetaDeRango(rango.fecha_inicio, rango.fecha_fin),
            monto: montoCuota,
            estado: 'pendiente',
            esProyectada: true,
        });
        rango = siguientePeriodo(rango.fecha_fin);
    }

    return filas;
}
