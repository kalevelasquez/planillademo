-- Migration: Métricas de extracción por IA (IMPL-107 / US-OBS-03)
-- Author: @alexis
-- Description: US-OBS-03 CA1/CA2 — `planilla_ia_invocaciones` (20260731090000) hoy solo
--              existe para el rate-limit diario (tenant_id/user_id/created_at) — no registra
--              éxito/fallo/timeout ni tasa de fallback a manual. Se agregan columnas de
--              resultado (aditivo, todas nullable — las filas viejas quedan sin dato, que se
--              interpreta como "desconocido" en la vista de métricas) y una función
--              `get_metricas_ia_planilla` que agrega por período y calcula si el umbral de
--              fallback configurado (30%, hardcodeado — sin precedente de tabla de config
--              editable por admin para este tipo de umbral en el proyecto) fue superado hoy.

BEGIN;

ALTER TABLE public.planilla_ia_invocaciones
    ADD COLUMN IF NOT EXISTS modulo TEXT CHECK (modulo IN ('anticipo', 'viatico')),
    ADD COLUMN IF NOT EXISTS resultado TEXT CHECK (resultado IN ('exito', 'fallo', 'timeout')),
    ADD COLUMN IF NOT EXISTS legible BOOLEAN,
    ADD COLUMN IF NOT EXISTS confianza NUMERIC,
    ADD COLUMN IF NOT EXISTS duracion_ms INT,
    ADD COLUMN IF NOT EXISTS resuelto_at TIMESTAMPTZ;

-- Las Edge Functions ya escriben con SERVICE ROLE (bypass de RLS) — no hace falta una policy
-- de UPDATE nueva para que puedan completar `resultado` tras la respuesta de Anthropic.

CREATE OR REPLACE FUNCTION public.get_metricas_ia_planilla(p_dias INT DEFAULT 30)
RETURNS TABLE (
    total_invocaciones BIGINT,
    exitosas BIGINT,
    fallidas BIGINT,
    timeouts BIGINT,
    tasa_exito NUMERIC,
    tasa_fallback NUMERIC,
    fallback_hoy_supera_umbral BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_umbral_fallback NUMERIC := 0.30; -- CA2: 30% configurable — hardcodeado por ahora, ver gap
    v_total_hoy NUMERIC;
    v_fallback_hoy NUMERIC;
BEGIN
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE resultado = 'exito'),
        COUNT(*) FILTER (WHERE resultado = 'fallo'),
        COUNT(*) FILTER (WHERE resultado = 'timeout')
    INTO total_invocaciones, exitosas, fallidas, timeouts
    FROM public.planilla_ia_invocaciones
    WHERE tenant_id = v_tenant_id AND created_at >= now() - (p_dias || ' days')::INTERVAL;

    tasa_exito := CASE WHEN total_invocaciones > 0 THEN ROUND(exitosas::NUMERIC / total_invocaciones, 4) ELSE NULL END;
    tasa_fallback := CASE WHEN total_invocaciones > 0 THEN ROUND((fallidas + timeouts)::NUMERIC / total_invocaciones, 4) ELSE NULL END;

    SELECT COUNT(*), COUNT(*) FILTER (WHERE resultado IN ('fallo', 'timeout'))
    INTO v_total_hoy, v_fallback_hoy
    FROM public.planilla_ia_invocaciones
    WHERE tenant_id = v_tenant_id AND created_at >= date_trunc('day', now());

    fallback_hoy_supera_umbral := v_total_hoy > 0 AND (v_fallback_hoy / v_total_hoy) > v_umbral_fallback;

    RETURN NEXT;
END;
$$;

COMMIT;
