-- Permitir que Admin y Supervisor lean perfiles de su propio Tenant
-- Esto soluciona el join nulo en la tabla de clientes
DROP POLICY IF EXISTS "profiles_admin_select_all" ON public.user_profiles;

CREATE POLICY "profiles_admin_select_all" ON public.user_profiles
FOR SELECT
USING (
  tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1)
  AND (
    EXISTS (
      SELECT 1 FROM public.user_profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'supervisor')
    )
  )
);
