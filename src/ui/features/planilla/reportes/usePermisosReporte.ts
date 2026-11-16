import { useEffect, useMemo, useState } from 'react';
import { permisosService, type Permiso } from '../../../../services/permisosService';
import { planillaEmpleadosService } from '../../../../services/planillaEmpleadosService';
import { Logger } from '../../../../utils/logger';

export interface FilaReportePermisos {
    codigoEmpleado: string;
    nombreEmpleado: string;
    fecha: string;
    tipo: Permiso['tipo'];
    motivo: string;
    /** Mes de la fecha del permiso, 1-12 — usado para el filtro de mes. */
    mes: number;
}

/**
 * Datos del reporte de Historial/Estado de Permisos (US-EXP-10, IMPL-166). Mismo patrón que
 * useVacacionesReporte.ts — vista de consulta pura sobre `permisosService.getTodas()`.
 */
export function usePermisosReporte() {
    const [filas, setFilas] = useState<FilaReportePermisos[]>([]);
    const [filtroMes, setFiltroMes] = useState<number | 'todos'>('todos');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        Promise.all([permisosService.getTodas(), planillaEmpleadosService.getEmpleadosParaReportes()])
            .then(([permisos, empleados]: [Permiso[], Awaited<ReturnType<typeof planillaEmpleadosService.getEmpleadosParaReportes>>]) => {
                const empleadosPorId = new Map(empleados.map((e) => [e.id, e]));
                const filasReporte: FilaReportePermisos[] = permisos.map((p) => {
                    const empleado = empleadosPorId.get(p.empleado_id);
                    return {
                        codigoEmpleado: empleado?.codigo_empleado_manual ?? empleado?.codigo ?? '—',
                        nombreEmpleado: empleado?.nombre_completo ?? '—',
                        fecha: p.fecha,
                        tipo: p.tipo,
                        motivo: p.motivo,
                        mes: Number(p.fecha.slice(5, 7)),
                    };
                });
                setFilas(filasReporte);
            })
            .catch((err: unknown) => {
                Logger.error('Error al cargar reporte de Permisos', {}, err);
                setError(true);
            })
            .finally(() => setIsLoading(false));
    }, []);

    const filasFiltradas = useMemo(
        () => (filtroMes === 'todos' ? filas : filas.filter((f) => f.mes === filtroMes)),
        [filas, filtroMes],
    );

    return { filasFiltradas, filtroMes, setFiltroMes, isLoading, error };
}
