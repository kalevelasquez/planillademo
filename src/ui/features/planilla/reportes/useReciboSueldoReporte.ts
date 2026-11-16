import { useEffect, useState } from 'react';
import { calculoPlanillaService } from '../../../../services/calculoPlanillaService';
import { quincenasService, type Quincena } from '../../../../services/quincenasService';
import { horasExtrasManualService, type HorasExtrasManualRow } from '../../../../services/horasExtrasManualService';
import { descuentosService, type Descuento } from '../../../../services/descuentosService';
import { descuentoCategoriasService } from '../../../../services/descuentoCategoriasService';
import { planillaEmpleadosService } from '../../../../services/planillaEmpleadosService';
import { auditService, type AuditEntry } from '../../../../services/auditService';
import { calcularReciboSueldoDatos, type ReciboSueldoDatos, type EdicionSueldo } from '../../../../utils/reciboSueldoUtils';
import { useAuthStore } from '../../../../store/authStore';
import { Logger } from '../../../../utils/logger';

/** IMPL-158 (hallazgo UAT) — traduce filas crudas de `audit_log` a `EdicionSueldo`, filtrando
 * por la acción y descartando entradas mal formadas (`new_values` sin `anterior`/`nuevo`
 * numéricos) en vez de dejar que revienten el cálculo del desglose de horas extra. */
function mapearEdicionesSueldo(entradas: AuditEntry[]): EdicionSueldo[] {
    return entradas
        .filter((e) => e.action === 'EDICION_SUELDO' && typeof e.new_values?.anterior === 'number' && typeof e.new_values?.nuevo === 'number')
        .map((e) => ({ created_at: e.created_at, anterior: e.new_values.anterior, nuevo: e.new_values.nuevo }));
}

type EmpleadoReporte = Awaited<ReturnType<typeof planillaEmpleadosService.getEmpleadosParaReportes>>[number];

/**
 * Hook del Recibo de Sueldo (US-EXP-05, IMPL-158) — carga empleados + quincenas una vez.
 * `generarIndividual` arma el DTO de un solo empleado en una quincena; `generarMasivo` arma el
 * DTO de todos los empleados calculados en esa quincena, sin N+1 (una sola llamada por fuente,
 * agrupado client-side).
 */
export function useReciboSueldoReporte() {
    const { profile } = useAuthStore();
    const [empleados, setEmpleados] = useState<EmpleadoReporte[]>([]);
    const [quincenas, setQuincenas] = useState<Quincena[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        Promise.all([planillaEmpleadosService.getEmpleadosParaReportes(), quincenasService.getQuincenas()])
            .then(([empleadosData, quincenasData]) => {
                setEmpleados(empleadosData);
                setQuincenas(quincenasData);
            })
            .catch((err: unknown) => Logger.error('Error al cargar datos base de Recibo de Sueldo', {}, err))
            .finally(() => setIsLoading(false));
    }, []);

    const generarIndividual = async (empleado: EmpleadoReporte, quincenaId: string): Promise<ReciboSueldoDatos | null> => {
        const quincena = quincenas.find((q) => q.id === quincenaId);
        if (!quincena) return null;

        const [calculos, horasRows, descuentosEmpleado, categorias, historialSueldo] = await Promise.all([
            calculoPlanillaService.getPorQuincena(quincenaId),
            horasExtrasManualService.getPorEmpleadoYQuincena(empleado.id, quincenaId),
            descuentosService.getPorEmpleado(empleado.id),
            descuentoCategoriasService.getTodos(),
            // IMPL-158 (hallazgo UAT) — necesario para el desglose de horas extra, ver
            // `resolverSueldoVigenteEnFecha`. `profile` ya está cargado cuando este hook es
            // utilizable (requiere sesión activa), así que `!` es seguro acá.
            auditService.getResourceHistory(profile!.tenant_id, 'planilla_empleados', empleado.id),
        ]);
        const calculo = calculos.find((c) => c.empleado_id === empleado.id);
        if (!calculo) return null;

        return calcularReciboSueldoDatos(empleado, calculo, horasRows, descuentosEmpleado, categorias, quincena, mapearEdicionesSueldo(historialSueldo));
    };

    const generarMasivo = async (quincenaId: string): Promise<ReciboSueldoDatos[]> => {
        const quincena = quincenas.find((q) => q.id === quincenaId);
        if (!quincena) return [];

        const [calculos, horasRows, descuentosTodos, categorias, edicionesSueldoLog] = await Promise.all([
            calculoPlanillaService.getPorQuincena(quincenaId),
            horasExtrasManualService.getPorQuincena(quincenaId),
            descuentosService.getTodos(),
            descuentoCategoriasService.getTodos(),
            // IMPL-158 (hallazgo UAT) — una sola consulta para todo el tenant, agrupada
            // client-side por empleado más abajo, en vez de N+1 por empleado del lote.
            auditService.getAuditLogs(profile!.tenant_id, 1, 5000, { action: 'EDICION_SUELDO', resourceType: 'planilla_empleados' }),
        ]);
        const empleadosPorId = new Map(empleados.map((e) => [e.id, e]));
        const horasPorEmpleado = new Map<string, HorasExtrasManualRow[]>();
        for (const row of horasRows) {
            if (!horasPorEmpleado.has(row.empleado_id)) horasPorEmpleado.set(row.empleado_id, []);
            horasPorEmpleado.get(row.empleado_id)!.push(row);
        }
        const descuentosPorEmpleado = new Map<string, Descuento[]>();
        for (const d of descuentosTodos) {
            if (!descuentosPorEmpleado.has(d.empleado_id)) descuentosPorEmpleado.set(d.empleado_id, []);
            descuentosPorEmpleado.get(d.empleado_id)!.push(d);
        }
        const edicionesSueldoPorEmpleado = new Map<string, AuditEntry[]>();
        for (const entrada of edicionesSueldoLog.data) {
            if (!entrada.resource_id) continue;
            if (!edicionesSueldoPorEmpleado.has(entrada.resource_id)) edicionesSueldoPorEmpleado.set(entrada.resource_id, []);
            edicionesSueldoPorEmpleado.get(entrada.resource_id)!.push(entrada);
        }

        return calculos
            .map((calculo) => {
                const empleado = empleadosPorId.get(calculo.empleado_id);
                if (!empleado) return null;
                return calcularReciboSueldoDatos(
                    empleado, calculo, horasPorEmpleado.get(calculo.empleado_id) ?? [],
                    descuentosPorEmpleado.get(calculo.empleado_id) ?? [], categorias, quincena,
                    mapearEdicionesSueldo(edicionesSueldoPorEmpleado.get(calculo.empleado_id) ?? []),
                );
            })
            .filter((r): r is ReciboSueldoDatos => r !== null);
    };

    return { empleados, quincenas, isLoading, generarIndividual, generarMasivo };
}
