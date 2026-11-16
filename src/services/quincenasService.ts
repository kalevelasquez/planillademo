import { supabase } from '../config/supabaseClient';
import type { TipoQuincena } from '../utils/quincenaUtils';
import { Logger } from '../utils/logger';

export type EstadoQuincena = 'en_proceso' | 'enviada_aprobacion' | 'aprobada_cerrada' | 'reabierta';

/** Estado "visual" derivado (IMPL-102), agrega 'rechazada' — ver getEstadoVisual. La
 * columna real `estado` de la BD nunca toma este 5to valor (ver nota de diseño en
 * 20260823090000_add_quincenas_columnas_auditoria_transicion.sql). */
export type EstadoQuincenaVisual = EstadoQuincena | 'rechazada';

export interface Quincena {
    id: string;
    tenant_id: string;
    tipo: TipoQuincena;
    nombre: string;
    etiqueta_estandar: string;
    fecha_inicio: string;
    fecha_fin: string;
    dias_habiles: number;
    estado: EstadoQuincena;
    created_by: string | null;
    created_at: string;
    deleted_at: string | null;
    enviada_por: string | null;
    enviada_at: string | null;
    aprobada_por: string | null;
    aprobada_at: string | null;
    aprobada_comentario: string | null;
    rechazada_por: string | null;
    rechazada_at: string | null;
    rechazo_motivo: string | null;
    reabierta_por: string | null;
    reabierta_at: string | null;
    reapertura_motivo: string | null;
    /** IMPL-187 — quincenas clon de un año anterior creadas para pruebas de UAT (ej. IMPL-169)
     * quedan marcadas acá para que los reportes las excluyan explícitamente, en vez de depender
     * de heurísticas de fecha que solo funcionan para algunos empleados. */
    es_prueba: boolean;
}

export interface CreateQuincenaInput {
    tipo: TipoQuincena;
    nombre: string;
    etiquetaEstandar: string;
    fechaInicio: string;
    fechaFin: string;
    diasHabiles: number;
}

/** Canal de email de las notificaciones de quincena (IMPL-127 CA1/CA3) — complementa al push
 * ya existente. Fire-and-forget A PROPÓSITO: la transición de la quincena ya tuvo éxito antes
 * de llegar acá (se llama después de cada RPC), así que un email que falla o tarda nunca debe
 * demorar ni revertir la UI — solo se loggea. La Edge Function responde `no_configurado: true`
 * mientras no exista el secret RESEND_API_KEY, sin que eso cuente como error. */
function notificarEmailQuincena(tipo: 'enviada_aprobacion' | 'aprobada_cerrada' | 'rechazada', quincenaId: string, motivo?: string): void {
    try {
        supabase.functions.invoke('notificar-email-quincena', { body: { tipo, quincenaId, motivo } })
            .then(({ error }) => {
                if (error) Logger.error('Error al invocar notificar-email-quincena', { quincenaId, tipo }, error);
            })
            .catch((err: unknown) => Logger.error('Error al invocar notificar-email-quincena', { quincenaId, tipo }, err));
    } catch (err: unknown) {
        // Defensa adicional: un throw SÍNCRONO acá (ej. cliente mal inicializado) no debe
        // escapar y tumbar la transición de la quincena que ya tuvo éxito.
        Logger.error('Error al invocar notificar-email-quincena', { quincenaId, tipo }, err);
    }
}

export const quincenasService = {
    /**
     * Lista de quincenas del tenant, más reciente primero.
     */
    async getQuincenas(): Promise<Quincena[]> {
        const { data, error } = await supabase
            .from('quincenas')
            .select('*')
            .is('deleted_at', null)
            .order('fecha_inicio', { ascending: false });

        if (error) throw error;
        return data || [];
    },

    async getQuincenaById(id: string): Promise<Quincena> {
        const { data, error } = await supabase.from('quincenas').select('*').eq('id', id).single();
        if (error) throw error;
        return data;
    },

    /**
     * Crea una quincena vía RPC transaccional (valida solapamiento — CA6 de US-QNA-01).
     */
    async createQuincena(input: CreateQuincenaInput): Promise<Quincena> {
        const { data, error } = await supabase.rpc('create_quincena', {
            p_tipo: input.tipo,
            p_nombre: input.nombre,
            p_etiqueta_estandar: input.etiquetaEstandar,
            p_fecha_inicio: input.fechaInicio,
            p_fecha_fin: input.fechaFin,
            p_dias_habiles: input.diasHabiles,
        });

        if (error) throw error;
        return data;
    },

    /**
     * Envía la quincena a aprobación (US-CIE-00 CA1). El RPC valida checklist de módulos +
     * cálculo de planilla completo server-side — no se duplica esa validación en el cliente.
     */
    async enviarAAprobacion(quincenaId: string): Promise<Quincena> {
        const { data, error } = await supabase.rpc('enviar_a_aprobacion', { p_quincena_id: quincenaId });
        if (error) throw error;
        notificarEmailQuincena('enviada_aprobacion', quincenaId);
        return data;
    },

    /**
     * Aprueba y cierra la quincena (CA2). El RPC valida CA5 (segregación Preparador≠Aprobador).
     */
    async aprobarYCerrar(quincenaId: string, comentario?: string): Promise<Quincena> {
        const { data, error } = await supabase.rpc('aprobar_y_cerrar_quincena', {
            p_quincena_id: quincenaId,
            p_comentario: comentario || null,
        });
        if (error) throw error;
        notificarEmailQuincena('aprobada_cerrada', quincenaId);
        return data;
    },

    /**
     * Rechaza la quincena enviada a aprobación (CA3, motivo obligatorio).
     */
    async rechazar(quincenaId: string, motivo: string): Promise<Quincena> {
        const { data, error } = await supabase.rpc('rechazar_quincena', { p_quincena_id: quincenaId, p_motivo: motivo });
        if (error) throw error;
        notificarEmailQuincena('rechazada', quincenaId, motivo);
        return data;
    },

    /**
     * Re-abre una quincena Aprobada y Cerrada (CA4, motivo obligatorio).
     */
    async reabrir(quincenaId: string, motivo: string): Promise<Quincena> {
        const { data, error } = await supabase.rpc('reabrir_quincena', { p_quincena_id: quincenaId, p_motivo: motivo });
        if (error) throw error;
        return data;
    },
};

/**
 * Deriva el "estado visual" de una quincena para mostrar en EstadoQuincenaBadge (IMPL-102).
 * La columna `estado` de la BD nunca es literalmente 'reabierta' ni 'rechazada' — ambas
 * transiciones escriben 'en_proceso' (ver nota de diseño en la migración de columnas de
 * auditoría). Se distingue comparando cuál de las dos marcas de tiempo es más reciente.
 */
export function getEstadoVisual(quincena: Quincena): EstadoQuincenaVisual {
    if (quincena.estado !== 'en_proceso') return quincena.estado;

    const reabiertaAt = quincena.reabierta_at ? new Date(quincena.reabierta_at).getTime() : null;
    const rechazadaAt = quincena.rechazada_at ? new Date(quincena.rechazada_at).getTime() : null;

    if (reabiertaAt === null && rechazadaAt === null) return 'en_proceso';
    if (reabiertaAt !== null && (rechazadaAt === null || reabiertaAt >= rechazadaAt)) return 'reabierta';
    return 'rechazada';
}
