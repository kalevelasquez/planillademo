
-- SQL Migration: Fix Monitoring Permissions (US-OBS-02)
-- ─────────────────────────────────────────────────────────────────

-- 1. Asegurar acceso a tablas críticas para el rol de servicio y usuarios autenticados
GRANT SELECT ON TABLE public.tenants TO service_role;
GRANT SELECT ON TABLE public.tenants TO authenticated;

GRANT SELECT ON TABLE public.error_stats TO service_role;
GRANT SELECT ON TABLE public.error_stats TO authenticated;

-- 2. Asegurar acceso a la vista de métricas
GRANT SELECT ON public.view_admin_metrics TO service_role;
GRANT SELECT ON public.view_admin_metrics TO authenticated;

-- 3. Asegurar ejecución de la función de incremento de métricas
GRANT EXECUTE ON FUNCTION public.increment_error_metrics(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_error_metrics(UUID) TO authenticated;

-- 4. Bypass RLS para la sonda de salud (opcional pero recomendado si service_role falla)
-- Nota: Supabase usualmente permite al service_role saltar RLS, 
-- pero garantizamos acceso básico de lectura si es necesario.
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY; -- Asegurar que RLS esté activo
-- No desactivamos RLS, solo garantizamos que el Grant exista.
