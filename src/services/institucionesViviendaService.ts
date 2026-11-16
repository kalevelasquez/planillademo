import { supabase } from '../config/supabaseClient';

export type EstadoInstitucionVivienda = 'activo' | 'inactivo';

export interface InstitucionVivienda {
    id: string;
    tenant_id: string;
    nombre: string;
    estado: EstadoInstitucionVivienda;
    created_at: string;
    updated_at: string;
}

export const institucionesViviendaService = {
    async getInstituciones(): Promise<InstitucionVivienda[]> {
        const { data, error } = await supabase
            .from('planilla_instituciones_vivienda')
            .select('*')
            .order('nombre', { ascending: true });
        if (error) throw error;
        return data || [];
    },
};
