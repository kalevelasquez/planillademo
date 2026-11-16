import { supabase } from './authService';

export interface MetricasIaPlanilla {
    total_invocaciones: number;
    exitosas: number;
    fallidas: number;
    timeouts: number;
    tasa_exito: number | null;
    tasa_fallback: number | null;
    fallback_hoy_supera_umbral: boolean;
}

/**
 * Métricas de extracción por IA de Anticipos/Viáticos (US-OBS-03 / IMPL-107). Agrega
 * `planilla_ia_invocaciones` vía RPC — el umbral de alerta (30%) vive hardcodeado dentro de
 * `get_metricas_ia_planilla` (sin precedente en el proyecto de tabla de config editable por
 * admin para este tipo de umbral).
 */
export const iaMonitoringService = {
    async getMetricas(dias: number = 30): Promise<MetricasIaPlanilla> {
        const { data, error } = await supabase.rpc('get_metricas_ia_planilla', { p_dias: dias });
        if (error) throw error;
        return data?.[0] ?? {
            total_invocaciones: 0, exitosas: 0, fallidas: 0, timeouts: 0,
            tasa_exito: null, tasa_fallback: null, fallback_hoy_supera_umbral: false,
        };
    },
};
