-- Migration: Fix Auditoría para Service Role y Tablas de Roles (US-AUD-07)
-- Autor: Antigravity — ImporFrut
-- Fecha: 2026-03-17
-- Descripción: 1. Mejora la captura de auditoría para que funcione con Edge Functions (Service Role).
--              2. Asegura que cambios en permisos (permission_matrix) sean auditados.
--              3. Corrige la visibilidad de los logs generados por el sistema.

BEGIN;

-- 1. Mejorar fn_capture_audit para herencia de tenant_id
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
        ELSE 'UPDATE'::public.audit_action 
    END;

    -- SI v_tenant_id es NULL (ej: Service Role desde Edge Function)
    -- Intentamos heredarlo del registro que se está modificando
    IF v_tenant_id IS NULL THEN
        -- Intentar obtener de NEW (Insert/Update)
        BEGIN
            -- Para la tabla 'tenants', el tenant_id es el 'id'
            IF TG_TABLE_NAME = 'tenants' THEN
                v_tenant_id := NEW.id;
            ELSE
                v_tenant_id := NEW.tenant_id;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Intentar obtener de OLD (Delete)
            BEGIN
                IF TG_TABLE_NAME = 'tenants' THEN
                    v_tenant_id := OLD.id;
                ELSE
                    v_tenant_id := OLD.tenant_id;
                END IF;
            EXCEPTION WHEN OTHERS THEN
                NULL;
            END;
        END;
    END IF;

    -- Si el usuario es NULL (Service Role), marcamos como acción de sistema/admin
    IF v_user_id IS NULL THEN
        v_user_email := COALESCE(v_user_email, 'system-admin@imporfrut.com');
    END IF;

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
        (v_headers ->> 'x-forwarded-for')::INET,
        v_headers ->> 'user-agent'
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Fallo en auditoría: %', SQLERRM;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Asegurar que permission_matrix, dispatchers y tenants están auditadas
DO $$ 
DECLARE
    t text;
BEGIN
    FOR t IN SELECT unnest(ARRAY['permission_matrix', 'dispatchers', 'tenants'])
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_audit_' || t) THEN
            EXECUTE format('CREATE TRIGGER tr_audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit()', t, t);
        END IF;
    END LOOP;
END $$;

-- 3. Retrofilar logs existentes que quedaron sin tenant_id (huérfanos de visibilidad)
-- Importante: El blindaje de inmutabilidad debe suspenderse para este proceso
ALTER TABLE public.audit_log DISABLE TRIGGER tr_audit_log_immutable;

-- Mapeamos logs de 'user_profiles' comparando resource_id con la tabla
UPDATE public.audit_log l
SET tenant_id = p.tenant_id
FROM public.user_profiles p
WHERE l.tenant_id IS NULL 
  AND l.resource_type = 'user_profiles' 
  AND l.resource_id = p.id;

-- Mapeamos logs de 'permission_matrix'
UPDATE public.audit_log l
SET tenant_id = m.tenant_id
FROM public.permission_matrix m
WHERE l.tenant_id IS NULL 
  AND l.resource_type = 'permission_matrix' 
  AND l.resource_id = m.id;

-- Reactivar blindaje tras la reparación
ALTER TABLE public.audit_log ENABLE TRIGGER tr_audit_log_immutable;

COMMIT;
