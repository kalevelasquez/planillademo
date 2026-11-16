import { supabase } from '../config/supabaseClient';

export interface Feriado {
    id: string;
    tenant_id: string;
    fecha: string;
    nombre: string | null;
    created_at: string;
}

export interface DiaExentoPenalizacion {
    id: string;
    tenant_id: string;
    fecha: string;
    nota: string | null;
    created_at: string;
}

function sumarUnAnio(fechaIso: string): string {
    const [anio, mes, dia] = fechaIso.split('-').map(Number);
    return `${anio + 1}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export const feriadosService = {
    async getFeriados(): Promise<Feriado[]> {
        const { data, error } = await supabase.from('planilla_feriados').select('*').order('fecha', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async createFeriado(tenantId: string, fecha: string, nombre: string | null): Promise<Feriado> {
        const { data, error } = await supabase
            .from('planilla_feriados')
            .insert([{ tenant_id: tenantId, fecha, nombre }])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async updateFeriado(id: string, fecha: string, nombre: string | null): Promise<Feriado> {
        const { data, error } = await supabase
            .from('planilla_feriados')
            .update({ fecha, nombre })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async deleteFeriado(id: string): Promise<void> {
        const { error } = await supabase.from('planilla_feriados').delete().eq('id', id);
        if (error) throw error;
    },

    /**
     * Copia los feriados de un año al siguiente como base editable (CA1). No sincroniza
     * automáticamente — es una copia puntual que el admin puede ajustar después.
     */
    async copiarFeriadosDelAnioAnterior(tenantId: string, anioOrigen: number): Promise<Feriado[]> {
        const { data: origen, error: fetchError } = await supabase
            .from('planilla_feriados')
            .select('*')
            .gte('fecha', `${anioOrigen}-01-01`)
            .lte('fecha', `${anioOrigen}-12-31`);
        if (fetchError) throw fetchError;
        if (!origen || origen.length === 0) return [];

        const copias = origen.map((f) => ({ tenant_id: tenantId, fecha: sumarUnAnio(f.fecha), nombre: f.nombre }));
        const { data, error } = await supabase
            .from('planilla_feriados')
            .upsert(copias, { onConflict: 'tenant_id,fecha', ignoreDuplicates: true })
            .select();
        if (error) throw error;
        return data || [];
    },

    async getDiasExentos(): Promise<DiaExentoPenalizacion[]> {
        const { data, error } = await supabase.from('planilla_dias_exentos_penalizacion').select('*').order('fecha', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async createDiaExento(tenantId: string, fecha: string, nota: string | null): Promise<DiaExentoPenalizacion> {
        const { data, error } = await supabase
            .from('planilla_dias_exentos_penalizacion')
            .insert([{ tenant_id: tenantId, fecha, nota }])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async updateDiaExento(id: string, fecha: string, nota: string | null): Promise<DiaExentoPenalizacion> {
        const { data, error } = await supabase
            .from('planilla_dias_exentos_penalizacion')
            .update({ fecha, nota })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async deleteDiaExento(id: string): Promise<void> {
        const { error } = await supabase.from('planilla_dias_exentos_penalizacion').delete().eq('id', id);
        if (error) throw error;
    },
};
