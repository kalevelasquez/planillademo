-- Migration: Catálogo de Instituciones de Vivienda (hallazgo UAT, observación de Gilda 2026-10-15)
-- Author: @alexis
-- Description: El combo "Institución" de Descuentos (IMPL-172) reusa el catálogo de Bancos
--              (`planilla_bancos`), pero ese catálogo es específicamente para bancos comerciales
--              de depósito/financiamiento — lo usa también `planilla_empleados.banco` para elegir
--              en qué banco se le deposita el sueldo al empleado (ver 20260907100000). El Fondo
--              Social para la Vivienda (FSV) no es un banco de depósito, así que meterlo ahí
--              contaminaría ese combo con una opción que no tiene sentido como cuenta de nómina.
--
--              `src/utils/descuentosPivotUtils.ts` ya tiene una lista `INSTITUCIONES_VIVIENDA`
--              (Fondo Social para la Vivienda, Hábitat para la Humanidad) para clasificar el
--              reporte pivot de Descuentos (IMPL-167) — pero como ninguna de las dos existía en
--              ningún catálogo seleccionable, era IMPOSIBLE elegirlas al dar de alta un descuento
--              de categoría "Vivienda" (el combo es un <select> puro, sin texto libre para altas
--              nuevas). Todo descuento de Vivienda nuevo caía en el catch-all "Otra Vivienda" del
--              reporte, silenciosamente.
--
--              Catálogo nuevo, separado de Bancos, mismo patrón administrativo (RLS, auditoría,
--              sin DELETE — se desactiva, nunca se borra). El combo de Descuentos, para la
--              categoría "Vivienda", muestra la UNIÓN de este catálogo + Bancos (un préstamo de
--              vivienda también puede ser con un banco comercial, no solo con el FSV directo).
--
--              Seed con el nombre EXACTO de `INSTITUCIONES_VIVIENDA` en descuentosPivotUtils.ts,
--              para que el fuzzy-match del reporte (`normalizarTexto`) los reconozca sin tocar ese
--              archivo.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_instituciones_vivienda (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id, nombre)
);

ALTER TABLE public.planilla_instituciones_vivienda ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_instituciones_vivienda_select_tenant"
    ON public.planilla_instituciones_vivienda FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_instituciones_vivienda_insert_admin"
    ON public.planilla_instituciones_vivienda FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_instituciones_vivienda_update_admin"
    ON public.planilla_instituciones_vivienda FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_instituciones_vivienda ON public.planilla_instituciones_vivienda;
CREATE TRIGGER tr_audit_planilla_instituciones_vivienda
    AFTER INSERT OR UPDATE ON public.planilla_instituciones_vivienda
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

INSERT INTO public.planilla_instituciones_vivienda (tenant_id, nombre)
SELECT t.id, v.nombre
FROM public.tenants t
CROSS JOIN (VALUES ('Fondo Social para la Vivienda'), ('Habitad para la Humanidad')) AS v(nombre)
ON CONFLICT (tenant_id, nombre) DO NOTHING;

COMMIT;
