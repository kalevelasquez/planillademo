-- ============================================================
-- Migración: Corrección de Mapeo en Trigger de Auditoría
-- Autor: @operador — ImporFrut
-- Fecha: 2026-03-17
-- Razón: Error 22P02 al intentar insertar en audit_log.
--        PostgreSQL usa 'INSERT' para TG_OP, pero el Enum 
--        usa 'CREATE' según los criterios de aceptación.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_capture_audit()
RETURNS TRIGGER AS $$
DECLARE
    v_headers JSONB := current_setting('request.headers', true)::jsonb;
    v_user_id UUID := auth.uid();
    v_user_email TEXT := auth.jwt() ->> 'email';
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_audit_action public.audit_action;
BEGIN
    -- Mapear TG_OP de Postgres al Enum de Negocio
    v_audit_action := CASE 
        WHEN TG_OP = 'INSERT' THEN 'CREATE'::public.audit_action
        ELSE TG_OP::public.audit_action
    END;

    INSERT INTO public.audit_log (
        tenant_id, user_id, user_email, action, resource_type, resource_id,
        old_values, new_values, ip_address, user_agent
    ) VALUES (
        v_tenant_id, v_user_id, v_user_email,
        v_audit_action,
        TG_TABLE_NAME,
        CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('CREATE', 'UPDATE', 'INSERT') THEN to_jsonb(NEW) ELSE NULL END,
        (v_headers ->> 'x-forwarded-for')::INET,
        v_headers ->> 'user-agent'
    );
    
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
