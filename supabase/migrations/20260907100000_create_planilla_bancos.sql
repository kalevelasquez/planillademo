-- Migration: Catálogo real de Bancos (IMPL-3/IMPL-122, hallazgo UAT agosto 2026)
-- Author: @alexis
-- Description: `planilla_empleados.banco` era texto libre — sin catálogo, el CA1 original de
--              US-EMP-01 nunca lo especificó. Texto libre genera variantes inconsistentes
--              ("Cuscatlan", "BANCO CUSCATLAN", "Cuscatlán S.A.") que rompen cualquier reporte
--              agrupado por institución bancaria. CA6 (nuevo) de IMPL-3 pide un catálogo real,
--              mismo patrón administrativo que planilla_departamentos, PERO sin color_key: a
--              diferencia de Departamento, ningún listado del sistema pinta el banco como badge
--              de color — agregar esa columna sería una abstención sin consumidor real.
--
--              `planilla_empleados.banco` SIGUE siendo TEXT (no se agrega FK), mismo criterio
--              que planilla_departamentos: evita tocar consumidores existentes de ese campo.
--
--              Sin política DELETE (mismo patrón que planilla_ubicaciones/planilla_departamentos):
--              un banco ya usado por empleados no se borra, se desactiva (estado='inactivo').
--
--              Seed con los 5 bancos documentados en el DRN §2.2 y el Excel real de nómina
--              (Cuscatlán, Agrícola, BAC, Davivienda, Promerica), pendiente de que Imporfrut
--              confirme si es la lista completa (IMPL-122). A diferencia del backfill de
--              Departamentos (que deriva de datos ya existentes), acá se sembra la lista
--              canónica del DRN en vez de los valores de texto libre ya guardados en
--              `planilla_empleados.banco` — son justamente esas variantes inconsistentes las que
--              este catálogo busca reemplazar hacia adelante, no perpetuar.
--
--              No se engancha a fn_on_tenant_created: son bancos específicos de El Salvador
--              (contexto de Imporfrut), no un catálogo universal para cualquier tenant futuro
--              del sistema — mismo criterio documentado en planilla_departamentos.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_bancos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id, nombre)
);

ALTER TABLE public.planilla_bancos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_bancos_select_tenant"
    ON public.planilla_bancos FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_bancos_insert_admin"
    ON public.planilla_bancos FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_bancos_update_admin"
    ON public.planilla_bancos FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_bancos ON public.planilla_bancos;
CREATE TRIGGER tr_audit_planilla_bancos
    AFTER INSERT OR UPDATE ON public.planilla_bancos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

INSERT INTO public.planilla_bancos (tenant_id, nombre)
SELECT t.id, b.nombre
FROM public.tenants t
CROSS JOIN (VALUES ('Cuscatlán'), ('Agrícola'), ('BAC'), ('Davivienda'), ('Promerica')) AS b(nombre)
ON CONFLICT (tenant_id, nombre) DO NOTHING;

COMMIT;
