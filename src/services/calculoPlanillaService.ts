import { supabase } from '../config/supabaseClient';

export interface CalculoEmpleado {
    id: string;
    tenant_id: string;
    quincena_id: string;
    empleado_id: string;
    dias_habiles_quincena: number;
    dias_laborados: number;
    sueldo_quincenal_base: number;
    sueldo_proporcional: number;
    /** IMPL-181 (US-PER-01 CA4) — total ya restado de sueldo_proporcional por permisos "sin_goce"
     * de esta quincena. Informativo/auditable: el sueldo proporcional persistido YA viene neto
     * de este monto (ver Paso 2b del motor), esta columna solo expone cuánto de esa resta fue
     * por permisos. */
    permisos_sin_goce_monto: number;
    horas_extras_monto: number;
    viaticos_monto: number;
    viaticos_bono10_base: number;
    vacaciones_monto: number;
    vacaciones_bono10_base: number;
    bonificaciones_monto: number;
    otros_ingresos_gravables: number;
    otros_ingresos_no_gravables: number;
    otros_ingresos_bono10_base: number;
    incapacidad_bono10_base: number;
    total_ingresos_gravables: number;
    isss_empleado: number;
    afp_empleado: number;
    /** IMPL-87 CA4 — IPSFA (militares afiliados), cotización de retiro distinta de AFP. 0 para
     * cualquier empleado que no tenga tipo_afiliacion='ipsfa'. */
    ipsfa_empleado: number;
    deduccion_fija_aplicada: number;
    deduccion_fija_motivo: string | null;
    base_renta: number;
    renta_isr: number;
    base_bono10_total: number;
    renta_bono10: number;
    descuentos_obligatorios_total: number;
    descuentos_no_obligatorios_solicitado: number;
    descuentos_no_obligatorios_aplicado: number;
    descuentos_tope_20_base: number;
    descuentos_excedente_diferido: number;
    descuentos_alerta_tope_superado: boolean;
    alerta_neto_bajo_minimo: boolean;
    descuentos_detalle: Array<{ categoria: string; monto: number; aplicado: number; diferido: number }>;
    total_no_gravable: number;
    neto_a_pagar: number;
    isss_patronal: number;
    afp_patronal: number;
    ipsfa_patronal: number;
    insaforp_patronal: number;
    config_fiscal_id: string;
    tramos_renta_vigente_desde: string;
    tipo_quincena: string;
    calculado_por: string | null;
    calculado_at: string;
}

export const calculoPlanillaService = {
    async getPorQuincena(quincenaId: string): Promise<CalculoEmpleado[]> {
        const { data, error } = await supabase
            .from('planilla_calculo_empleado')
            .select('*')
            .eq('quincena_id', quincenaId)
            .order('neto_a_pagar', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    /** US-EXP-04 (IMPL-157) — snapshots de varias quincenas a la vez (ventana de 6 meses para
     * el promedio de la Constancia de Salario), mismo patrón que `getConteoPorQuincenas`. El
     * llamador filtra por `empleado_id` client-side. */
    async getPorQuincenas(quincenaIds: string[]): Promise<CalculoEmpleado[]> {
        if (quincenaIds.length === 0) return [];
        const { data, error } = await supabase
            .from('planilla_calculo_empleado')
            .select('*')
            .in('quincena_id', quincenaIds);
        if (error) throw error;
        return data || [];
    },

    /**
     * Conteo real de empleados vinculados (calculados) por quincena — reemplaza el proxy de
     * "activos totales" en los dashboards de Preparador/Aprobador/Historial (IMPL-10/17/18,
     * revisión épica por épica). Una sola consulta para N quincenas, no N+1.
     */
    async getConteoPorQuincenas(quincenaIds: string[]): Promise<Record<string, number>> {
        if (quincenaIds.length === 0) return {};
        const { data, error } = await supabase
            .from('planilla_calculo_empleado')
            .select('quincena_id')
            .in('quincena_id', quincenaIds);
        if (error) throw error;
        return (data || []).reduce<Record<string, number>>((acc, row) => {
            acc[row.quincena_id] = (acc[row.quincena_id] ?? 0) + 1;
            return acc;
        }, {});
    },

    /** US-CALC-04 (IMPL-90) — botón "Calcular Planilla de esta Quincena". Idempotente: cada
     * corrida hace UPSERT por empleado (ON CONFLICT DO UPDATE en el RPC), nunca duplica filas. */
    async calcularQuincena(quincenaId: string, userId: string): Promise<CalculoEmpleado[]> {
        const { data, error } = await supabase.rpc('calcular_planilla_quincena', {
            p_quincena_id: quincenaId,
            p_user_id: userId,
        });
        if (error) throw error;
        return data || [];
    },

    /** Auditoría: "Calcular Planilla" contaba como $0 los anticipos/descuentos que todavía no
     * pasaron por "Procesar Cuotas" (el motor solo lee eventos ya creados) — permite mostrar la
     * advertencia ANTES de calcular, mismo criterio exacto que usan los RPCs de procesamiento. */
    async contarPendientesProcesar(quincenaId: string): Promise<{ anticipos: number; descuentos: number }> {
        const { data, error } = await supabase
            .rpc('contar_anticipos_descuentos_pendientes', { p_quincena_id: quincenaId })
            .single();
        if (error) throw error;
        const fila = data as { anticipos_pendientes: number; descuentos_pendientes: number } | null;
        return { anticipos: fila?.anticipos_pendientes ?? 0, descuentos: fila?.descuentos_pendientes ?? 0 };
    },

    /** US-CALC-08 (IMPL-94) — solo aplica a la 2ª quincena de junio/diciembre (el RPC valida y
     * rechaza si no lo es). CA3: si se retuvo de más, no ajusta (sin devolución vía sistema). */
    async recalcularRentaSemestral(quincenaId: string, userId: string): Promise<CalculoEmpleado[]> {
        const { data, error } = await supabase.rpc('recalcular_renta_semestral', {
            p_quincena_id: quincenaId,
            p_user_id: userId,
        });
        if (error) throw error;
        return data || [];
    },
};
