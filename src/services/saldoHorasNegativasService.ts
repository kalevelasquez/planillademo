import { supabase } from '../config/supabaseClient';

export interface SaldoHorasNegativas {
    empleado_id: string;
    saldo_horas: number;
    actualizado_por: string | null;
    actualizado_at: string | null;
}

export const saldoHorasNegativasService = {
    /**
     * US-HEX-11 CA1 — saldo corriente de horas negativas pendientes por empleado, no scoped a
     * ninguna quincena puntual (a diferencia de planilla_horas_extras_manual): sobrevive de un
     * período al siguiente sin que el responsable tenga que volver a tipearlo cada quincena.
     */
    async getPorEmpleados(empleadoIds: string[]): Promise<SaldoHorasNegativas[]> {
        if (empleadoIds.length === 0) return [];
        const { data, error } = await supabase
            .from('planilla_saldo_horas_negativas')
            .select('empleado_id, saldo_horas, actualizado_por, actualizado_at')
            .in('empleado_id', empleadoIds);
        if (error) throw error;
        return data || [];
    },

    async actualizarSaldo(empleadoId: string, tenantId: string, saldoHoras: number, userId: string): Promise<void> {
        const { error } = await supabase
            .from('planilla_saldo_horas_negativas')
            .upsert({
                tenant_id: tenantId,
                empleado_id: empleadoId,
                saldo_horas: saldoHoras,
                actualizado_por: userId,
                actualizado_at: new Date().toISOString(),
            }, { onConflict: 'empleado_id' });
        if (error) throw error;
    },
};
