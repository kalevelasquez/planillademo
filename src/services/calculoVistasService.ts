import { supabase } from '../config/supabaseClient';
import type { ColumnaKey } from '../utils/calculoPlanillaColumnas';

export interface VistaGuardada {
    id: string;
    tenant_id: string;
    nombre: string;
    columnas: ColumnaKey[];
    created_by: string | null;
    created_at: string;
}

export const calculoVistasService = {
    async getTodas(): Promise<VistaGuardada[]> {
        const { data, error } = await supabase
            .from('planilla_calculo_vistas_guardadas')
            .select('*')
            .order('nombre', { ascending: true });
        if (error) throw error;
        return (data || []) as VistaGuardada[];
    },

    async guardar(tenantId: string, nombre: string, columnas: ColumnaKey[], userId: string): Promise<VistaGuardada> {
        const { data, error } = await supabase
            .from('planilla_calculo_vistas_guardadas')
            .insert([{ tenant_id: tenantId, nombre, columnas, created_by: userId }])
            .select()
            .single();
        if (error) throw error;
        return data as VistaGuardada;
    },

    async eliminar(id: string): Promise<void> {
        const { error } = await supabase.from('planilla_calculo_vistas_guardadas').delete().eq('id', id);
        if (error) throw error;
    },
};
