-- Migration: Catálogo real de Cargos (IMPL-133, Observación General UAT)
-- Author: @alexis
-- Description: `planilla_empleados.cargo` era texto libre sin catálogo — mismo gap que
--              Departamento (IMPL-2 / planilla_departamentos), resuelto con el mismo patrón:
--              catálogo real administrable, pero `planilla_empleados.cargo` SIGUE siendo TEXT
--              (no se agrega FK). El resto del proyecto (Tarifas por KM, Jornadas por
--              Cargo/Departamento, historial de cambios) ya lee `cargo` como texto libre;
--              agregar una FK obligaría a tocar esos consumidores sin beneficio real (mismo
--              razonamiento que la migración de planilla_departamentos). El catálogo da a los
--              formularios de captura un select en vez de texto libre, curando los valores
--              válidos hacia adelante.
--
--              Sin política DELETE (mismo patrón que planilla_departamentos/planilla_ubicaciones):
--              un cargo ya usado no se borra, se desactiva (estado='inactivo').
--
--              INSERT permitido también a 'preparador_planilla' (no solo 'admin', a diferencia
--              de planilla_departamentos): el ticket exige alta rápida del cargo "sin tener que
--              ir hasta Configuración" directamente desde el perfil del empleado, y ese
--              formulario lo edita preparador_planilla además de admin (Configuración en sí
--              sigue siendo ruta admin-only, así que UPDATE/desactivar queda admin-only).

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_cargos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id, nombre)
);

ALTER TABLE public.planilla_cargos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_cargos_select_tenant"
    ON public.planilla_cargos FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_cargos_insert_admin_o_preparador"
    ON public.planilla_cargos FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_cargos_update_admin"
    ON public.planilla_cargos FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_cargos ON public.planilla_cargos;
CREATE TRIGGER tr_audit_planilla_cargos
    AFTER INSERT OR UPDATE ON public.planilla_cargos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- Backfill: todo cargo distinto ya usado hoy en cualquiera de los 3 lugares que lo capturan
-- como texto libre (perfil de empleado, tarifas por KM, jornadas por cargo) se registra en el
-- catálogo, para que ningún valor existente quede huérfano al pasar a select. No se engancha a
-- fn_on_tenant_created (mismo criterio que planilla_departamentos/planilla_ubicaciones): un
-- tenant nuevo arranca con el catálogo vacío y lo carga desde la UI.
INSERT INTO public.planilla_cargos (tenant_id, nombre)
SELECT DISTINCT tenant_id, trim(nombre) FROM (
    SELECT tenant_id, cargo AS nombre FROM public.planilla_empleados WHERE cargo IS NOT NULL AND trim(cargo) <> ''
    UNION
    SELECT tenant_id, cargo AS nombre FROM public.planilla_tarifas_km_cargo WHERE cargo IS NOT NULL AND trim(cargo) <> ''
    UNION
    SELECT tenant_id, valor AS nombre FROM public.planilla_jornadas_cargo WHERE aplica_a = 'cargo' AND valor IS NOT NULL AND trim(valor) <> ''
) AS valores
ON CONFLICT (tenant_id, nombre) DO NOTHING;

COMMIT;
