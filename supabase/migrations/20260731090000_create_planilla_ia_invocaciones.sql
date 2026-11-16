-- Migration: Rate Limit de Invocaciones de IA (IMPL-30 / US-VIA-00)
-- Author: @alexis
-- Description: Registro de cada invocación a la Edge Function `extraer-viatico-ia` — a
--              diferencia del resto de las Edge Functions del proyecto (gratis de operar),
--              esta cuesta dinero real por invocación (API de Anthropic). Se cuenta cada
--              intento (se complete o no la llamada real a Anthropic) para aplicar un rate
--              limit simple por usuario dentro de la Edge Function misma — ver esa función
--              para el límite exacto (LIMITE_DIARIO_POR_USUARIO). Solo INSERT/SELECT, sin
--              UPDATE/DELETE — es un log de conteo, no un registro editable.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_ia_invocaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planilla_ia_invocaciones_user_fecha ON public.planilla_ia_invocaciones(user_id, created_at);

ALTER TABLE public.planilla_ia_invocaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_ia_invocaciones_select_tenant"
    ON public.planilla_ia_invocaciones FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_ia_invocaciones_insert_tenant"
    ON public.planilla_ia_invocaciones FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

COMMIT;
