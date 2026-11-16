import { supabase } from '../config/supabaseClient';

export interface ViaticoKilometraje {
    id: string;
    tenant_id: string;
    quincena_id: string;
    empleado_id: string;
    fecha: string;
    km_recorridos: number;
    tarifa_km: number;
    monto: number;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface NuevoViaticoKilometraje {
    tenant_id: string;
    quincena_id: string;
    empleado_id: string;
    fecha: string;
    km_recorridos: number;
    tarifa_km: number;
    monto: number;
    created_by: string;
}

export type UpdateViaticoKilometrajeDTO = Partial<Pick<NuevoViaticoKilometraje, 'empleado_id' | 'fecha' | 'km_recorridos' | 'tarifa_km' | 'monto'>>;

export const viaticosKilometrajeService = {
    async getPorQuincena(quincenaId: string): Promise<ViaticoKilometraje[]> {
        const { data, error } = await supabase
            .from('planilla_viaticos_kilometraje')
            .select('*')
            .eq('quincena_id', quincenaId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    async crear(payload: NuevoViaticoKilometraje): Promise<ViaticoKilometraje> {
        const { data, error } = await supabase
            .from('planilla_viaticos_kilometraje')
            .insert([payload])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async actualizar(id: string, payload: UpdateViaticoKilometrajeDTO): Promise<ViaticoKilometraje> {
        const { data, error } = await supabase
            .from('planilla_viaticos_kilometraje')
            .update(payload)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async eliminar(id: string): Promise<void> {
        const { error } = await supabase
            .from('planilla_viaticos_kilometraje')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },
};
