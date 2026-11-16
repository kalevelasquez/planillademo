import { supabase } from '../config/supabaseClient';

export type GranularidadPermiso = 'dia_completo' | 'medio_dia' | 'horas';
export type TurnoPermiso = 'manana' | 'tarde';
export type TipoPermiso = 'con_goce' | 'sin_goce';

export interface Permiso {
    id: string;
    tenant_id: string;
    quincena_id: string;
    empleado_id: string;
    grupo_id: string;
    fecha: string;
    granularidad: GranularidadPermiso;
    turno: TurnoPermiso | null;
    horas: number | null;
    tipo: TipoPermiso;
    motivo: string;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface NuevoPermiso {
    tenant_id: string;
    quincena_id: string;
    empleado_id: string;
    grupo_id: string;
    fecha: string;
    granularidad: GranularidadPermiso;
    turno: TurnoPermiso | null;
    horas: number | null;
    tipo: TipoPermiso;
    motivo: string;
    created_by: string;
}

export type UpdatePermisoDTO = Partial<Omit<NuevoPermiso, 'tenant_id' | 'quincena_id' | 'created_by'>>;

export const permisosService = {
    async getPorQuincena(quincenaId: string): Promise<Permiso[]> {
        const { data, error } = await supabase
            .from('planilla_permisos')
            .select('*')
            .eq('quincena_id', quincenaId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    /** Inserta todas las filas de un mismo trámite (mismo `grupo_id`) en un solo INSERT —
     * usado para el caso multi-día (ej. medio día hoy + día completo mañana). */
    async crearVarios(payloads: NuevoPermiso[]): Promise<Permiso[]> {
        const { data, error } = await supabase
            .from('planilla_permisos')
            .insert(payloads)
            .select();
        if (error) throw error;
        return data || [];
    },

    /** `.maybeSingle()` en vez de `.single()` (mismo patrón que incapacidadesService, IMPL-45)
     * — si el UPDATE es bloqueado por RLS (quincena no en_proceso), PostgREST devuelve 0 filas
     * sin error; sin esto se vería un error genérico PGRST116 en vez del mensaje de negocio. */
    async actualizar(id: string, payload: UpdatePermisoDTO): Promise<Permiso> {
        const { data, error } = await supabase
            .from('planilla_permisos')
            .update(payload)
            .eq('id', id)
            .select()
            .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Esta quincena está cerrada y no permite modificaciones.');
        return data;
    },

    /** DELETE con `.select('id')` para distinguir "bloqueado por RLS" (0 filas, sin error) de
     * "borrado con éxito" — mismo patrón que incapacidadesService. */
    async eliminar(id: string): Promise<void> {
        const { data, error } = await supabase
            .from('planilla_permisos')
            .delete()
            .eq('id', id)
            .select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('Esta quincena está cerrada y no permite modificaciones.');
    },

    /** US-EMP-05-like (mismo criterio que vacacionesService.getPorEmpleado, IMPL-7) — historial
     * completo de un empleado, reusable a futuro por el perfil de empleado. */
    async getPorEmpleado(empleadoId: string): Promise<Permiso[]> {
        const { data, error } = await supabase
            .from('planilla_permisos')
            .select('*')
            .eq('empleado_id', empleadoId)
            .order('fecha', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    /** US-EXP-10 (IMPL-166) — todos los permisos del tenant, cross-quincena, para el reporte de
     * Historial/Estado de Permisos (mismo criterio que vacacionesService.getTodas, IMPL-64). */
    async getTodas(): Promise<Permiso[]> {
        const { data, error } = await supabase
            .from('planilla_permisos')
            .select('*')
            .order('fecha', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    /** Elimina todas las filas de un trámite multi-día de una sola vez. */
    async eliminarGrupo(grupoId: string): Promise<void> {
        const { data, error } = await supabase
            .from('planilla_permisos')
            .delete()
            .eq('grupo_id', grupoId)
            .select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('Esta quincena está cerrada y no permite modificaciones.');
    },
};
