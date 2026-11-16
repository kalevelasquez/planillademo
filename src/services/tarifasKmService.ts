import { supabase } from '../config/supabaseClient';

export interface TarifaKmCargo {
    id: string;
    tenant_id: string;
    cargo: string;
    tarifa_km: number;
    created_at: string;
    updated_at: string;
}

export const tarifasKmService = {
    async getTarifas(): Promise<TarifaKmCargo[]> {
        const { data, error } = await supabase
            .from('planilla_tarifas_km_cargo')
            .select('*')
            .order('cargo', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async crearTarifa(tenantId: string, cargo: string, tarifaKm: number): Promise<TarifaKmCargo> {
        const { data, error } = await supabase
            .from('planilla_tarifas_km_cargo')
            .insert([{ tenant_id: tenantId, cargo, tarifa_km: tarifaKm }])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async actualizarTarifa(id: string, updates: Partial<Pick<TarifaKmCargo, 'cargo' | 'tarifa_km'>>): Promise<TarifaKmCargo> {
        const { data, error } = await supabase
            .from('planilla_tarifas_km_cargo')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async eliminarTarifa(id: string): Promise<void> {
        const { error } = await supabase
            .from('planilla_tarifas_km_cargo')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },
};
