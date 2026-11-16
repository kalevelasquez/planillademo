-- Migration: Bonificaciones y Otros Ingresos — catálogo de conceptos (IMPL-71 / US-OTR-00, IMPL-77)
-- Author: @alexis
-- Description: `planilla_otros_ingresos_conceptos` es el catálogo administrable que pide CA1
--              ("lista administrable... no fija en código"). A diferencia de
--              `planilla_descuento_categorias` (que no tenía historia de administración propia),
--              acá SÍ hay una pantalla de configuración dedicada porque el CA lo exige
--              explícitamente. Sembrado con los tipos confirmados por Imporfrut en el propio CA1:
--              Salario, Horas Extras, Viáticos, Bono, más dos ejemplos adicionales de "otros
--              conceptos configurables" que el CA menciona (Retroactivo de Salario, Dietas).
--              Deliberadamente NO se siembra "Comisión" — el CA1 aclara explícitamente que
--              Imporfrut no usa ese concepto, a diferencia del mock del DEMO que sí lo incluye.
--
--              `gravabilidad_default` usa el mismo mecanismo de 3 estados que introduce US-OTR-01
--              (CA2 de IMPL-78): 'gravable' | 'no_gravable' | 'bono_10'. Cada concepto define un
--              default editable al momento de registrar (CA2 de este mismo ticket), no un valor
--              fijo — la columna es solo la precarga inicial del formulario de US-OTR-01.
--
--              Sin DELETE físico expuesto (a diferencia de `planilla_tarifas_km_cargo`): un
--              concepto puede estar referenciado por filas ya existentes de
--              `planilla_otros_ingresos` (tabla de la próxima migración, US-OTR-01) — se
--              desactiva (`activo=false`) en vez de borrarse, mismo criterio que
--              `planilla_descuento_categorias`.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_otros_ingresos_conceptos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    gravabilidad_default TEXT NOT NULL CHECK (gravabilidad_default IN ('gravable', 'no_gravable', 'bono_10')),
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id, nombre)
);

ALTER TABLE public.planilla_otros_ingresos_conceptos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_otros_ingresos_conceptos_select_tenant"
    ON public.planilla_otros_ingresos_conceptos FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

-- Catálogo de configuración: solo admin administra (CA1 dice "Como administrador").
CREATE POLICY "planilla_otros_ingresos_conceptos_insert_admin"
    ON public.planilla_otros_ingresos_conceptos FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_otros_ingresos_conceptos_update_admin"
    ON public.planilla_otros_ingresos_conceptos FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_otros_ingresos_conceptos ON public.planilla_otros_ingresos_conceptos;
CREATE TRIGGER tr_audit_planilla_otros_ingresos_conceptos
    AFTER INSERT OR UPDATE ON public.planilla_otros_ingresos_conceptos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- Semilla inicial (CA1): defaults de gravabilidad son un criterio razonable documentado como
-- supuesto (Jira no especifica gravabilidad por concepto) — editable después desde la UI.
INSERT INTO public.planilla_otros_ingresos_conceptos (tenant_id, nombre, gravabilidad_default)
SELECT t.id, v.nombre, v.gravabilidad_default
FROM public.tenants t
CROSS JOIN (VALUES
    ('Salario', 'gravable'),
    ('Horas Extras', 'gravable'),
    ('Viáticos', 'no_gravable'),
    ('Bono', 'gravable'),
    ('Retroactivo de Salario', 'gravable'),
    ('Dietas', 'no_gravable')
) AS v(nombre, gravabilidad_default)
ON CONFLICT (tenant_id, nombre) DO NOTHING;

COMMIT;
