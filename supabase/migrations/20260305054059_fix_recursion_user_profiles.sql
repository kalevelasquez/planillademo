-- Fix for infinite recursion in user_profiles table

-- 1. Función SECURITY DEFINER para obtener el tenant_id del usuario sin disparar RLS
CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- 2. Función SECURITY DEFINER para obtener el rol del usuario sin disparar RLS
CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role::text FROM public.user_profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- 3. Eliminamos las políticas problemáticas
DROP POLICY IF EXISTS "profiles_admin_select_all" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_select_policy" ON public.user_profiles;

-- 4. Creamos una política limpia y optimizada usando las funciones seguras
CREATE POLICY "user_profiles_read_policy" ON public.user_profiles
FOR SELECT
USING (
  -- Comparación usando la función estable que evade la recursión
  tenant_id = public.get_auth_tenant_id()
  AND (
    -- El usuario siempre puede ver su propio perfil
    id = auth.uid()
    OR 
    -- Admin y Supervisor pueden ver a todos los del mismo tenant
    public.get_auth_role() IN ('admin', 'supervisor')
  )
);
