import { useEffect, useMemo, useState } from 'react';
import { descuentosService } from '../../../../services/descuentosService';
import { descuentoCategoriasService } from '../../../../services/descuentoCategoriasService';
import { departamentosService } from '../../../../services/departamentosService';
import { planillaEmpleadosService } from '../../../../services/planillaEmpleadosService';
import { clasificarDescuento, COLUMNAS_REPORTE_DESCUENTOS } from '../../../../utils/descuentosPivotUtils';
import { Logger } from '../../../../utils/logger';

const SIN_CLASIFICAR = 'Sin clasificar';

export interface FilaEmpleadoPivot {
    codigoEmpleado: string;
    nombreEmpleado: string;
    /** Monto por columna del reporte (ej. "Banco Promerica", "Fondo Social para la Vivienda"). */
    columnas: Record<string, number>;
    total: number;
}

export interface DepartamentoPivot {
    nombre: string;
    empleados: FilaEmpleadoPivot[];
}

export interface GrupoCostosPivot {
    nombre: string;
    departamentos: DepartamentoPivot[];
}

/** Todas las columnas visibles del reporte, en el orden real del Excel de Imporfrut. */
export const TODAS_LAS_COLUMNAS = COLUMNAS_REPORTE_DESCUENTOS.flatMap((g) => g.columnas);

/**
 * Datos del reporte pivot de Descuentos (US-EXP-11, IMPL-167) — agrupado jerárquicamente
 * Grupo de Costos > Departamento > Empleado, igual que la planilla real de Imporfrut. Solo
 * descuentos con `estado === 'activo'` (CA5: el pivote lee lo ya capturado, sin nueva forma de
 * captura).
 */
export function useDescuentosPivotReporte() {
    const [grupos, setGrupos] = useState<GrupoCostosPivot[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        Promise.all([
            descuentosService.getTodos(),
            descuentoCategoriasService.getTodos(),
            planillaEmpleadosService.getEmpleadosParaReportes(),
            departamentosService.getDepartamentos(),
        ])
            .then(([descuentos, categorias, empleados, departamentos]) => {
                const categoriasPorId = new Map(categorias.map((c) => [c.id, c]));
                const empleadosPorId = new Map(empleados.map((e) => [e.id, e]));
                const grupoCostosPorDepartamento = new Map(departamentos.map((d) => [d.nombre.trim(), d.grupo_costos]));

                // grupoCostos -> departamento -> empleadoId -> fila
                const acumulado = new Map<string, Map<string, Map<string, FilaEmpleadoPivot>>>();

                for (const d of descuentos) {
                    if (d.estado !== 'activo') continue;
                    const categoria = categoriasPorId.get(d.categoria_id);
                    const empleado = empleadosPorId.get(d.empleado_id);
                    if (!categoria || !empleado) continue;

                    const { columna } = clasificarDescuento(categoria.nombre, d.institucion);
                    const departamentoNombre = empleado.departamento?.trim() || SIN_CLASIFICAR;
                    const grupoCostosNombre = grupoCostosPorDepartamento.get(departamentoNombre) || SIN_CLASIFICAR;

                    if (!acumulado.has(grupoCostosNombre)) acumulado.set(grupoCostosNombre, new Map());
                    const porDepartamento = acumulado.get(grupoCostosNombre)!;
                    if (!porDepartamento.has(departamentoNombre)) porDepartamento.set(departamentoNombre, new Map());
                    const porEmpleado = porDepartamento.get(departamentoNombre)!;

                    if (!porEmpleado.has(empleado.id)) {
                        porEmpleado.set(empleado.id, {
                            codigoEmpleado: empleado.codigo_empleado_manual ?? empleado.codigo,
                            nombreEmpleado: empleado.nombre_completo,
                            columnas: {},
                            total: 0,
                        });
                    }
                    const fila = porEmpleado.get(empleado.id)!;
                    fila.columnas[columna] = (fila.columnas[columna] ?? 0) + d.monto_quincenal;
                    fila.total += d.monto_quincenal;
                }

                const gruposOrdenados: GrupoCostosPivot[] = Array.from(acumulado.entries())
                    .sort(([a], [b]) => (a === SIN_CLASIFICAR ? 1 : b === SIN_CLASIFICAR ? -1 : a.localeCompare(b)))
                    .map(([nombreGrupo, porDepartamento]) => ({
                        nombre: nombreGrupo,
                        departamentos: Array.from(porDepartamento.entries())
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([nombreDepto, porEmpleado]) => ({
                                nombre: nombreDepto,
                                empleados: Array.from(porEmpleado.values()).sort((a, b) => a.nombreEmpleado.localeCompare(b.nombreEmpleado)),
                            })),
                    }));

                setGrupos(gruposOrdenados);
            })
            .catch((err: unknown) => {
                Logger.error('Error al cargar reporte de Descuentos', {}, err);
                setError(true);
            })
            .finally(() => setIsLoading(false));
    }, []);

    const totalFilas = useMemo(
        () => grupos.reduce((acc, g) => acc + g.departamentos.reduce((acc2, d) => acc2 + d.empleados.length, 0), 0),
        [grupos],
    );

    return { grupos, totalFilas, isLoading, error };
}
