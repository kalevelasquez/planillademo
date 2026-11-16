-- ============================================================
-- Migración: Sistema de Salud y Métricas (US-OBS-02)
-- Autor: @operador — ImporFrut
-- Fecha: 2026-03-20
-- Descripción: Implementa la infraestructura de datos para 
--              monitoreo de salud, métricas de negocio y errores.
-- ============================================================

BEGIN;

-- 1. TABLA DE ESTADÍSTICAS DE ERRORES (CA2)
CREATE TABLE IF NOT EXISTS public.error_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    hour_timestamp TIMESTAMPTZ NOT NULL,
    error_count INT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, hour_timestamp)
);

-- Índices para optimizar consultas de gráficos
CREATE INDEX IF NOT EXISTS idx_error_stats_tenant_hour ON public.error_stats(tenant_id, hour_timestamp DESC);

-- 2. FUNCIÓN RPC PARA INCREMENTAR MÉTRICAS DE ERRORES
-- Esta función será invocada por el Logger (Frontend/Edge)
CREATE OR REPLACE FUNCTION public.increment_error_metrics(p_tenant_id UUID)
RETURNS VOID AS $$
DECLARE
    v_hour TIMESTAMPTZ := date_trunc('hour', now());
BEGIN
    INSERT INTO public.error_stats (tenant_id, hour_timestamp, error_count)
    VALUES (p_tenant_id, v_hour, 1)
    ON CONFLICT (tenant_id, hour_timestamp)
    DO UPDATE SET 
        error_count = public.error_stats.error_count + 1,
        created_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. VISTA DE MÉTRICAS PARA EL DASHBOARD ADMIN (CA2, CA3)
CREATE OR REPLACE VIEW public.view_admin_metrics AS
WITH daily_orders AS (
    SELECT 
        tenant_id,
        COUNT(id) as orders_today,
        SUM(total_amount) as revenue_today
    FROM public.orders
    WHERE created_at >= CURRENT_DATE
    GROUP BY tenant_id
),
active_users AS (
    -- Usuarios que han tenido actividad (last_login_at) en las últimas 24h
    SELECT 
        tenant_id,
        COUNT(id) as active_users_24h
    FROM public.user_profiles
    WHERE last_login_at >= (NOW() - INTERVAL '24 hours')
    GROUP BY tenant_id
)
SELECT 
    t.id as tenant_id,
    COALESCE(d_ord.orders_today, 0) as orders_today,
    COALESCE(d_ord.revenue_today, 0) as revenue_today,
    COALESCE(au.active_users_24h, 0) as active_users_24h,
    (SELECT COALESCE(SUM(error_count), 0) 
     FROM public.error_stats 
     WHERE tenant_id = t.id AND hour_timestamp >= (NOW() - INTERVAL '24 hours')
    ) as errors_last_24h
FROM public.tenants t
LEFT JOIN daily_orders d_ord ON t.id = d_ord.tenant_id
LEFT JOIN active_users au ON t.id = au.tenant_id;

-- 4. SEGURIDAD RLS PARA LA VISTA
-- Nota: Las vistas no soportan RLS directo en versiones antiguas de Postgres, 
-- pero Supabase aplica las políticas de las tablas subyacentes. 
-- Sin embargo, definiremos Grant para que solo el rol authenticated pueda leerla.

GRANT SELECT ON public.view_admin_metrics TO authenticated;
GRANT SELECT ON public.error_stats TO authenticated;

-- RLS en la tabla de errores
ALTER TABLE public.error_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view their own error stats" ON public.error_stats;
CREATE POLICY "Admins can view their own error stats"
ON public.error_stats FOR SELECT
TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id() 
    AND 'admin' = ANY(public.get_auth_roles())
);

COMMIT;
