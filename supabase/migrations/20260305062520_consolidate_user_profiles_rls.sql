-- 1. Limpiar TODAS las políticas existentes en user_profiles para evitar colisiones y ruido
DROP POLICY IF EXISTS "user_profiles_tenant_isolation" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_admin_visibility" ON public.user_profiles;
DROP POLICY IF EXISTS "Admins can update colleagues" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_read_policy" ON public.user_profiles;
DROP POLICY IF EXISTS "profiles_admin_select_all" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_select_policy" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_update_policy" ON public.user_profiles;

-- 2. Visibilidad Universal de Tenant (SELECT)
-- Cualquier usuario autenticado puede ver los perfiles de su propio tenant_id utilizando la función segura.
-- Esto asegura que los 'Joins' en las consultas Frontend (ej. customer.seller.full_name) NUNCA fallen, independientemente de los roles.
CREATE POLICY "user_profiles_universal_tenant_select" ON public.user_profiles
FOR SELECT
USING (
  tenant_id = public.get_auth_tenant_id()
  OR
  id = auth.uid() -- Respaldo: Un usuario siempre debe poder leer su propia fila
);

-- 3. Gestión Administrativa (UPDATE)
-- Mantener que solo los administradores puedan editar los perfiles de los miembros de su mismo tenant.
CREATE POLICY "user_profiles_admin_update" ON public.user_profiles
FOR UPDATE
USING (
  tenant_id = public.get_auth_tenant_id()
  AND
  public.get_auth_role() IN ('admin', 'supervisor')
)
WITH CHECK (
  tenant_id = public.get_auth_tenant_id()
  AND
  public.get_auth_role() IN ('admin', 'supervisor')
);
