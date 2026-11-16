/**
 * supabase/functions/_shared/logger.ts
 * ─────────────────────────────────────────────────────────────────
 * Logger estructurado para Edge Functions (Deno).
 * Imprime logs en formato JSON para que Supabase los indexe correctamente.
 */

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

interface LogContext {
    action: string;
    userId?: string;
    tenantId?: string;
    [key: string]: any;
}

export class Logger {
    private static APP_VERSION = '1.0.0-PROD';

    private static format(level: LogLevel, message: string, context: LogContext, error?: any) {
        const logObject = {
            timestamp: new Date().toISOString(),
            level,
            source: 'edge-function',
            message,
            context: {
                ...context,
                version: this.APP_VERSION,
            },
            error: error ? {
                message: error.message,
                code: error.code || error.status,
                stack: error.stack,
                details: error.details || undefined,
            } : undefined,
        };

        // Imprimir como string JSON para que el Log Viewer lo reconozca como objeto
        console.log(JSON.stringify(logObject));
    }

    static info(message: string, context: LogContext) {
        if (Deno.env.get('ENVIRONMENT') === 'production' && !['ERROR', 'WARN', 'INFO'].includes('INFO')) return;
        this.format('INFO', message, context);
    }

    static warn(message: string, context: LogContext, error?: any) {
        this.format('WARN', message, context, error);
    }

    static error(message: string, context: LogContext, error: any) {
        this.format('ERROR', message, context, error);
    }

    static debug(message: string, context: LogContext) {
        if (Deno.env.get('ENVIRONMENT') !== 'production') {
            this.format('DEBUG', message, context);
        }
    }
}
