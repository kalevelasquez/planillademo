import { supabase } from '../config/supabaseClient';

export type Gravabilidad = 'gravable' | 'no_gravable' | 'bono_10';

export interface OtroIngresoConcepto {
    id: string;
    tenant_id: string;
    nombre: string;
    gravabilidad_default: Gravabilidad;
    activo: boolean;
    created_at: string;
    updated_at: string;
}

export const otrosIngresosConceptosService = {
    async getTodos(): Promise<OtroIngresoConcepto[]> {
        const { data, error } = await supabase
            .from('planilla_otros_ingresos_conceptos')
            .select('*')
            .order('nombre', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async getActivos(): Promise<OtroIngresoConcepto[]> {
        const { data, error } = await supabase
            .from('planilla_otros_ingresos_conceptos')
            .select('*')
            .eq('activo', true)
            .order('nombre', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async crear(tenantId: string, nombre: string, gravabilidadDefault: Gravabilidad): Promise<OtroIngresoConcepto> {
        const { data, error } = await supabase
            .from('planilla_otros_ingresos_conceptos')
            .insert([{ tenant_id: tenantId, nombre, gravabilidad_default: gravabilidadDefault }])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    /** US-OTR-00 CA1 (defecto UAT) — edición de nombre y gravabilidad por defecto. Renombrar es
     * seguro: otros_ingresos referencian concepto_id, no el nombre; la gravabilidad_default solo
     * afecta la precarga de registros nuevos, los ya guardados conservan su valor. */
    async actualizar(id: string, nombre: string, gravabilidadDefault: Gravabilidad): Promise<OtroIngresoConcepto> {
        const { data, error } = await supabase
            .from('planilla_otros_ingresos_conceptos')
            .update({ nombre, gravabilidad_default: gravabilidadDefault })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    /** Sin DELETE físico expuesto — un concepto puede estar referenciado por otros_ingresos ya
     * registrados; se desactiva en vez de borrarse (mismo criterio que descuento_categorias).
     * El UPDATE queda auditado por tr_audit_planilla_otros_ingresos_conceptos. */
    async cambiarActivo(id: string, activo: boolean): Promise<OtroIngresoConcepto> {
        const { data, error } = await supabase
            .from('planilla_otros_ingresos_conceptos')
            .update({ activo })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },
};
