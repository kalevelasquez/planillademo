-- ============================================================
-- Migración: Sistema de Auditoría Inmutable (US-AUD-01)
-- Autor: @operador — ImporFrut
-- Fecha: 2026-03-17
-- Descripción: Implementa el log de auditoría inmutable, funciones
--              de captura automática y blindaje de integridad.
-- ============================================================

BEGIN;

-- 1. CREACIÓN DE TIPOS Y TABLA
DO $$ BEGIN
    CREATE TYPE public.audit_action AS ENUM (
        'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'EXPORT', 'UPLOAD', 'SHARE'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS public.audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID,
    user_email TEXT,
    action public.audit_action NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Índices de auditoría
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_id ON public.audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON public.audit_log(resource_type, resource_id);

-- 2. FUNCIONES DE CAPTURA Y PROTECCIÓN

-- Función RPC para registros manuales (Login, Export, etc)
CREATE OR REPLACE FUNCTION public.log_custom_audit(
    p_action public.audit_action,
    p_resource_type TEXT,
    p_resource_id UUID DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_headers JSONB := current_setting('request.headers', true)::jsonb;
BEGIN
    INSERT INTO public.audit_log (
        tenant_id, user_id, user_email, action, resource_type, resource_id,
        ip_address, user_agent
    ) VALUES (
        public.get_auth_tenant_id(),
        auth.uid(),
        auth.jwt() ->> 'email',
        p_action,
        p_resource_type,
        p_resource_id,
        (v_headers ->> 'x-forwarded-for')::INET,
        v_headers ->> 'user-agent'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función genérica para triggers automáticos
CREATE OR REPLACE FUNCTION public.fn_capture_audit()
RETURNS TRIGGER AS $$
DECLARE
    v_headers JSONB := current_setting('request.headers', true)::jsonb;
    v_user_id UUID := auth.uid();
    v_user_email TEXT := auth.jwt() ->> 'email';
    v_tenant_id UUID := public.get_auth_tenant_id();
BEGIN
    INSERT INTO public.audit_log (
        tenant_id, user_id, user_email, action, resource_type, resource_id,
        old_values, new_values, ip_address, user_agent
    ) VALUES (
        v_tenant_id, v_user_id, v_user_email,
        TG_OP::public.audit_action,
        TG_TABLE_NAME,
        CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('CREATE', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
        (v_headers ->> 'x-forwarded-for')::INET,
        v_headers ->> 'user-agent'
    );
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función de blindaje: Inmutabilidad física (CA4)
CREATE OR REPLACE FUNCTION public.fn_protect_audit_log()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Operación no permitida: Los registros de auditoría son inmutables.';
END;
$$ LANGUAGE plpgsql;

-- Trigger de blindaje en audit_log
DROP TRIGGER IF EXISTS tr_audit_log_immutable ON public.audit_log;
CREATE TRIGGER tr_audit_log_immutable
BEFORE UPDATE OR DELETE ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.fn_protect_audit_log();

-- 3. APLICACIÓN DE TRIGGERS A TABLAS CRÍTICAS (CA2)
DO $$ 
DECLARE
    t text;
BEGIN
    FOR t IN SELECT unnest(ARRAY['orders', 'order_items', 'products', 'customers', 'user_profiles'])
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS tr_audit_%I ON public.%I', t, t);
        EXECUTE format('CREATE TRIGGER tr_audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit()', t, t);
    END LOOP;
END $$;

-- 4. CONFIGURACIÓN DE RLS (CA3)
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_select_policy" ON public.audit_log;
CREATE POLICY "audit_log_select_policy" ON public.audit_log
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id() 
    AND ('admin' = ANY(public.get_auth_roles()) OR 'supervisor' = ANY(public.get_auth_roles()))
);

DROP POLICY IF EXISTS "audit_log_insert_policy" ON public.audit_log;
CREATE POLICY "audit_log_insert_policy" ON public.audit_log
FOR INSERT TO authenticated
WITH CHECK (tenant_id = public.get_auth_tenant_id());

COMMIT;
