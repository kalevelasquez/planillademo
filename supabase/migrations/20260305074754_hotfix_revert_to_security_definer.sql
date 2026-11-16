-- hotfix: revert auth helper functions to SECURITY DEFINER
-- 
-- Razón: Las funciones JWT-based (auth.jwt() -> 'user_metadata') dependen de que
-- el token de sesión activo en el browser tenga los claims correctos. Si el token
-- fue emitido antes de que se popularan los user_metadata (o entre refreshes lentos),
-- get_auth_tenant_id() devuelve NULL y la RLS bloquea toda lectura lateral del tenant.
--
-- Las funciones SECURITY DEFINER son la solución correcta porque:
-- 1. Ejecutan como el dueño de la función (postgres), bypassing RLS de user_profiles
-- 2. No hay recursión real: el bypass los saca del ciclo de evaluación de políticas
-- 3. Siempre devuelven el valor correcto desde la tabla, sin depender del estado del JWT

CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role::text FROM public.user_profiles WHERE id = auth.uid() LIMIT 1;
$$;
