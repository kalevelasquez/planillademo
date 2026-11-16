import { supabase } from '../config/supabaseClient';
import type { Gravabilidad } from './otrosIngresosConceptosService';

export interface OtroIngreso {
    id: string;
    tenant_id: string;
    quincena_id: string;
    empleado_id: string;
    concepto_id: string;
    monto: number;
    gravabilidad: Gravabilidad;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface NuevoOtroIngreso {
    quincenaId: string;
    empleadoId: string;
    conceptoId: string;
    monto: number;
    gravabilidad: Gravabilidad;
    userId: string;
}

export interface ActualizarOtroIngresoDTO {
    empleadoId: string;
    conceptoId: string;
    monto: number;
    gravabilidad: Gravabilidad;
}

export const otrosIngresosService = {
    async getPorQuincena(quincenaId: string): Promise<OtroIngreso[]> {
        const { data, error } = await supabase
            .from('planilla_otros_ingresos')
            .select('*')
            .eq('quincena_id', quincenaId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    async crear(payload: NuevoOtroIngreso): Promise<OtroIngreso> {
        const { data, error } = await supabase.rpc('crear_otro_ingreso', {
            p_quincena_id: payload.quincenaId,
            p_empleado_id: payload.empleadoId,
            p_concepto_id: payload.conceptoId,
            p_monto: payload.monto,
            p_gravabilidad: payload.gravabilidad,
            p_user_id: payload.userId,
        });
        if (error) throw error;
        return data;
    },

    /** US-OTR-02 (IMPL-79) — sin restricciones de campo, editable igual que en el alta. */
    async actualizar(id: string, payload: ActualizarOtroIngresoDTO): Promise<OtroIngreso> {
        const { data, error } = await supabase.rpc('actualizar_otro_ingreso', {
            p_id: id,
            p_empleado_id: payload.empleadoId,
            p_concepto_id: payload.conceptoId,
            p_monto: payload.monto,
            p_gravabilidad: payload.gravabilidad,
        });
        if (error) throw error;
        return data;
    },

    /** US-OTR-02 (IMPL-79). DELETE sin .select() no distingue "bloqueado por RLS" de
     * "borrado con éxito" — ambos devuelven 0 filas sin error (IMPL-104/CA1). */
    async eliminar(id: string): Promise<void> {
        const { data, error } = await supabase.from('planilla_otros_ingresos').delete().eq('id', id).select('id');
        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error('Esta quincena está cerrada y no permite modificaciones.');
        }
    },
};
