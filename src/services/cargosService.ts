import { supabase } from '../config/supabaseClient';

export type EstadoCargo = 'activo' | 'inactivo';

export interface Cargo {
    id: string;
    tenant_id: string;
    nombre: string;
    estado: EstadoCargo;
    created_at: string;
    updated_at: string;
}

export const cargosService = {
    async getCargos(): Promise<Cargo[]> {
        const { data, error } = await supabase.from('planilla_cargos').select('*').order('nombre', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async createCargo(tenantId: string, nombre: string): Promise<Cargo> {
        const { data, error } = await supabase
            .from('planilla_cargos')
            .insert([{ tenant_id: tenantId, nombre }])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async updateCargo(id: string, updates: Partial<Pick<Cargo, 'nombre' | 'estado'>>): Promise<Cargo> {
        const { data, error } = await supabase
            .from('planilla_cargos')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },
};
