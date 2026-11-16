-- migration: fix_jwt_auth_functions
-- Objetivo: Eliminar la dependencia circular en el RLS de user_profiles.
-- Las funciones auxiliares dejan de consultar la tabla user_profiles
-- y ahora leen directamente del JWT del usuario autenticado.

-- 1. Redefinir para leer desde JWT Metadata y evitar recursión en user_profiles
CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  -- Extrae el tenant_id de los metadatos del usuario en el token JWT de Supabase
  SELECT (NULLIF(auth.jwt() -> 'user_metadata' ->> 'tenant_id', ''))::uuid;
$$;

-- 2. Redefinir para leer el rol desde JWT Metadata
CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  -- Extrae el rol de los metadatos del usuario en el token JWT
  SELECT auth.jwt() -> 'user_metadata' ->> 'role';
$$;

-- Comentario técnico: Estas funciones ahora son independientes de la tabla user_profiles,
-- permitiendo que las políticas RLS se evalúen sin disparar consultas infinitas.
