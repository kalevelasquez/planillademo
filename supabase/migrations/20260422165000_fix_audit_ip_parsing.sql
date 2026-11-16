-- ============================================================
-- Migración: Corrección de parseo de IP en auditoría
-- Fecha: 2026-04-22
-- Descripción: Evita errores de "invalid input syntax for type inet" 
--              cuando los headers x-forwarded-for contienen múltiples
--              IPs separadas por comas (común en proxies/Vercel/Cloudflare).
--              También blinda log_custom_audit con EXCEPTION.
-- ============================================================

BEGIN;

-- 1. Helper function para extraer una IP válida de forma segura
CREATE OR REPLACE FUNCTION public.fn_extract_ip(p_headers JSONB)
RETURNS INET
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_ip_raw TEXT;
    v_ip_clean TEXT;
BEGIN
    IF p_headers IS NULL THEN
        RETURN NULL;
    END IF;

    v_ip_raw := p_headers ->> 'x-forwarded-for';
    IF v_ip_raw IS NULL OR trim(v_ip_raw) = '' THEN
        RETURN NULL;
    END IF;
    
    -- Maneja casos de múltiples IPs proxy (ej. "190.1.1.1, 10.0.0.1")
    v_ip_clean := trim(split_part(v_ip_raw, ',', 1));
    
    RETURN v_ip_clean::INET;
EXCEPTION WHEN OTHERS THEN
    -- Fallback ultra seguro para no romper nunca
    RETURN NULL;
END;
$$;

-- 2. Actualizar log_custom_audit
CREATE OR REPLACE FUNCTION public.log_custom_audit(
    p_action public.audit_action,
    p_resource_type TEXT,
    p_resource_id UUID DEFAULT NULL,
    p_details JSONB DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_headers JSONB := current_setting('request.headers', true)::jsonb;
    v_tenant_id UUID := public.get_auth_tenant_id();
BEGIN
    INSERT INTO public.audit_log (
        tenant_id, 
        user_id, 
        user_email, 
        action, 
        resource_type, 
        resource_id,
        new_values, 
        ip_address, 
        user_agent
    ) VALUES (
        v_tenant_id,
        auth.uid(),
        auth.jwt() ->> 'email',
        p_action,
        p_resource_type,
        p_resource_id,
        p_details,
        public.fn_extract_ip(v_headers),
        v_headers ->> 'user-agent'
    );
EXCEPTION WHEN OTHERS THEN
    -- Ante cualquier error NO bloqueamos la operación (ej RPC desde frontend)
    RAISE WARNING 'Fallo en log_custom_audit: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Actualizar log_auth_audit
CREATE OR REPLACE FUNCTION public.log_auth_audit(
    p_action public.audit_action,
    p_email TEXT,
    p_user_id UUID DEFAULT NULL,
    p_details JSONB DEFAULT NULL
)
RETURNS VOID 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_headers JSONB := current_setting('request.headers', true)::jsonb;
    v_tenant_id UUID;
BEGIN
    IF p_user_id IS NOT NULL THEN
        SELECT tenant_id INTO v_tenant_id FROM public.user_profiles WHERE id = p_user_id;
    ELSIF p_email IS NOT NULL THEN
        SELECT tenant_id INTO v_tenant_id FROM public.user_profiles WHERE email = p_email LIMIT 1;
    END IF;

    IF v_tenant_id IS NULL AND auth.uid() IS NOT NULL THEN
        v_tenant_id := (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid());
    END IF;

    INSERT INTO public.audit_log (
        tenant_id, 
        user_id, 
        user_email, 
        action, 
        resource_type, 
        resource_id,
        new_values, 
        ip_address, 
        user_agent
    ) VALUES (
        v_tenant_id,
        COALESCE(p_user_id, CASE WHEN p_action != 'LOGIN_FAILED' THEN auth.uid() ELSE NULL END),
        p_email,
        p_action,
        'auth',
        p_user_id,
        p_details,
        public.fn_extract_ip(v_headers),
        v_headers ->> 'user-agent'
    );
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Fallo en log_auth_audit: %', SQLERRM;
END;
$$;


-- 4. Actualizar fn_capture_audit
CREATE OR REPLACE FUNCTION public.fn_capture_audit()
RETURNS TRIGGER AS $$
DECLARE
    v_headers JSONB := current_setting('request.headers', true)::jsonb;
    v_user_id UUID := auth.uid();
    v_user_email TEXT := auth.jwt() ->> 'email';
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_action public.audit_action;
BEGIN
    v_action := CASE 
        WHEN TG_OP = 'INSERT' THEN 'CREATE'::public.audit_action
        WHEN TG_OP = 'UPDATE' THEN 'UPDATE'::public.audit_action
        WHEN TG_OP = 'DELETE' THEN 'DELETE'::public.audit_action
        ELSE 'UPDATE'::public.audit_action
    END;

    INSERT INTO public.audit_log (
        tenant_id, user_id, user_email, action, resource_type, resource_id,
        old_values, new_values, ip_address, user_agent
    ) VALUES (
        v_tenant_id, v_user_id, v_user_email,
        v_action,
        TG_TABLE_NAME,
        CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
        public.fn_extract_ip(v_headers),
        v_headers ->> 'user-agent'
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Fallo en auditoría: %', SQLERRM;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
