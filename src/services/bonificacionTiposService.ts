import { supabase } from '../config/supabaseClient';

export interface BonificacionTipo {
    id: string;
    tenant_id: string;
    nombre: string;
    activo: boolean;
    created_at: string;
    updated_at: string;
}

export const bonificacionTiposService = {
    /** Sin pantalla de administración propia (ninguna historia de esta épica la pide) — sembrado
     * vía migración, mismo criterio que descuentoCategoriasService. */
    async getActivos(): Promise<BonificacionTipo[]> {
        const { data, error } = await supabase
            .from('planilla_bonificacion_tipos')
            .select('*')
            .eq('activo', true)
            .order('nombre', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    /** IMPL-136 (Observación General UAT) — incluye inactivos para poder resolver `tipo_id` a
     * un nombre legible en el detalle de auditoría aunque el tipo ya no esté activo. */
    async getTodos(): Promise<BonificacionTipo[]> {
        const { data, error } = await supabase
            .from('planilla_bonificacion_tipos')
            .select('*')
            .order('nombre', { ascending: true });
        if (error) throw error;
        return data || [];
    },
};
