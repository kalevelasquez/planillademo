-- Migration: Catálogo de Destinos con monto fijo (IMPL-170 CA4/CA5, reunión con Imporfrut sept. 2026)
-- Author: @alexis
-- Description: Cada Destino tiene un monto fijo asociado — al importar un lote de Viáticos
--              (IMPL-170), si el Destino leído del documento coincide con este catálogo, el
--              sistema precarga automáticamente el monto, incluso si el documento original no
--              trae uno legible. Mismo patrón exacto que `planilla_bancos`
--              (20260907100000_create_planilla_bancos.sql), único cambio real: agrega `monto`.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_destinos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    monto NUMERIC NOT NULL DEFAULT 0 CHECK (monto >= 0),
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id, nombre)
);

ALTER TABLE public.planilla_destinos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_destinos_select_tenant"
    ON public.planilla_destinos FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_destinos_insert_admin"
    ON public.planilla_destinos FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_destinos_update_admin"
    ON public.planilla_destinos FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_destinos ON public.planilla_destinos;
CREATE TRIGGER tr_audit_planilla_destinos
    AFTER INSERT OR UPDATE ON public.planilla_destinos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

COMMIT;
