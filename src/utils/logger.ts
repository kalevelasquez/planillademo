/**
 * src/utils/logger.ts
 * ─────────────────────────────────────────────────────────────────
 * Logger estructurado para el Frontend (US-OBS-01).
 * Recopila metadatos del usuario y del sistema para facilitar el diagnóstico.
 */

import { useAuthStore } from '../store/authStore';
import { monitoringService } from '../services/monitoringService';

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0-PROD';

export class Logger {
    private static lastMetricSentAt = 0;
    private static METRIC_THROTTLE_MS = 10000; // 10 segundos entre reportes de red


    private static format(level: LogLevel, message: string, context?: any, error?: any) {
        const { profile } = useAuthStore.getState();

        const logObject = {
            timestamp: new Date().toISOString(),
            level,
            source: 'frontend',
            message,
            context: {
                ...context,
                path: window.location.pathname,
                version: APP_VERSION,
            },
            error: error ? {
                message: error.message,
                code: error.code || error.status,
                stack: error.stack,
                details: error.details,
            } : undefined,
            user: profile ? {
                id: profile.id,
                tenant_id: profile.tenant_id,
                role: profile.role,
            } : undefined,
        };

        // En producción, podrías enviar este JSON a un endpoint de monitoreo
        // Por ahora, usamos console con formato estructurado
        const output = JSON.stringify(logObject);

        switch (level) {
            case 'ERROR':
                console.error(`[SYSTEM_ERROR] ${output}`);

                // US-OBS-03: Telemetría remota detallada para depuración en producción/móvil
                monitoringService.logRemoteError(
                    message,
                    (error?.stack || '') + (context?.componentStack ? `\n\n[Component Stack]:\n${context.componentStack}` : ''),
                    { ...context, path: window.location.pathname },
                    profile?.tenant_id
                );

                // US-OBS-02: Throttling de telemetría para evitar saturación de red (Performance-Ajuste)
                const now = Date.now();
                if (profile?.tenant_id && (now - this.lastMetricSentAt > this.METRIC_THROTTLE_MS)) {
                    this.lastMetricSentAt = now;
                    monitoringService.incrementErrorMetric(profile.tenant_id);
                }
                break;
            case 'WARN':
                console.warn(`[SYSTEM_WARN] ${output}`);
                break;
            case 'INFO':
                console.info(`[SYSTEM_INFO] ${output}`);
                break;
            case 'DEBUG':
                if (import.meta.env.DEV) {
                    console.debug(`[SYSTEM_DEBUG] ${output}`);
                }
                break;
        }

        return logObject;
    }

    static info(message: string, context?: any) {
        this.format('INFO', message, context);
    }

    static warn(message: string, context?: any, error?: any) {
        this.format('WARN', message, context, error);
    }

    static error(message: string, context?: any, error?: any) {
        this.format('ERROR', message, context, error);
    }

    static debug(message: string, context?: any) {
        this.format('DEBUG', message, context);
    }
}
