// QA-Empleados gap #8 — fmtSueldo vivía solo en EmpleadosListView.tsx: el listado mostraba
// "$1,200.50" (2 decimales, separador de miles es-SV) mientras que el perfil de solo lectura en
// EmpleadoDetailView.tsx hacía `$${sueldoMensual}` a mano, mostrando "$1200.5" para el mismo
// valor. Se extrae a un util compartido para que ambas pantallas formateen igual.
export function fmtSueldo(n: number | null): string {
    if (n === null) return '—';
    return `$${n.toLocaleString('es-SV', { minimumFractionDigits: 2 })}`;
}
