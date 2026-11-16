-- Migration: Cálculo de Planilla — Vistas de Columnas Guardadas (IMPL-85 / US-CALC-06, IMPL-92)
-- Author: @alexis
-- Description: `planilla_calculo_vistas_guardadas` persiste combinaciones de columnas con nombre
--              propio (CA2, "guardar mi configuración actual"). Compartidas a nivel de tenant
--              (no aisladas por usuario) — mismo criterio de configuración compartida que
--              `planilla_tarifas_km_cargo`/`planilla_descuento_categorias`, el resto del proyecto
--              no tiene precedente de tablas de preferencia aisladas por usuario. Las 3 vistas
--              predefinidas (Contabilidad/RRHH/Completa, CA1/CA2) NO viven en esta tabla — son
--              constantes en el cliente (`CalculoPlanillaView.tsx`), mismo criterio que
--              `TIPO_QUINCENA_LABEL` (config fija de la app, no configurable por el usuario).

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_calculo_vistas_guardadas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    columnas TEXT[] NOT NULL,
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id, nombre)
);

ALTER TABLE public.planilla_calculo_vistas_guardadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_calculo_vistas_guardadas_select_tenant"
    ON public.planilla_calculo_vistas_guardadas FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_calculo_vistas_guardadas_insert_rol"
    ON public.planilla_calculo_vistas_guardadas FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_calculo_vistas_guardadas_delete_rol"
    ON public.planilla_calculo_vistas_guardadas FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_calculo_vistas_guardadas ON public.planilla_calculo_vistas_guardadas;
CREATE TRIGGER tr_audit_planilla_calculo_vistas_guardadas
    AFTER INSERT OR DELETE ON public.planilla_calculo_vistas_guardadas
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

COMMIT;
