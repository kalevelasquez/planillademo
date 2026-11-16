import { supabase } from './authService';
import { Logger } from '../utils/logger';

export type AuditAction =
    | 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGIN_FAILED' | 'LOGOUT' | 'PASSWORD_CHANGE' | 'MFA_CHANGE' | 'EXPORT' | 'UPLOAD' | 'SHARE' | 'REVEAL'
    // IMPL-107/US-AUD-06 — acciones críticas de Planilla (20260827090000_add_planilla_audit_actions.sql)
    | 'CIERRE' | 'RE_APERTURA' | 'APROBACION' | 'RECHAZO' | 'SUSPENSION_DESCUENTO' | 'EDICION_SUELDO' | 'CONFIRMACION_MODULO'
    // IMPL-115/US-IA-03 — asistente de IA (20260831090000_asistente_ia_auditoria_y_limites.sql)
    | 'CONSULTA_IA'
    // IMPL-124 — reabrir un módulo/ubicación en_proceso (20260907180000_create_reabrir_modulo_ubicacion.sql)
    | 'REAPERTURA_MODULO';

export interface AuditEntry {
    id: string;
    tenant_id: string;
    user_id: string | null;
    user_email: string | null;
    action: AuditAction;
    resource_type: string;
    resource_id: string | null;
    old_values: any | null;
    new_values: any | null;
    ip_address: string | null;
    user_agent: string | null;
    created_at: string;
}

export interface AuditFilters {
    userId?: string;
    action?: AuditAction;
    resourceType?: string;
    resourceId?: string;
    dateFrom?: string;
    dateTo?: string;
}

export const auditService = {
    /**
     * Registra una acción personalizada en el log de auditoría.
     */
    async logAction(
        action: AuditAction,
        resourceType: string,
        resourceId?: string,
        details?: any
    ): Promise<void> {
        try {
            const { error } = await supabase.rpc('log_custom_audit', {
                p_action: action,
                p_resource_type: resourceType,
                p_resource_id: resourceId ?? null,
                p_details: details ?? null
            });

            if (error) {
                Logger.error(`Error al registrar auditoría: ${action}`, { action, resourceType, resourceId }, error);
            }
        } catch (err: unknown) {
            Logger.error('Error inesperado en servicio de auditoría', { action, resourceType }, err);
        }
    },

    /**
     * Registra un evento de autenticación (Login, Fallo, Logout, etc).
     */
    async logAuthEvent(
        action: AuditAction,
        email: string,
        userId?: string,
        details?: any
    ): Promise<void> {
        try {
            // Usamos la RPC estándar para eventos de auth (US-AUD-03)
            // Esta función es SECURITY DEFINER y maneja contextos anon/auth.
            const { error } = await supabase.rpc('log_auth_audit', {
                p_action: action,
                p_email: email,
                p_user_id: userId ?? null,
                p_details: details ?? null
            });
            if (error) throw error;
        } catch (err: unknown) {
            Logger.error(`Error al registrar evento de auth ${action}`, { action, email, userId }, err);
        }
    },

    /**
     * Consulta el log de auditoría con filtros y paginación (US-AUD-02).
     * Soporta un límite extendido para exportaciones (US-AUD-05).
     */
    async getAuditLogs(
        tenantId: string,
        page: number = 1,
        limit: number = 20,
        filters?: AuditFilters
    ): Promise<{ data: AuditEntry[], count: number }> {
        // Cap de seguridad para exportaciones masivas
        const safeLimit = Math.min(limit, 5000);
        const from = (page - 1) * safeLimit;
        const to = from + safeLimit - 1;

        let query = supabase
            .from('audit_log')
            .select('*', { count: 'exact' })
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false });

        if (filters?.userId) {
            query = query.eq('user_id', filters.userId);
        }
        if (filters?.action) {
            query = query.eq('action', filters.action);
        }
        if (filters?.resourceType) {
            query = query.eq('resource_type', filters.resourceType);
        }
        if (filters?.resourceId) {
            query = query.eq('resource_id', filters.resourceId);
        }
        if (filters?.dateFrom) {
            query = query.gte('created_at', `${filters.dateFrom}T00:00:00`);
        }
        if (filters?.dateTo) {
            query = query.lte('created_at', `${filters.dateTo}T23:59:59`);
        }

        const { data, error, count } = await query.range(from, to);

        if (error) {
            Logger.error('Error al consultar logs de auditoría', { tenantId, filters, page }, error);
            throw error;
        }

        return {
            data: (data || []) as AuditEntry[],
            count: count || 0
        };
    },

    /**
     * Obtiene el historial de cambios de un recurso específico (US-INV-04 CA4).
     */
    async getResourceHistory(
        tenantId: string,
        resourceType: string,
        resourceId: string
    ): Promise<AuditEntry[]> {
        const { data, error } = await supabase
            .from('audit_log')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('resource_type', resourceType)
            .eq('resource_id', resourceId)
            .order('created_at', { ascending: false });

        if (error) {
            Logger.error(`Error al consultar historial de ${resourceType}`, { tenantId, resourceId }, error);
            throw error;
        }

        return (data || []) as AuditEntry[];
    },

    /**
     * IMPL-125 (US-EMP-06/IMPL-8 CA3 + US-EMP-04/IMPL-6 CA4) — la eliminación de un documento
     * adjunto se audita en `planilla_empleado_documentos` (resource_type propio, resource_id =
     * el id del documento, no el del empleado), así que `getResourceHistory` nunca la trae.
     * Se filtra por `old_values->>empleado_id` porque ahí es donde fn_capture_audit deja el
     * dato del empleado dueño de la fila borrada.
     */
    async getDocumentosEliminados(tenantId: string, empleadoId: string): Promise<AuditEntry[]> {
        const { data, error } = await supabase
            .from('audit_log')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('resource_type', 'planilla_empleado_documentos')
            .eq('action', 'DELETE')
            .eq('old_values->>empleado_id', empleadoId)
            .order('created_at', { ascending: false });

        if (error) {
            Logger.error('Error al consultar documentos eliminados', { tenantId, empleadoId }, error);
            throw error;
        }

        return (data || []) as AuditEntry[];
    }
};
