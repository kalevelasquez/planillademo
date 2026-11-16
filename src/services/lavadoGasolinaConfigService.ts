import { supabase } from '../config/supabaseClient';

export interface ConfigLavadoGasolina {
    id: string;
    tenant_id: string;
    monto: number;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
}

export const lavadoGasolinaConfigService = {
    /** Una fila por tenant como mucho — null si el admin todavía no configuró ningún monto. */
    async getConfig(): Promise<ConfigLavadoGasolina | null> {
        const { data, error } = await supabase
            .from('planilla_config_lavado_gasolina')
            .select('*')
            .maybeSingle();
        if (error) throw error;
        return data;
    },

    async guardarMonto(tenantId: string, monto: number, updatedBy: string): Promise<ConfigLavadoGasolina> {
        const { data, error } = await supabase
            .from('planilla_config_lavado_gasolina')
            .upsert([{ tenant_id: tenantId, monto, updated_by: updatedBy }], { onConflict: 'tenant_id' })
            .select()
            .single();
        if (error) throw error;
        return data;
    },
};
