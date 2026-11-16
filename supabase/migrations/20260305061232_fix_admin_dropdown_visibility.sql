-- Limpiamos políticas anteriores
DROP POLICY IF EXISTS "user_profiles_read_policy" ON public.user_profiles;
DROP POLICY IF EXISTS "profiles_admin_select_all" ON public.user_profiles;

-- Política de visibilidad plana por Tenant para Staff Administrativo
CREATE POLICY "user_profiles_admin_visibility" ON public.user_profiles
FOR SELECT
USING (
  -- El usuario siempre se ve a sí mismo
  id = auth.uid()
  OR 
  -- El Admin y Supervisor ven a TODO su equipo del mismo tenant
  (
    public.get_auth_tenant_id() = tenant_id 
    AND 
    public.get_auth_role() IN ('admin', 'supervisor')
  )
);
