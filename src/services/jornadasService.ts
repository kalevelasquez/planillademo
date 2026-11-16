import { supabase } from '../config/supabaseClient';
import type { HorasPorDia } from '../utils/jornadaUtils';

export interface JornadaCargo {
    id: string;
    tenant_id: string;
    aplica_a: 'cargo' | 'departamento';
    valor: string;
    horas_por_dia: HorasPorDia;
    created_at: string;
    updated_at: string;
}

export const jornadasService = {
    async getJornadas(): Promise<JornadaCargo[]> {
        const { data, error } = await supabase.from('planilla_jornadas_cargo').select('*').order('valor', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async createJornada(
        tenantId: string,
        aplicaA: 'cargo' | 'departamento',
        valor: string,
        horasPorDia: HorasPorDia
    ): Promise<JornadaCargo> {
        const { data, error } = await supabase
            .from('planilla_jornadas_cargo')
            .insert([{ tenant_id: tenantId, aplica_a: aplicaA, valor, horas_por_dia: horasPorDia }])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async updateJornada(
        id: string,
        updates: Partial<Pick<JornadaCargo, 'aplica_a' | 'valor' | 'horas_por_dia'>>
    ): Promise<JornadaCargo> {
        const { data, error } = await supabase
            .from('planilla_jornadas_cargo')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async deleteJornada(id: string): Promise<void> {
        const { error } = await supabase.from('planilla_jornadas_cargo').delete().eq('id', id);
        if (error) throw error;
    },
};
