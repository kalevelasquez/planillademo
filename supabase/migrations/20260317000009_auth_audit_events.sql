-- ============================================================
-- Migración: Registro de Eventos de Autenticación (US-AUD-03)
-- Autor: @arquitecto — ImporFrut
-- Fecha: 2026-03-17
-- Descripción: Amplía el sistema de auditoría para capturar eventos 
--              de seguridad como login, logout y cambios de contraseña.
-- ============================================================

BEGIN;

-- 1. AMPLIAR ENUM DE ACCIONES
-- Usamos un bloque DO para asegurar compatibilidad y evitar errores si ya existen.
DO $$
BEGIN
    -- Añadir LOGIN_FAILED si no existe
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.audit_action'::regtype AND enumlabel = 'LOGIN_FAILED') THEN
        ALTER TYPE public.audit_action ADD VALUE 'LOGIN_FAILED';
    END IF;
    -- Añadir LOGOUT si no existe
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.audit_action'::regtype AND enumlabel = 'LOGOUT') THEN
        ALTER TYPE public.audit_action ADD VALUE 'LOGOUT';
    END IF;
    -- Añadir PASSWORD_CHANGE si no existe
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.audit_action'::regtype AND enumlabel = 'PASSWORD_CHANGE') THEN
        ALTER TYPE public.audit_action ADD VALUE 'PASSWORD_CHANGE';
    END IF;
    -- Añadir MFA_CHANGE si no existe
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.audit_action'::regtype AND enumlabel = 'MFA_CHANGE') THEN
        ALTER TYPE public.audit_action ADD VALUE 'MFA_CHANGE';
    END IF;
END $$;

-- 2. FLEXIBILIZAR TENANT_ID PARA EVENTOS DE PRE-AUTH
-- Para logins fallidos no siempre tenemos el tenant resuelto en el contexto.
ALTER TABLE public.audit_log ALTER COLUMN tenant_id DROP NOT NULL;

-- 3. FUNCIÓN ROBUSTA PARA AUDITORÍA DE SEGURIDAD (CA1, CA2)
-- Esta función es SECURITY DEFINER para permitir registros antes de tener sesión activa.
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
    -- Intentar resolver tenant_id para dar contexto a la auditoría
    IF p_user_id IS NOT NULL THEN
        SELECT tenant_id INTO v_tenant_id FROM public.user_profiles WHERE id = p_user_id;
    ELSIF p_email IS NOT NULL THEN
        -- Buscamos el tenant asociado a ese email si existe en nuestros perfiles
        SELECT tenant_id INTO v_tenant_id FROM public.user_profiles WHERE email = p_email LIMIT 1;
    END IF;

    -- Si aún es null y hay sesión, usamos el del usuario actual
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
        (v_headers ->> 'x-forwarded-for')::INET,
        v_headers ->> 'user-agent'
    );
END;
$$;

COMMIT;
