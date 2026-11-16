-- ============================================================
-- Migración: Estabilización de Funciones de Autenticación y Auditoría (US-AUTH-07)
-- Autor: @arquitecto — ImporFrut
-- Fecha: 2026-03-16
-- Razón: Se han detectado casos de "items desaparecidos" debido a fallos
--        en la resolución del tenant_id o roles desde el JWT/Tabla.
--        Esta migración blindas las funciones base para evitar recursión RLS
--        y asegura que la auditoría no rompa las transacciones.
-- ============================================================

BEGIN;

-- 1. Reforzar get_auth_tenant_id para ser resiliente a fallos de tabla
CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    v_tenant_id uuid;
BEGIN
    -- Intento 1: Desde el JWT metadata (más rápido y evita recursión)
    v_tenant_id := (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid;
    
    -- Intento 2: Si no está en JWT, buscar en tabla (fuente de verdad física)
    -- Usamos limit 1 y evitamos joins
    IF v_tenant_id IS NULL THEN
        SELECT tenant_id INTO v_tenant_id FROM public.user_profiles WHERE id = auth.uid();
    END IF;
    
    RETURN v_tenant_id;
END;
$$;

-- 2. Reforzar get_auth_roles para ser resiliente
CREATE OR REPLACE FUNCTION public.get_auth_roles()
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    v_roles text[];
BEGIN
    -- Intento 1: Desde el JWT metadata
    SELECT ARRAY(
        SELECT jsonb_array_elements_text(
            CASE 
                WHEN jsonb_typeof(auth.jwt() -> 'user_metadata' -> 'roles') = 'array' THEN auth.jwt() -> 'user_metadata' -> 'roles'
                WHEN jsonb_typeof(auth.jwt() -> 'user_metadata' -> 'role') = 'array' THEN auth.jwt() -> 'user_metadata' -> 'role'
                WHEN auth.jwt() -> 'user_metadata' ->> 'role' IS NOT NULL THEN jsonb_build_array(auth.jwt() -> 'user_metadata' ->> 'role')
                ELSE NULL
            END
        )
    ) INTO v_roles;

    -- Intento 2: Si el array está vacío, buscar en tabla
    IF v_roles IS NULL OR array_length(v_roles, 1) IS NULL THEN
        SELECT role INTO v_roles FROM public.user_profiles WHERE id = auth.uid();
    END IF;

    -- Fallback final
    IF v_roles IS NULL OR array_length(v_roles, 1) IS NULL THEN
        v_roles := ARRAY['vendedor'];
    END IF;

    RETURN v_roles;
END;
$$;

-- 3. Corregir fn_capture_audit para soportar INSERT -> CREATE y NEW_VALUES en inserts
CREATE OR REPLACE FUNCTION public.fn_capture_audit()
RETURNS TRIGGER AS $$
DECLARE
    v_headers JSONB := current_setting('request.headers', true)::jsonb;
    v_user_id UUID := auth.uid();
    v_user_email TEXT := auth.jwt() ->> 'email';
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_action public.audit_action;
BEGIN
    -- Mapeo seguro de operación a enum audit_action
    v_action := CASE 
        WHEN TG_OP = 'INSERT' THEN 'CREATE'::public.audit_action
        WHEN TG_OP = 'UPDATE' THEN 'UPDATE'::public.audit_action
        WHEN TG_OP = 'DELETE' THEN 'DELETE'::public.audit_action
        ELSE 'UPDATE'::public.audit_action -- Fallback
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
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END, -- Corregido: 'INSERT' en lugar de 'CREATE' para el check de TG_OP
        (v_headers ->> 'x-forwarded-for')::INET,
        v_headers ->> 'user-agent'
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Ante cualquier error en auditoría, NO bloqueamos la operación principal
    -- Esto garantiza que los pedidos se guarden aunque falle el log
    RAISE WARNING 'Fallo en auditoría: %', SQLERRM;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
