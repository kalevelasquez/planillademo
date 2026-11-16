import { supabase } from '../config/supabaseClient';

export type EstadoBanco = 'activo' | 'inactivo';

export interface Banco {
    id: string;
    tenant_id: string;
    nombre: string;
    estado: EstadoBanco;
    created_at: string;
    updated_at: string;
}

export const bancosService = {
    async getBancos(): Promise<Banco[]> {
        const { data, error } = await supabase.from('planilla_bancos').select('*').order('nombre', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async createBanco(tenantId: string, nombre: string): Promise<Banco> {
        const { data, error } = await supabase
            .from('planilla_bancos')
            .insert([{ tenant_id: tenantId, nombre }])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async updateBanco(id: string, updates: Partial<Pick<Banco, 'nombre' | 'estado'>>): Promise<Banco> {
        const { data, error } = await supabase
            .from('planilla_bancos')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },
};
