import { supabase } from '../config/supabaseClient';

export type ColorKey = 'blue' | 'amber' | 'primary' | 'purple' | 'pink' | 'secondary' | 'teal';
export type EstadoDepartamento = 'activo' | 'inactivo';

export interface Departamento {
    id: string;
    tenant_id: string;
    nombre: string;
    color_key: ColorKey;
    estado: EstadoDepartamento;
    /** Nivel 1 de la jerarquía "Grupo de Costos > Departamento" (IMPL-167 CA3) — usado por el
     * reporte de Descuentos para agrupar como en la planilla real de Imporfrut. Nullable: los
     * departamentos backfillados antes de esa migración quedan sin clasificar hasta que un
     * admin lo complete acá. */
    grupo_costos: string | null;
    created_at: string;
    updated_at: string;
}

export const departamentosService = {
    async getDepartamentos(): Promise<Departamento[]> {
        const { data, error } = await supabase.from('planilla_departamentos').select('*').order('nombre', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async createDepartamento(tenantId: string, nombre: string, colorKey: ColorKey): Promise<Departamento> {
        const { data, error } = await supabase
            .from('planilla_departamentos')
            .insert([{ tenant_id: tenantId, nombre, color_key: colorKey }])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async updateDepartamento(
        id: string,
        updates: Partial<Pick<Departamento, 'nombre' | 'color_key' | 'estado' | 'grupo_costos'>>
    ): Promise<Departamento> {
        const { data, error } = await supabase
            .from('planilla_departamentos')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },
};
