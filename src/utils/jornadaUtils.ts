export type DiaSemana = 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes' | 'sabado';

export type HorasPorDia = Record<DiaSemana, number>;

export const DIAS_SEMANA: DiaSemana[] = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

/**
 * Jornada ordinaria legal por defecto (US-HEX-01 CA1): Lunes a Viernes 8 horas efectivas
 * (9 horas con 1 de almuerzo), Sábado 4 horas efectivas. Domingo no está en este mapa a
 * propósito — es legalmente no laborable (0 horas ordinarias siempre, sin excepción por
 * cargo/departamento), así que no es parte del override de CA2.
 */
export const JORNADA_ORDINARIA_DEFAULT: HorasPorDia = {
    lunes: 8,
    martes: 8,
    miercoles: 8,
    jueves: 8,
    viernes: 8,
    sabado: 4,
};

/** Domingo se maneja aparte (nunca es parte del override de CA2, ver `JORNADA_ORDINARIA_DEFAULT`
 * arriba) — por eso el tipo de retorno lo separa de `DiaSemana` en vez de forzarlo al mapa. */
export function obtenerDiaSemana(fechaIso: string): DiaSemana | 'domingo' {
    const dias: (DiaSemana | 'domingo')[] = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    return dias[new Date(`${fechaIso}T00:00:00`).getDay()];
}

export interface JornadaOverride {
    aplica_a: 'cargo' | 'departamento';
    valor: string;
    horas_por_dia: HorasPorDia;
}

/**
 * Resuelve la jornada ordinaria efectiva de un empleado (US-HEX-01 CA2): un override por
 * cargo tiene prioridad sobre uno por departamento; si no hay ninguno, se usa la jornada
 * legal por defecto (CA1). No implementa turnos ROTATIVOS (que requeriría una definición de
 * frecuencia/patrón de rotación que el DRN no especifica) — solo un horario fijo distinto
 * por cargo o departamento, ver gap en planilla-contexto.md.
 */
export function resolveJornadaOrdinaria(
    cargo: string | null,
    departamento: string | null,
    overrides: JornadaOverride[]
): HorasPorDia {
    const porCargo = cargo ? overrides.find((o) => o.aplica_a === 'cargo' && o.valor === cargo) : undefined;
    if (porCargo) return porCargo.horas_por_dia;

    const porDepartamento = departamento ? overrides.find((o) => o.aplica_a === 'departamento' && o.valor === departamento) : undefined;
    if (porDepartamento) return porDepartamento.horas_por_dia;

    return JORNADA_ORDINARIA_DEFAULT;
}
