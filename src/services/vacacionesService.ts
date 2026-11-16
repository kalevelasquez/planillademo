import { supabase } from '../config/supabaseClient';

export interface Vacacion {
    id: string;
    tenant_id: string;
    quincena_id: string;
    empleado_id: string;
    fecha_inicio: string;
    fecha_fin: string;
    dias: number;
    sueldo_diario: number;
    monto_base: number;
    recargo_30: number;
    monto_total: number;
    conciliado: boolean;
    no_gozada: boolean;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface NuevaVacacion {
    quincenaId: string;
    empleadoId: string;
    fechaInicio: string;
    fechaFin: string;
    sueldoMensual: number;
    noGozada: boolean;
    userId: string;
    conciliado: boolean;
}

export interface ActualizarVacacionDTO {
    empleadoId: string;
    fechaInicio: string;
    fechaFin: string;
    sueldoMensual: number;
    noGozada: boolean;
    conciliado: boolean;
}

/** Feature 2 (adelanto del 30% de recargo en el aniversario, reunión 2026-10-05). */
export interface AdelantoRecargoVacacion {
    id: string;
    tenant_id: string;
    quincena_id: string;
    empleado_id: string;
    anio_aniversario: number;
    sueldo_diario: number;
    recargo_monto: number;
    consumido_en_vacacion_id: string | null;
    created_by: string | null;
    created_at: string;
}

export interface NuevoAdelantoRecargoVacacion {
    empleadoId: string;
    quincenaId: string;
    anioAniversario: number;
    sueldoMensual: number;
    userId: string;
}

export const vacacionesService = {
    async getPorQuincena(quincenaId: string): Promise<Vacacion[]> {
        const { data, error } = await supabase
            .from('planilla_vacaciones')
            .select('*')
            .eq('quincena_id', quincenaId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    /** US-EMP-05 (IMPL-7) — historial completo de un empleado, para el resumen de
     * vacaciones del perfil (días gozados = SUM(dias) WHERE NOT no_gozada). */
    async getPorEmpleado(empleadoId: string): Promise<Vacacion[]> {
        const { data, error } = await supabase
            .from('planilla_vacaciones')
            .select('*')
            .eq('empleado_id', empleadoId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    /**
     * Vacaciones de un grupo de empleados cuyo rango se solapa con [fechaInicio, fechaFin]
     * (US-HEX-04 CA7, revisión épica por épica) — mismo criterio que
     * `incapacidadesService.getActivasPorEmpleados` (filtra por solape de rango, no por
     * `quincena_id`). El llamador debe excluir `no_gozada = true` si corresponde: esos días
     * se pagaron pero el empleado no estuvo realmente ausente.
     */
    async getActivasPorEmpleados(empleadoIds: string[], fechaInicio: string, fechaFin: string): Promise<Vacacion[]> {
        if (empleadoIds.length === 0) return [];
        const { data, error } = await supabase
            .from('planilla_vacaciones')
            .select('*')
            .in('empleado_id', empleadoIds)
            .lte('fecha_inicio', fechaFin)
            .gte('fecha_fin', fechaInicio);
        if (error) throw error;
        return data || [];
    },

    /** US-VAC-00 (IMPL-64) — todas las vacaciones del tenant, para el calendario mensual
     * navegable (CA2), que puede mostrar meses fuera de la quincena activa. */
    async getTodas(): Promise<Vacacion[]> {
        const { data, error } = await supabase
            .from('planilla_vacaciones')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    async crear(payload: NuevaVacacion): Promise<Vacacion> {
        const { data, error } = await supabase.rpc('crear_vacacion', {
            p_quincena_id: payload.quincenaId,
            p_empleado_id: payload.empleadoId,
            p_fecha_inicio: payload.fechaInicio,
            p_fecha_fin: payload.fechaFin,
            p_sueldo_mensual: payload.sueldoMensual,
            p_no_gozada: payload.noGozada,
            p_user_id: payload.userId,
            p_conciliado: payload.conciliado,
        });
        if (error) throw error;
        return data;
    },

    async actualizar(id: string, payload: ActualizarVacacionDTO): Promise<Vacacion> {
        const { data, error } = await supabase.rpc('actualizar_vacacion', {
            p_id: id,
            p_empleado_id: payload.empleadoId,
            p_fecha_inicio: payload.fechaInicio,
            p_fecha_fin: payload.fechaFin,
            p_sueldo_mensual: payload.sueldoMensual,
            p_no_gozada: payload.noGozada,
            p_conciliado: payload.conciliado,
        });
        if (error) throw error;
        return data;
    },

    /**
     * US-VAC-03 (IMPL-67) CA1 — toggle rápido desde el listado, sin abrir el formulario.
     * `.maybeSingle()` en vez de `.single()` (revisión épica por épica) — si el UPDATE es
     * bloqueado por RLS (quincena no `en_proceso`), PostgREST devuelve 0 filas sin error;
     * `.single()` lo convertiría en un error genérico PGRST116 en vez de un mensaje claro.
     */
    async cambiarConciliado(id: string, conciliado: boolean): Promise<Vacacion> {
        const { data, error } = await supabase
            .from('planilla_vacaciones')
            .update({ conciliado })
            .eq('id', id)
            .select()
            .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Esta quincena está cerrada y no permite modificaciones.');
        return data;
    },

    /** DELETE sin .select() no distingue "bloqueado por RLS" de "borrado con éxito" — ambos
     * devuelven 0 filas sin error (mismo patrón corregido en incapacidadesService/
     * anticiposService, revisión épica por épica de Vacaciones/IMPL-65-66). */
    async eliminar(id: string): Promise<void> {
        const { data, error } = await supabase.from('planilla_vacaciones').delete().eq('id', id).select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('Esta quincena está cerrada y no permite modificaciones.');
    },

    /** Feature 2 — todos los adelantos sin consumir del tenant (RLS ya filtra por tenant), para
     * que la UI sepa qué empleados ya tienen un adelanto pendiente y no vuelva a ofrecer el botón. */
    async getAdelantosActivos(): Promise<AdelantoRecargoVacacion[]> {
        const { data, error } = await supabase
            .from('planilla_vacaciones_adelanto_recargo')
            .select('*')
            .is('consumido_en_vacacion_id', null);
        if (error) throw error;
        return data || [];
    },

    async crearAdelantoRecargo(payload: NuevoAdelantoRecargoVacacion): Promise<AdelantoRecargoVacacion> {
        const { data, error } = await supabase.rpc('crear_adelanto_recargo_vacacion', {
            p_empleado_id: payload.empleadoId,
            p_quincena_id: payload.quincenaId,
            p_anio_aniversario: payload.anioAniversario,
            p_sueldo_mensual: payload.sueldoMensual,
            p_user_id: payload.userId,
        });
        if (error) throw error;
        return data;
    },

    /** DELETE sin .select() no distingue "bloqueado por RLS" de "borrado con éxito" (mismo
     * patrón que `eliminar`) — bloqueado acá significa quincena cerrada O que ya fue consumido
     * por una vacación real. */
    async eliminarAdelantoRecargo(id: string): Promise<void> {
        const { data, error } = await supabase.from('planilla_vacaciones_adelanto_recargo').delete().eq('id', id).select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('No se puede deshacer: la quincena está cerrada, o este adelanto ya fue aplicado a una vacación real.');
    },
};
