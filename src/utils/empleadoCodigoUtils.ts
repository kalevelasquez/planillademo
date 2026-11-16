export interface ConCodigoEmpleado {
    codigo: string;
    codigo_empleado_manual?: string | null;
}

/**
 * El código que el usuario realmente eligió (`codigo_empleado_manual`, IMPL-120) tiene prioridad
 * sobre el autogenerado (`codigo`) en toda la UI — mostrar o buscar por `codigo` a solas hace que
 * el valor elegido por el usuario en el alta/edición de empleado parezca "no respetado" en el
 * resto de la app. El fallback a `codigo` cubre únicamente a los empleados creados antes de que
 * `codigo_empleado_manual` existiera.
 */
export function getCodigoEmpleado(emp: ConCodigoEmpleado): string {
    return emp.codigo_empleado_manual?.trim() || emp.codigo;
}
