-- Migration: Monto configurable de Lavado y Gasolina (IMPL-36 CA4)
-- Author: @alexis
-- Description: CA4 exige que el monto del concepto "Lavado y gasolina" sea configurable, no
--              un valor fijo en código (hallazgo de UAT — hoy es un número libre tipeado a
--              mano cada vez, sin ningún parámetro admin-editable). Se crea un catálogo
--              minimalista de una sola fila por tenant, mismo patrón admin-only + auditoría de
--              `planilla_tarifas_km_cargo` (20260729090000) — no existe en este proyecto una
--              tabla genérica de "settings" de un solo valor para reutilizar; cada valor
--              configurable vive en su propia tabla pequeña, así que se sigue esa convención en
--              vez de inventar una nueva.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_config_lavado_gasolina (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    monto NUMERIC NOT NULL CHECK (monto >= 0),
    updated_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id)
);

ALTER TABLE public.planilla_config_lavado_gasolina ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_config_lavado_gasolina_select_tenant"
    ON public.planilla_config_lavado_gasolina FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_config_lavado_gasolina_insert_admin"
    ON public.planilla_config_lavado_gasolina FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_config_lavado_gasolina_update_admin"
    ON public.planilla_config_lavado_gasolina FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_config_lavado_gasolina ON public.planilla_config_lavado_gasolina;
CREATE TRIGGER tr_audit_planilla_config_lavado_gasolina
    AFTER INSERT OR UPDATE ON public.planilla_config_lavado_gasolina
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

COMMIT;
