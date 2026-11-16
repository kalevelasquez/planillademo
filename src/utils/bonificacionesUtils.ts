/**
 * Mirror TS de la lógica pura de Bonificaciones (US-BON-02/IMPL-74) — el SQL
 * (`calcular_bonos_incentivo_quincena`, `20260814090000_create_planilla_bonificaciones.sql`) es
 * la autoridad que persiste, esta es la especificación ejecutable contra la que se valida, mismo
 * criterio que `calculoPlanillaUtils.ts`/`vacacionesUtils.ts`. A diferencia de esos módulos, la
 * mayoría de las historias de Bonificaciones/Otros Ingresos son CRUD sin fórmula propia (US-BON-00
 * panel, US-BON-01/US-OTR-00 catálogos, US-BON-04/US-OTR-02 editar/eliminar) — no se les escribe
 * mirror acá, solo a la lógica de cálculo real (búsqueda de rango + elegibilidad de US-BON-02, y
 * el preview de nómina de US-BON-03).
 */

export interface RangoIncentivo {
    desde: number;
    hasta: number | null;
    bono: number;
}

export interface TablaIncentivo {
    empleadoId: string | null;
    grupo: string | null;
}

export interface EmpleadoElegibilidad {
    id: string;
    departamento: string | null;
}

/**
 * US-BON-02 (IMPL-74) — busca el rango cuyo [desde, hasta] cubre la utilidad neta del mes.
 * Mismo criterio de límites que `calcularRentaISR`: `hasta === null` es rango abierto.
 * Sin rango que aplique (utilidad fuera de todos los rangos configurados), no hay bono.
 */
export function buscarRangoIncentivo(utilidadNeta: number, rangos: RangoIncentivo[]): number | null {
    const rango = rangos.find((r) => utilidadNeta >= r.desde && (r.hasta === null || utilidadNeta <= r.hasta));
    return rango ? rango.bono : null;
}

/**
 * US-BON-02 (IMPL-74) — CA3 de US-BON-01 (IMPL-73): la tabla de incentivo apunta a un empleado
 * específico O a un grupo (departamento) — el CHECK de la tabla real garantiza que nunca ambos
 * son null ni ambos tienen valor. Un empleado sin tabla asignada nunca es elegible (silencioso
 * por diseño, sin log de exclusión — verificado en revisión épica por épica).
 */
export function esEmpleadoElegible(tabla: TablaIncentivo, empleado: EmpleadoElegibilidad): boolean {
    if (tabla.empleadoId != null) return tabla.empleadoId === empleado.id;
    if (tabla.grupo != null) return tabla.grupo === empleado.departamento;
    return false;
}

/**
 * US-BON-03 (IMPL-75) CA3 — preview del total de nómina para "Aplicar a Todos los empleados",
 * calculado en el cliente antes de guardar (el combobox ya tiene el conteo de activos cargado,
 * no hace falta ida y vuelta al server solo para esta cuenta).
 */
export function calcularTotalNominaPreview(montoPorEmpleado: number, cantidadEmpleadosActivos: number): number {
    return Math.round((montoPorEmpleado * cantidadEmpleadosActivos + Number.EPSILON) * 100) / 100;
}
