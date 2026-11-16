import { useEffect, useMemo, useState } from 'react';
import { vacacionesService, type Vacacion } from '../../../../services/vacacionesService';
import { planillaEmpleadosService } from '../../../../services/planillaEmpleadosService';
import { Logger } from '../../../../utils/logger';

export interface FilaReporteVacaciones {
    codigoEmpleado: string;
    nombreEmpleado: string;
    fechaInicio: string;
    fechaFin: string;
    dias: number;
    gozada: boolean;
    /** Mes de fecha_inicio, 1-12 — usado para el filtro "a quién le corresponde en X mes". */
    mes: number;
}

/**
 * Datos del reporte de Historial/Estado de Vacaciones (US-EXP-06, IMPL-159). Vista de consulta
 * pura sobre `vacacionesService.getTodas()` — sin nueva lógica de cálculo (CA2).
 */
export function useVacacionesReporte() {
    const [filas, setFilas] = useState<FilaReporteVacaciones[]>([]);
    const [filtroMes, setFiltroMes] = useState<number | 'todos'>('todos');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        Promise.all([vacacionesService.getTodas(), planillaEmpleadosService.getEmpleadosParaReportes()])
            .then(([vacaciones, empleados]: [Vacacion[], Awaited<ReturnType<typeof planillaEmpleadosService.getEmpleadosParaReportes>>]) => {
                const empleadosPorId = new Map(empleados.map((e) => [e.id, e]));
                const filasReporte: FilaReporteVacaciones[] = vacaciones.map((v) => {
                    const empleado = empleadosPorId.get(v.empleado_id);
                    return {
                        codigoEmpleado: empleado?.codigo_empleado_manual ?? empleado?.codigo ?? '—',
                        nombreEmpleado: empleado?.nombre_completo ?? '—',
                        fechaInicio: v.fecha_inicio,
                        fechaFin: v.fecha_fin,
                        dias: v.dias,
                        gozada: !v.no_gozada,
                        mes: Number(v.fecha_inicio.slice(5, 7)),
                    };
                });
                setFilas(filasReporte);
            })
            .catch((err: unknown) => {
                Logger.error('Error al cargar reporte de Vacaciones', {}, err);
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
