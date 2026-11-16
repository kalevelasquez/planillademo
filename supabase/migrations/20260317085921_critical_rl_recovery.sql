-- ============================================================
-- Migración: Recuperación Crítica de Visibilidad (US-ORD-11 RECOVERY)
-- Autor: @arquitecto / Antigravity
-- Fecha: 2026-03-17
-- Razón: El sistema dejó de cargar datos debido a una recursión infinita
--        en las políticas RLS. Estas funciones ahora son 100% atómicas
--        y se basan únicamente en el JWT para romper el ciclo.
-- ============================================================

BEGIN;

-- 1. Redefinir funciones fundamentales para ELIMINAR RECURSIÓN
-- Estas funciones YA NO consultan la tabla user_profiles, rompiendo el ciclo RLS -> Función -> RLS.
-- El tenant_id y los roles DEBEN estar en el JWT (estándar de Supabase).

CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_roles()
RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT ARRAY(
    SELECT DISTINCT val
    FROM jsonb_array_elements_text(
      CASE 
        WHEN jsonb_typeof(auth.jwt() -> 'user_metadata' -> 'roles') = 'array' THEN auth.jwt() -> 'user_metadata' -> 'roles'
        WHEN jsonb_typeof(auth.jwt() -> 'user_metadata' -> 'role') = 'array' THEN auth.jwt() -> 'user_metadata' -> 'role'
        ELSE jsonb_build_array(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', 'vendedor'))
      END
    ) AS val
  );
$$;

-- 2. Reforzar la política de USER_PROFILES para evitar el bloqueo total
-- Si el JWT fallara por alguna razón, permitimos que el usuario vea su propia fila basándonos en auth.uid() directamente.
DROP POLICY IF EXISTS "user_profiles_select_policy" ON public.user_profiles;
CREATE POLICY "user_profiles_select_policy_v3" ON public.user_profiles
FOR SELECT TO authenticated
USING (
    id = auth.uid() 
    OR tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid
);

-- 3. Asegurar que las políticas de ORDERS usen la nueva lógica sin dependencias circulares
DROP POLICY IF EXISTS "orders_select_v4" ON public.orders;
DROP POLICY IF EXISTS "orders_insert_v4" ON public.orders;
DROP POLICY IF EXISTS "orders_update_v4" ON public.orders;

CREATE POLICY "orders_select_v5" ON public.orders
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND (
        public.get_auth_roles() && ARRAY['admin', 'supervisor', 'despachador']::text[]
        OR seller_id = auth.uid()
    )
);

CREATE POLICY "orders_insert_v5" ON public.orders
FOR INSERT TO authenticated
WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND (
        public.get_auth_roles() && ARRAY['admin', 'supervisor']::text[]
        OR (seller_id = auth.uid() OR seller_id IS NULL)
    )
);

CREATE POLICY "orders_update_v5" ON public.orders
FOR UPDATE TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND (
        public.get_auth_roles() && ARRAY['admin', 'supervisor', 'despachador']::text[]
        OR seller_id = auth.uid()
    )
)
WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND (
        public.get_auth_roles() && ARRAY['admin', 'supervisor', 'despachador']::text[]
        OR seller_id = auth.uid()
    )
);

COMMIT;
