import { supabase } from '../config/supabaseClient';

export type EstadoDestino = 'activo' | 'inactivo';

export interface Destino {
    id: string;
    tenant_id: string;
    nombre: string;
    monto: number;
    estado: EstadoDestino;
    created_at: string;
    updated_at: string;
}

export const destinosService = {
    async getDestinos(): Promise<Destino[]> {
        const { data, error } = await supabase.from('planilla_destinos').select('*').order('nombre', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async createDestino(tenantId: string, nombre: string, monto: number): Promise<Destino> {
        const { data, error } = await supabase
            .from('planilla_destinos')
            .insert([{ tenant_id: tenantId, nombre, monto }])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async updateDestino(id: string, updates: Partial<Pick<Destino, 'nombre' | 'monto' | 'estado'>>): Promise<Destino> {
        const { data, error } = await supabase
            .from('planilla_destinos')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },
};
