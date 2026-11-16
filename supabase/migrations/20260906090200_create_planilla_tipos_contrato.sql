-- Migration: Catálogo real de Tipos de Contrato (revisión historia por historia, IMPL-3 gap #5)
-- Author: @alexis
-- Description: `planilla_empleados.tipo_contrato` era texto libre — el DRN no define una lista
--              cerrada (indefinido/definido/eventual/etc.), pero el cliente decidió, en esta
--              revisión, curar los valores hacia adelante con un catálogo administrable (mismo
--              patrón y mismos motivos que `planilla_departamentos`, IMPL-2 gap #2).
--
--              Sin columna de color (a diferencia de Departamentos): tipo_contrato no tiene
--              badge visual en ninguna vista, solo aparece como texto en el perfil del empleado.
--              Sin política DELETE (mismo patrón que los demás catálogos): se desactiva, no se
--              borra. `planilla_empleados.tipo_contrato` sigue siendo TEXT sin FK, por el mismo
--              motivo que Departamento: ningún consumidor necesita una relación real.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_tipos_contrato (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id, nombre)
);

ALTER TABLE public.planilla_tipos_contrato ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_tipos_contrato_select_tenant"
    ON public.planilla_tipos_contrato FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_tipos_contrato_insert_admin"
    ON public.planilla_tipos_contrato FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_tipos_contrato_update_admin"
    ON public.planilla_tipos_contrato FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_tipos_contrato ON public.planilla_tipos_contrato;
CREATE TRIGGER tr_audit_planilla_tipos_contrato
    AFTER INSERT OR UPDATE ON public.planilla_tipos_contrato
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- Backfill: cada tipo_contrato distinto ya usado por empleados existentes se registra en el
-- catálogo. Sin enganchar a fn_on_tenant_created (mismo criterio que Departamentos/Ubicaciones):
-- un tenant nuevo arranca vacío y lo carga desde la UI.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT DISTINCT tenant_id, tipo_contrato
        FROM public.planilla_empleados
        WHERE tipo_contrato IS NOT NULL AND trim(tipo_contrato) <> ''
    LOOP
        INSERT INTO public.planilla_tipos_contrato (tenant_id, nombre)
        VALUES (r.tenant_id, trim(r.tipo_contrato))
        ON CONFLICT (tenant_id, nombre) DO NOTHING;
    END LOOP;
END $$;

COMMIT;
