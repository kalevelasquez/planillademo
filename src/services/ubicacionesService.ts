import { supabase } from '../config/supabaseClient';

export type ModalidadCaptura = 'reloj_marcador' | 'manual';
export type EstadoUbicacion = 'activo' | 'inactivo';

export interface Ubicacion {
    id: string;
    tenant_id: string;
    nombre: string;
    modalidad_captura: ModalidadCaptura;
    estado: EstadoUbicacion;
    created_at: string;
    updated_at: string;
}

export const ubicacionesService = {
    async getUbicaciones(): Promise<Ubicacion[]> {
        const { data, error } = await supabase.from('planilla_ubicaciones').select('*').order('nombre', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async createUbicacion(tenantId: string, nombre: string, modalidadCaptura: ModalidadCaptura): Promise<Ubicacion> {
        const { data, error } = await supabase
            .from('planilla_ubicaciones')
            .insert([{ tenant_id: tenantId, nombre, modalidad_captura: modalidadCaptura }])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async updateUbicacion(
        id: string,
        updates: Partial<Pick<Ubicacion, 'nombre' | 'modalidad_captura' | 'estado'>>
    ): Promise<Ubicacion> {
        const { data, error } = await supabase
            .from('planilla_ubicaciones')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },
};
