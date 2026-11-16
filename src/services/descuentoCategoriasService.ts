import { supabase } from '../config/supabaseClient';
import type { TipoDescuento } from '../utils/descuentosUtils';

export interface DescuentoCategoria {
    id: string;
    tenant_id: string;
    nombre: string;
    tipo: TipoDescuento;
    activo: boolean;
    created_at: string;
    updated_at: string;
}

export const descuentoCategoriasService = {
    /** US-DESC-01 CA3 (defecto UAT) — el catálogo ahora tiene pantalla de administración propia
     * (`DescuentoCategoriasConfigView.tsx`, solo admin). Lista completa (activas e inactivas)
     * para la pantalla de configuración y para resolver el nombre/tipo de descuentos existentes
     * cuyas categorías ya no están activas. */
    async getTodos(): Promise<DescuentoCategoria[]> {
        const { data, error } = await supabase
            .from('planilla_descuento_categorias')
            .select('*')
            .order('nombre', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async getActivas(): Promise<DescuentoCategoria[]> {
        const { data, error } = await supabase
            .from('planilla_descuento_categorias')
            .select('*')
            .eq('activo', true)
            .order('nombre', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async crear(tenantId: string, nombre: string, tipo: TipoDescuento): Promise<DescuentoCategoria> {
        const { data, error } = await supabase
            .from('planilla_descuento_categorias')
            .insert([{ tenant_id: tenantId, nombre, tipo }])
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    /** Edición de nombre y tipo. Renombrar es seguro: planilla_descuentos referencian
     * categoria_id, no el nombre; el `tipo` solo clasifica (Fijo/Variable) en las vistas — los
     * descuentos ya guardados conservan su categoría. El UPDATE queda auditado por
     * tr_audit_planilla_descuento_categorias. */
    async actualizar(id: string, nombre: string, tipo: TipoDescuento): Promise<DescuentoCategoria> {
        const { data, error } = await supabase
            .from('planilla_descuento_categorias')
            .update({ nombre, tipo })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    /** Sin DELETE físico expuesto — una categoría puede estar referenciada por planilla_descuentos
     * ya registrados; se desactiva en vez de borrarse. El UPDATE queda auditado por el trigger de
     * la tabla. Las vistas (perfil, panel consolidado) siguen resolviendo el nombre/tipo de los
     * descuentos existentes vía getTodos(); solo los formularios de alta nueva filtran activas. */
    async cambiarActivo(id: string, activo: boolean): Promise<DescuentoCategoria> {
        const { data, error } = await supabase
            .from('planilla_descuento_categorias')
            .update({ activo })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },
};
