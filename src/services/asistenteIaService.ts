import { supabase } from '../config/supabaseClient';

export interface MensajeChat {
    role: 'user' | 'assistant';
    content: string;
}

export interface RespuestaAsistente {
    respuesta: string;
    herramientas_usadas?: { nombre: string; input: unknown }[];
    no_configurado?: boolean;
    error?: string;
}

const TIMEOUT_MS = 30000; // mismo criterio que anticipoIaService/viaticoIaService

/**
 * Asistente de IA de Planilla (US-IA-02/IMPL-117). El Edge Function devuelve HTTP 200 con
 * `no_configurado: true` mientras no estén configuradas OPENAI_API_KEY y
 * ASISTENTE_IA_HABILITADO en Supabase — ver Edge Function `asistente-ia` para el detalle de
 * por qué ese caso específico no usa un código de error HTTP.
 */
export const asistenteIaService = {
    async enviarMensaje(mensaje: string): Promise<RespuestaAsistente> {
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
        });

        const invokePromise = supabase.functions.invoke('asistente-ia', {
            body: { mensaje },
        });

        const { data, error } = await Promise.race([invokePromise, timeoutPromise]);

        if (error) throw error;
        if (data?.error && !data?.no_configurado) throw new Error(data.error);
        return data as RespuestaAsistente;
    },

    /**
     * Historial de la sesión continua del usuario (persistencia — antes solo vivía en el
     * estado de React y se perdía al recargar). Lectura directa vía RLS, sin pasar por el
     * Edge Function: es un SELECT simple que la policy "solo mis propios mensajes" ya cubre.
     */
    async obtenerHistorial(): Promise<MensajeChat[]> {
        const { data: sesion, error: sesionError } = await supabase
            .from('asistente_ia_sesiones')
            .select('id')
            .maybeSingle();
        if (sesionError) throw sesionError;
        if (!sesion) return [];

        const { data: mensajes, error: mensajesError } = await supabase
            .from('asistente_ia_mensajes')
            .select('role, content')
            .eq('sesion_id', sesion.id)
            .order('created_at', { ascending: true });
        if (mensajesError) throw mensajesError;
        return (mensajes ?? []) as MensajeChat[];
    },
};
