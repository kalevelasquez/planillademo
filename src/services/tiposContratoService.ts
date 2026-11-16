import { supabase } from '../config/supabaseClient';

export type EstadoTipoContrato = 'activo' | 'inactivo';

export interface TipoContrato {
    id: string;
    tenant_id: string;
    nombre: string;
    estado: EstadoTipoContrato;
    created_at: string;
    updated_at: string;
}

export const tiposContratoService = {
    async getTiposContrato(): Promise<TipoContrato[]> {
        const { data, error } = await supabase.from('planilla_tipos_contrato').select('*').order('nombre', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async createTipoContrato(tenantId: string, nombre: string): Promise<TipoContrato> {
        const { data, error } = await supabase
            .from('planilla_tipos_contrato')
            .insert([{ tenant_id: tenantId, nombre }])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async updateTipoContrato(id: string, updates: Partial<Pick<TipoContrato, 'nombre' | 'estado'>>): Promise<TipoContrato> {
        const { data, error } = await supabase
            .from('planilla_tipos_contrato')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },
};
