import { supabase } from '../config/supabaseClient';
import type { TipoIncapacidad } from '../utils/incapacidadesUtils';

export interface Incapacidad {
    id: string;
    tenant_id: string;
    quincena_id: string;
    empleado_id: string;
    numero_cit: string;
    fecha_inicio: string;
    fecha_fin: string;
    tipo: TipoIncapacidad;
    dias: number;
    con_subsidio: boolean;
    dias_cubiertos_imporfrut: number;
    dia_inicio_subsidio_isss: number | null;
    trabajo_durante_incapacidad: boolean;
    monto_bono_trabajado: number | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface NuevaIncapacidad {
    tenant_id: string;
    quincena_id: string;
    empleado_id: string;
    numero_cit: string;
    fecha_inicio: string;
    fecha_fin: string;
    tipo: TipoIncapacidad;
    dias: number;
    con_subsidio: boolean;
    dias_cubiertos_imporfrut: number;
    dia_inicio_subsidio_isss: number | null;
    trabajo_durante_incapacidad: boolean;
    monto_bono_trabajado: number | null;
    created_by: string;
}

export type UpdateIncapacidadDTO = Partial<Omit<NuevaIncapacidad, 'tenant_id' | 'quincena_id' | 'created_by'>>;

export const incapacidadesService = {
    async getPorQuincena(quincenaId: string): Promise<Incapacidad[]> {
        const { data, error } = await supabase
            .from('planilla_incapacidades')
            .select('*')
            .eq('quincena_id', quincenaId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    /**
     * Incapacidades de un grupo de empleados cuyo rango [fecha_inicio, fecha_fin] se solapa
     * con [fechaInicio, fechaFin] (US-HEX-04 CA7, revisión épica por épica) — usado para
     * advertir en la importación de marcaciones si un empleado marcó asistencia teniendo una
     * incapacidad activa. Filtra por solape de rango, NO por `quincena_id`, porque una
     * incapacidad puede haberse registrado en una quincena distinta a la de la marcación si
     * su rango cruza el corte de quincena.
     */
    async getActivasPorEmpleados(empleadoIds: string[], fechaInicio: string, fechaFin: string): Promise<Incapacidad[]> {
        if (empleadoIds.length === 0) return [];
        const { data, error } = await supabase
            .from('planilla_incapacidades')
            .select('*')
            .in('empleado_id', empleadoIds)
            .lte('fecha_inicio', fechaFin)
            .gte('fecha_fin', fechaInicio);
        if (error) throw error;
        return data || [];
    },

    async crear(payload: NuevaIncapacidad): Promise<Incapacidad> {
        const { data, error } = await supabase
            .from('planilla_incapacidades')
            .insert([payload])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    /**
     * `.maybeSingle()` en vez de `.single()` (revisión épica por épica, IMPL-45) — si el UPDATE
     * es bloqueado por RLS (quincena no `en_proceso`), PostgREST devuelve 0 filas sin error;
     * `.single()` lo convertiría en un error genérico PGRST116 en vez del mensaje de negocio
     * claro que sí dan `bonificacionesService`/`otrosIngresosService` para el mismo caso.
     */
    async actualizar(id: string, payload: UpdateIncapacidadDTO): Promise<Incapacidad> {
        const { data, error } = await supabase
            .from('planilla_incapacidades')
            .update(payload)
            .eq('id', id)
            .select()
            .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Esta quincena está cerrada y no permite modificaciones.');
        return data;
    },

    /** DELETE sin .select() no distingue "bloqueado por RLS" de "borrado con éxito" — ambos
     * devuelven 0 filas sin error (mismo gap ya resuelto en bonificacionesService/
     * otrosIngresosService, IMPL-104/CA1; corregido acá en la revisión épica por épica de
     * Incapacidades, IMPL-45). */
    async eliminar(id: string): Promise<void> {
        const { data, error } = await supabase
            .from('planilla_incapacidades')
            .delete()
            .eq('id', id)
            .select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('Esta quincena está cerrada y no permite modificaciones.');
    },
};
