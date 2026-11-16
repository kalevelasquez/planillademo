-- Migration: Sistema de Telemetría para Depuración Remota (US-OBS-03)
-- Author: Antigravity
-- Description: Implementa soporte para registro de errores técnicos en base de datos.
--              Permite diagnosticar fallos en dispositivos móviles (PWA) sin acceso a consola.

BEGIN;

-- 1. Crear tabla de errores técnicos
CREATE TABLE IF NOT EXISTS public.tech_errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID,
    user_id UUID,
    message TEXT NOT NULL,
    stack TEXT,
    context JSONB,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 2. Seguridad RLS
ALTER TABLE public.tech_errors ENABLE ROW LEVEL SECURITY;

-- Permitir inserción anónima para errores de login/bootstrapping
DROP POLICY IF EXISTS "Anyone can insert tech errors" ON public.tech_errors;
CREATE POLICY "Anyone can insert tech errors" 
ON public.tech_errors FOR INSERT 
TO anon, authenticated
WITH CHECK (true);

-- Solo admins pueden ver los errores
DROP POLICY IF EXISTS "Admins can view tech errors" ON public.tech_errors;
CREATE POLICY "Admins can view tech errors" 
ON public.tech_errors FOR SELECT 
TO authenticated
USING (
    tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    OR 
    EXISTS (
        SELECT 1 FROM public.user_profiles 
        WHERE id = auth.uid() 
        AND 'admin' = ANY(role)
    )
    OR
    tenant_id IS NULL -- Logs globales sin asignar a tenant aún (ej. errores pre-login)
);

-- 3. RPC para registro simplificado
CREATE OR REPLACE FUNCTION public.log_tech_error(
    p_message TEXT,
    p_stack TEXT DEFAULT NULL,
    p_context JSONB DEFAULT NULL,
    p_tenant_id UUID DEFAULT NULL
) 
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.tech_errors (tenant_id, user_id, message, stack, context)
    VALUES (
        COALESCE(p_tenant_id, (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())),
        auth.uid(),
        p_message,
        p_stack,
        p_context
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Otorgar permiso de ejecución
GRANT EXECUTE ON FUNCTION public.log_tech_error(TEXT, TEXT, JSONB, UUID) TO anon, authenticated;

COMMIT;
