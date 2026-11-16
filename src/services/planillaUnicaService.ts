import { calculoPlanillaService } from './calculoPlanillaService';
import { incapacidadesService } from './incapacidadesService';
import { vacacionesService } from './vacacionesService';
import { empresaConfigService } from './empresaConfigService';
import { planillaEmpleadosService } from './planillaEmpleadosService';
import {
    armarFilasEmpleadoPlanillaUnica,
    type FilaPlanillaUnica,
    type DatosEmpleadoMesPlanillaUnica,
} from '../utils/planillaUnicaUtils';

export interface PeriodoPlanillaUnica {
    mes0: number;
    anio: number;
    fechaInicioMes: string;
    fechaFinMes: string;
}

/**
 * IMPL-99 — arma las 21-columnas de la Planilla Única ISSS/AFP consolidando ambas quincenas del
 * mes (`primeraQuincenaId`/`segundaQuincenaId`, ver `resolverMesCompletoPlanillaUnica`). Solo
 * hace fetch de datos ya persistidos por el motor de planilla/incapacidades/vacaciones — no
 * recalcula nada (mismo criterio que `exportacionesContablesService`). "Empleado activo ese mes"
 * = UNIÓN de empleados con cálculo en cualquiera de las 2 quincenas (no intersección, para no
 * perder a quien solo trabajó una de las dos, ej. alta/baja a mitad de mes).
 */
export async function generarFilasPlanillaUnica(
    primeraQuincenaId: string,
    segundaQuincenaId: string,
    periodo: PeriodoPlanillaUnica,
): Promise<FilaPlanillaUnica[]> {
    const [config, calculos, empleados] = await Promise.all([
        empresaConfigService.getConfig(),
        calculoPlanillaService.getPorQuincenas([primeraQuincenaId, segundaQuincenaId]),
        planillaEmpleadosService.getEmpleadosParaReportes(),
    ]);

    const empleadoIds = Array.from(new Set(calculos.map((c) => c.empleado_id)));
    if (empleadoIds.length === 0) return [];

    const [incapacidades, vacaciones] = await Promise.all([
        incapacidadesService.getActivasPorEmpleados(empleadoIds, periodo.fechaInicioMes, periodo.fechaFinMes),
        vacacionesService.getActivasPorEmpleados(empleadoIds, periodo.fechaInicioMes, periodo.fechaFinMes),
    ]);

    const empleadoPorId = new Map(empleados.map((e) => [e.id, e]));
    const incapacidadPorEmpleado = new Set(incapacidades.map((i) => i.empleado_id));
    const vacacionesPorEmpleado = new Map<string, { montoTotal: number; diasGozados: number }>();
    for (const v of vacaciones) {
        const actual = vacacionesPorEmpleado.get(v.empleado_id) ?? { montoTotal: 0, diasGozados: 0 };
        vacacionesPorEmpleado.set(v.empleado_id, {
            montoTotal: actual.montoTotal + v.monto_total,
            diasGozados: actual.diasGozados + (v.no_gozada ? 0 : v.dias),
        });
    }

    const calculosPorEmpleado = new Map<string, number[]>();
    for (const c of calculos) {
        const lista = calculosPorEmpleado.get(c.empleado_id) ?? [];
        lista.push(c.total_ingresos_gravables);
        calculosPorEmpleado.set(c.empleado_id, lista);
    }

    const empresaInput = {
        nitDuiEmpleador: config?.nit ?? '',
        numeroPatronalIsss: config?.numero_patronal_isss ?? '',
    };

    const filas: FilaPlanillaUnica[] = [];
    for (const empleadoId of empleadoIds) {
        const emp = empleadoPorId.get(empleadoId);
        if (!emp) continue;

        const datosMes: DatosEmpleadoMesPlanillaUnica = {
            totalIngresosGravablesPorQuincena: calculosPorEmpleado.get(empleadoId) ?? [],
            vacacionesDelMes: vacacionesPorEmpleado.get(empleadoId) ?? { montoTotal: 0, diasGozados: 0 },
            tieneIncapacidadEsteMes: incapacidadPorEmpleado.has(empleadoId),
        };

        filas.push(...armarFilasEmpleadoPlanillaUnica(
            {
                id: emp.id,
                nombreCompleto: emp.nombre_completo,
                dui: emp.dui,
                fechaIngreso: emp.fecha_ingreso,
                tipoAfiliacion: emp.tipo_afiliacion,
                numeroAfiliadoIsss: emp.numero_afiliado_isss,
                // Reconstrucción histórica vía audit log todavía no está construida (ver gotcha
                // en `resolverInstitucionPrevisionalPlanillaUnica`) — institución queda vacía
                // para jubilados hasta que exista.
                afpOrigenJubilado: null,
            },
            empresaInput,
            periodo,
            datosMes,
        ));
    }

    return filas;
}
