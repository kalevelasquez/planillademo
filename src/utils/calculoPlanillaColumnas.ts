/**
 * Definición de columnas configurables de la tabla de Cálculo de Planilla (US-CALC-06/IMPL-92
 * CA1). "Siempre visibles" (Nombre, Neto) no aparecen en este catálogo — se renderizan sin
 * condición en `CalculoPlanillaView.tsx`.
 */

export type ColumnaKey =
    | 'departamento'
    | 'sueldo' | 'permisos' | 'hhee' | 'viaticos' | 'bonificaciones' | 'otrosIngresos' | 'totalIngresos'
    | 'isss' | 'afp' | 'renta' | 'anticipos' | 'otrosDesc' | 'totalDesc';

export interface ColumnaDef {
    key: ColumnaKey;
    grupo: 'general' | 'ingresos' | 'deducciones';
}

export const COLUMNAS_DISPONIBLES: ColumnaDef[] = [
    { key: 'departamento', grupo: 'general' },
    { key: 'sueldo', grupo: 'ingresos' },
    // IMPL-181 (US-PER-01 CA4) — monto ya restado de "sueldo" por permisos sin goce de esta
    // quincena; se muestra aparte para que la resta sea visible/auditable, no un ajuste oculto.
    { key: 'permisos', grupo: 'ingresos' },
    { key: 'hhee', grupo: 'ingresos' },
    { key: 'viaticos', grupo: 'ingresos' },
    { key: 'bonificaciones', grupo: 'ingresos' },
    { key: 'otrosIngresos', grupo: 'ingresos' },
    { key: 'totalIngresos', grupo: 'ingresos' },
    { key: 'isss', grupo: 'deducciones' },
    { key: 'afp', grupo: 'deducciones' },
    { key: 'renta', grupo: 'deducciones' },
    { key: 'anticipos', grupo: 'deducciones' },
    { key: 'otrosDesc', grupo: 'deducciones' },
    { key: 'totalDesc', grupo: 'deducciones' },
];

/** Vistas predefinidas (CA1/CA2) — constantes de la app, no editables por el usuario (a
 * diferencia de las vistas guardadas, que sí persisten en `planilla_calculo_vistas_guardadas`). */
export const VISTAS_PREDEFINIDAS: Record<'contabilidad' | 'rrhh' | 'completa', ColumnaKey[]> = {
    contabilidad: ['sueldo', 'totalIngresos', 'isss', 'afp', 'renta', 'totalDesc'],
    rrhh: ['departamento', 'sueldo', 'permisos', 'hhee', 'viaticos', 'bonificaciones'],
    completa: COLUMNAS_DISPONIBLES.map((c) => c.key),
};
