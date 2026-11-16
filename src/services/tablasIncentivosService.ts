import { supabase } from '../config/supabaseClient';

export interface TablaIncentivo {
    id: string;
    tenant_id: string;
    nombre: string;
    empleado_id: string | null;
    grupo: string | null;
    activo: boolean;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface RangoIncentivo {
    id: string;
    tenant_id: string;
    tabla_id: string;
    desde: number;
    hasta: number | null;
    bono: number;
    created_at: string;
    updated_at: string;
}

export interface TablaIncentivoConRangos extends TablaIncentivo {
    rangos: RangoIncentivo[];
}

export interface NuevoRango {
    desde: number;
    hasta: number | null;
    bono: number;
}

export interface NuevaTablaIncentivo {
    nombre: string;
    empleadoId: string | null;
    grupo: string | null;
    rangos: NuevoRango[];
    userId: string;
}

export interface EdicionTablaIncentivo {
    nombre: string;
    empleadoId: string | null;
    grupo: string | null;
    rangos: NuevoRango[];
}

export const tablasIncentivosService = {
    async getTodas(): Promise<TablaIncentivoConRangos[]> {
        const [{ data: tablas, error: errorTablas }, { data: rangos, error: errorRangos }] = await Promise.all([
            supabase.from('planilla_tablas_incentivos').select('*').order('nombre', { ascending: true }),
            supabase.from('planilla_tablas_incentivos_rangos').select('*').order('desde', { ascending: true }),
        ]);
        if (errorTablas) throw errorTablas;
        if (errorRangos) throw errorRangos;

        return (tablas || []).map((tabla) => ({
            ...tabla,
            rangos: (rangos || []).filter((r) => r.tabla_id === tabla.id),
        }));
    },

    async crear(payload: NuevaTablaIncentivo): Promise<TablaIncentivo> {
        const { data, error } = await supabase.rpc('crear_tabla_incentivo', {
            p_nombre: payload.nombre,
            p_empleado_id: payload.empleadoId,
            p_grupo: payload.grupo,
            p_rangos: payload.rangos,
            p_user_id: payload.userId,
        });
        if (error) throw error;
        return data;
    },

    async actualizar(id: string, payload: EdicionTablaIncentivo): Promise<TablaIncentivo> {
        const { data, error } = await supabase.rpc('actualizar_tabla_incentivo', {
            p_id: id,
            p_nombre: payload.nombre,
            p_empleado_id: payload.empleadoId,
            p_grupo: payload.grupo,
            p_rangos: payload.rangos,
        });
        if (error) throw error;
        return data;
    },

    async cambiarActivo(id: string, activo: boolean): Promise<TablaIncentivo> {
        const { data, error } = await supabase
            .from('planilla_tablas_incentivos')
            .update({ activo })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async eliminar(id: string): Promise<void> {
        const { error } = await supabase.from('planilla_tablas_incentivos').delete().eq('id', id);
        if (error) throw error;
    },
};
