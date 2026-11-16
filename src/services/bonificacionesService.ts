import { supabase } from '../config/supabaseClient';
import type { Gravabilidad } from './otrosIngresosConceptosService';

export type OrigenBonificacion = 'manual' | 'automatico';

export interface Bonificacion {
    id: string;
    tenant_id: string;
    quincena_id: string;
    empleado_id: string;
    tipo_id: string | null;
    monto: number;
    gravabilidad: Gravabilidad;
    origen: OrigenBonificacion;
    tabla_incentivo_id: string | null;
    utilidad_neta_mes: number | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface NuevaBonificacionManual {
    quincenaId: string;
    empleadoId: string | null;
    todosEmpleados: boolean;
    tipoId: string;
    monto: number;
    gravabilidad: Gravabilidad;
    userId: string;
}

export const bonificacionesService = {
    async getPorQuincena(quincenaId: string): Promise<Bonificacion[]> {
        const { data, error } = await supabase
            .from('planilla_bonificaciones')
            .select('*')
            .eq('quincena_id', quincenaId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    /** US-BON-02 (IMPL-74) CA1 — dispara el cálculo automático server-side; idempotente
     * (recalcular con otra utilidad neta actualiza el monto en vez de duplicar filas). */
    async calcularAutomaticos(quincenaId: string, utilidadNeta: number, userId: string): Promise<Bonificacion[]> {
        const { data, error } = await supabase.rpc('calcular_bonos_incentivo_quincena', {
            p_quincena_id: quincenaId,
            p_utilidad_neta: utilidadNeta,
            p_user_id: userId,
        });
        if (error) throw error;
        return data || [];
    },

    /** US-BON-03 (IMPL-75) CA1 — soporta "Todos los empleados" via `todosEmpleados`, un mismo
     * monto para cada empleado activo (bulk-RPC-loop, mismo patrón que "procesar cuotas"). */
    async crearManual(payload: NuevaBonificacionManual): Promise<Bonificacion[]> {
        const { data, error } = await supabase.rpc('crear_bonificacion_manual', {
            p_quincena_id: payload.quincenaId,
            p_empleado_id: payload.empleadoId,
            p_todos_empleados: payload.todosEmpleados,
            p_tipo_id: payload.tipoId,
            p_monto: payload.monto,
            p_gravabilidad: payload.gravabilidad,
            p_user_id: payload.userId,
        });
        if (error) throw error;
        return data || [];
    },

    /** US-BON-04 (IMPL-76) — la UI restringe qué campos exponer según `origen` (ver comentario
     * de la migración), pero el RPC acepta ambos orígenes sin distinción. */
    async actualizar(id: string, tipoId: string | null, monto: number, gravabilidad: Gravabilidad): Promise<Bonificacion> {
        const { data, error } = await supabase.rpc('actualizar_bonificacion', {
            p_id: id,
            p_tipo_id: tipoId,
            p_monto: monto,
            p_gravabilidad: gravabilidad,
        });
        if (error) throw error;
        return data;
    },

    /** DELETE sin .select() no distingue "bloqueado por RLS" de "borrado con éxito" —
     * ambos devuelven 0 filas sin error (IMPL-104/CA1). */
    async eliminar(id: string): Promise<void> {
        const { data, error } = await supabase.from('planilla_bonificaciones').delete().eq('id', id).select('id');
        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error('Esta quincena está cerrada y no permite modificaciones.');
        }
    },
};
