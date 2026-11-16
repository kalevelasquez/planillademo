import { supabase } from '../config/supabaseClient';

export type TipoViaticoFijoVariable = 'fijo' | 'variable';

export interface ViaticoFijoVariable {
    id: string;
    tenant_id: string;
    quincena_id: string;
    empleado_id: string;
    tipo: TipoViaticoFijoVariable;
    concepto: string;
    cantidad_lavados: number | null;
    monto: number;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface NuevoViaticoFijoVariable {
    tenant_id: string;
    quincena_id: string;
    empleado_id: string;
    tipo: TipoViaticoFijoVariable;
    concepto: string;
    cantidad_lavados: number | null;
    monto: number;
    created_by: string;
}

export type UpdateViaticoFijoVariableDTO = Partial<Omit<NuevoViaticoFijoVariable, 'tenant_id' | 'quincena_id' | 'created_by'>>;

export const viaticosFijosVariablesService = {
    async getPorQuincena(quincenaId: string): Promise<ViaticoFijoVariable[]> {
        const { data, error } = await supabase
            .from('planilla_viaticos_fijos_variables')
            .select('*')
            .eq('quincena_id', quincenaId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    async crear(payload: NuevoViaticoFijoVariable): Promise<ViaticoFijoVariable> {
        const { data, error } = await supabase
            .from('planilla_viaticos_fijos_variables')
            .insert([payload])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async actualizar(id: string, payload: UpdateViaticoFijoVariableDTO): Promise<ViaticoFijoVariable> {
        const { data, error } = await supabase
            .from('planilla_viaticos_fijos_variables')
            .update(payload)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async eliminar(id: string): Promise<void> {
        const { error } = await supabase
            .from('planilla_viaticos_fijos_variables')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },
};
