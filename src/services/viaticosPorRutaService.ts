import { supabase } from '../config/supabaseClient';

export type OrigenViaticoPorRuta = 'manual' | 'ia';

export interface ViaticoPorRuta {
    id: string;
    tenant_id: string;
    quincena_id: string;
    empleado_id: string;
    fecha: string;
    cargo_motivo: string;
    destino: string;
    monto: number;
    origen: OrigenViaticoPorRuta;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface NuevoViaticoPorRuta {
    tenant_id: string;
    quincena_id: string;
    empleado_id: string;
    fecha: string;
    cargo_motivo: string;
    destino: string;
    monto: number;
    origen: OrigenViaticoPorRuta;
    created_by: string;
}

export type UpdateViaticoPorRutaDTO = Partial<Pick<NuevoViaticoPorRuta, 'empleado_id' | 'fecha' | 'cargo_motivo' | 'destino' | 'monto'>>;

export const viaticosPorRutaService = {
    async getPorQuincena(quincenaId: string): Promise<ViaticoPorRuta[]> {
        const { data, error } = await supabase
            .from('planilla_viaticos_por_ruta')
            .select('*')
            .eq('quincena_id', quincenaId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    async crear(payload: NuevoViaticoPorRuta): Promise<ViaticoPorRuta> {
        const { data, error } = await supabase
            .from('planilla_viaticos_por_ruta')
            .insert([payload])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async actualizar(id: string, payload: UpdateViaticoPorRutaDTO): Promise<ViaticoPorRuta> {
        const { data, error } = await supabase
            .from('planilla_viaticos_por_ruta')
            .update(payload)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async eliminar(id: string): Promise<void> {
        const { error } = await supabase
            .from('planilla_viaticos_por_ruta')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },
};
