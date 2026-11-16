import { supabase } from '../config/supabaseClient';

export interface Notificacion {
    id: string;
    tenant_id: string;
    usuario_id: string;
    tipo: string;
    titulo: string;
    mensaje: string;
    referencia_id: string | null;
    leida: boolean;
    created_at: string;
}

/**
 * US-CIE-04 (IMPL-127) — persistencia de las notificaciones push in-app. Los inserts se hacen
 * siempre desde funciones SECURITY DEFINER en la base de datos (fn_crear_notificacion,
 * fn_notificar_aprobadores_planilla), nunca desde el cliente — este service es solo de lectura
 * y de marcar como leída.
 */
export const notificacionesService = {
    async getTodas(usuarioId: string): Promise<Notificacion[]> {
        const { data, error } = await supabase
            .from('notificaciones')
            .select('*')
            .eq('usuario_id', usuarioId)
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) throw error;
        return data || [];
    },

    async marcarLeida(id: string): Promise<void> {
        const { error } = await supabase
            .from('notificaciones')
            .update({ leida: true })
            .eq('id', id);
        if (error) throw error;
    },

    async marcarTodasLeidas(usuarioId: string): Promise<void> {
        const { error } = await supabase
            .from('notificaciones')
            .update({ leida: true })
            .eq('usuario_id', usuarioId)
            .eq('leida', false);
        if (error) throw error;
    },
};
