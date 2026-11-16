-- Migration: Catálogo real de Departamentos (revisión épica por épica, IMPL-2 gap #2)
-- Author: @alexis
-- Description: `planilla_empleados.departamento` era texto libre con color de badge asignado
--              por hash del string (sin catálogo, porque el DRN no definió uno) — decisión
--              revisitada en la revisión historia por historia: el cliente pidió un catálogo
--              real administrable con color fijo por departamento.
--
--              `planilla_empleados.departamento` SIGUE siendo TEXT (no se agrega FK): el resto
--              del proyecto (jornadas por cargo/departamento IMPL-80, resumen por departamento
--              de Cálculo de Planilla IMPL-89, historial de cambios) ya lee ese campo como texto
--              libre y no espera una relación — agregar una FK obligaría a tocar esos 4+
--              consumidores sin ningún beneficio real. El catálogo solo sirve para: (a) fijar el
--              color del badge en vez de un hash, (b) dar al formulario de alta/edición un select
--              en vez de texto libre, curando los valores válidos hacia adelante.
--
--              Sin política DELETE (mismo patrón que planilla_ubicaciones/
--              planilla_otros_ingresos_conceptos): un departamento ya usado por empleados no se
--              borra, se desactiva (estado='inactivo').

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_departamentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    color_key TEXT NOT NULL DEFAULT 'blue'
        CHECK (color_key IN ('blue', 'amber', 'primary', 'purple', 'pink', 'secondary', 'teal')),
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id, nombre)
);

ALTER TABLE public.planilla_departamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_departamentos_select_tenant"
    ON public.planilla_departamentos FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_departamentos_insert_admin"
    ON public.planilla_departamentos FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_departamentos_update_admin"
    ON public.planilla_departamentos FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_departamentos ON public.planilla_departamentos;
CREATE TRIGGER tr_audit_planilla_departamentos
    AFTER INSERT OR UPDATE ON public.planilla_departamentos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- Backfill: cada departamento distinto ya usado por empleados existentes se registra en el
-- catálogo con un color asignado round-robin (mismo determinismo que el hash que reemplaza,
-- para no "barajar" colores ya vistos por los usuarios sin necesidad). No se engancha a
-- fn_on_tenant_created (un tenant nuevo arranca con el catálogo vacío y lo carga desde la UI,
-- mismo criterio que planilla_ubicaciones: son datos organizativos reales, no un catálogo
-- genérico con valores universales).
DO $$
DECLARE
    r RECORD;
    colores CONSTANT TEXT[] := ARRAY['blue', 'amber', 'primary', 'purple', 'pink', 'secondary', 'teal'];
    idx INTEGER;
BEGIN
    FOR r IN
        SELECT DISTINCT tenant_id, departamento,
               ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY departamento) AS rn
        FROM public.planilla_empleados
        WHERE departamento IS NOT NULL AND trim(departamento) <> ''
    LOOP
        idx := ((r.rn - 1) % array_length(colores, 1)) + 1;
        INSERT INTO public.planilla_departamentos (tenant_id, nombre, color_key)
        VALUES (r.tenant_id, trim(r.departamento), colores[idx])
        ON CONFLICT (tenant_id, nombre) DO NOTHING;
    END LOOP;
END $$;

COMMIT;
