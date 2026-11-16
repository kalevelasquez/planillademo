/**
 * src/services/monitoringService.ts
 * ─────────────────────────────────────────────────────────────────
 * Consumo de métricas de administrador y salud del sistema (US-OBS-02).
 */

import { supabase } from './authService';

export interface AdminMetrics {
    tenant_id: string;
    orders_today: number;
    revenue_today: number;
    active_users_24h: number;
    errors_last_24h: number;
}

export interface HealthReport {
    status: string;
    version: string;
    timestamp: string;
    services: {
        database: {
            status: string;
            latency_ms?: number;
        };
        edge_runtime: string;
    };
}

export const monitoringService = {
    /**
     * Obtiene las métricas unificadas desde la vista de administración.
     * CA2, CA3: Consultables por el Admin.
     */
    async getSystemMetrics(tenantId: string): Promise<AdminMetrics | null> {
        const { data, error } = await supabase
            .from('view_admin_metrics')
            .select('*')
            .eq('tenant_id', tenantId)
            .maybeSingle();

        if (error) {
            import('../utils/logger').then(({ Logger }) => {
                Logger.error('Error al obtener métricas de monitoreo', { tenantId, action: 'getSystemMetrics' }, error);
            });
            throw error;
        }

        return data as AdminMetrics;
    },

    /**
     * Obtiene la tendencia de errores de las últimas 24 horas.
     */
    async getErrorTrends(tenantId: string) {
        const { data, error } = await supabase
            .from('error_stats')
            .select('hour_timestamp, error_count')
            .eq('tenant_id', tenantId)
            .gte('hour_timestamp', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .order('hour_timestamp', { ascending: true });

        if (error) {
            import('../utils/logger').then(({ Logger }) => {
                Logger.error('Error al obtener tendencia de errores', { tenantId, action: 'getErrorTrends' }, error);
            });
            throw error;
        }
        return data;
    },

    /**
     * Consulta el endpoint de salud del sistema.
     * CA1: Retorna estado, conectividad y versión.
     */
    async getSystemHealth(): Promise<HealthReport> {
        const { data, error } = await supabase.functions.invoke('system-health');
        if (error) {
            return {
                status: 'OFFLINE',
                version: 'unknown',
                timestamp: new Date().toISOString(),
                services: {
                    database: { status: 'offline' },
                    edge_runtime: 'offline'
                }
            };
        }
        return data as HealthReport;
    },

    /**
     * Incrementa el contador de errores mediante RPC.
     * Utilizado por el Logger frontend para registrar fallos sin acceso directo a tablas.
     */
    async incrementErrorMetric(tenantId: string): Promise<void> {
        const { error } = await supabase.rpc('increment_error_metrics', {
            p_tenant_id: tenantId
        });
        if (error) console.warn('[MonitoringService] No se pudo incrementar métrica de error:', error);
    },

    /**
     * US-OBS-03: Envía un log técnico detallado a la base de datos para depuración remota.
     */
    async logRemoteError(message: string, stack?: string, context?: any, tenantId?: string): Promise<void> {
        try {
            const { error } = await supabase.rpc('log_tech_error', {
                p_message: message,
                p_stack: stack || null,
                p_context: context || {},
                p_tenant_id: tenantId || null
            });
            if (error) throw error;
        } catch (err) {
            console.warn('[MonitoringService] Falló el envío de log remoto:', err);
        }
    },

    /**
     * US-OBS-03: Obtiene los errores técnicos más recientes.
     */
    async getRecentTechErrors(limit = 10) {
        const { data, error } = await supabase
            .from('tech_errors')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('Error fetching tech errors:', error);
            return [];
        }
        return data;
    }
};
