-- Migration: Carga Manual de Horas Extra (IMPL-20 / US-HEX-06)
-- Author: @alexis
-- Description: (1) Agrega `ubicacion_id` a `planilla_empleados` — no existía ningún vínculo
--              formal con el catálogo `planilla_ubicaciones` (solo `sucursal`, texto libre
--              heredado de la épica Empleados, sin relación). Aditivo, no se toca ni migra
--              `sucursal`. (2) Crea `planilla_horas_extras_manual` — a diferencia de
--              `planilla_marcaciones` (IMPL-23, insert-only), esta SÍ admite UPDATE porque
--              CA1 pide una tabla editable que se guarda con un botón ("Guardar
--              [ubicación]"), no una edición-en-memoria-hasta-un-solo-insert. El candado de
--              RLS es el mismo patrón por ubicación de la corrección de arquitectura
--              anterior (`quincena_modulo_ubicacion_estado`).

BEGIN;

ALTER TABLE public.planilla_empleados ADD COLUMN IF NOT EXISTS ubicacion_id UUID REFERENCES public.planilla_ubicaciones(id);

CREATE TABLE IF NOT EXISTS public.planilla_horas_extras_manual (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    quincena_id UUID NOT NULL REFERENCES public.quincenas(id) ON DELETE CASCADE,
    ubicacion_id UUID NOT NULL REFERENCES public.planilla_ubicaciones(id),
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id),
    hed NUMERIC NOT NULL DEFAULT 0 CHECK (hed >= 0),
    hen NUMERIC NOT NULL DEFAULT 0 CHECK (hen >= 0),
    nocturnidad NUMERIC NOT NULL DEFAULT 0 CHECK (nocturnidad >= 0),
    feriado NUMERIC NOT NULL DEFAULT 0 CHECK (feriado >= 0),
    monto_total NUMERIC NOT NULL DEFAULT 0,
    guardado_por UUID REFERENCES public.user_profiles(id),
    guardado_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,

    UNIQUE (quincena_id, ubicacion_id, empleado_id)
);

CREATE INDEX IF NOT EXISTS idx_planilla_horas_extras_manual_quincena ON public.planilla_horas_extras_manual(quincena_id);

ALTER TABLE public.planilla_horas_extras_manual ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_horas_extras_manual_select_tenant"
    ON public.planilla_horas_extras_manual FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_horas_extras_manual_insert_modulo_no_confirmado"
    ON public.planilla_horas_extras_manual FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND NOT EXISTS (
            SELECT 1 FROM public.quincena_modulo_ubicacion_estado qmue
            WHERE qmue.quincena_id = planilla_horas_extras_manual.quincena_id
              AND qmue.ubicacion_id = planilla_horas_extras_manual.ubicacion_id
              AND qmue.modulo = 'horas_extras'
              AND qmue.estado = 'completado'
        )
    );

CREATE POLICY "planilla_horas_extras_manual_update_modulo_no_confirmado"
    ON public.planilla_horas_extras_manual FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND NOT EXISTS (
            SELECT 1 FROM public.quincena_modulo_ubicacion_estado qmue
            WHERE qmue.quincena_id = planilla_horas_extras_manual.quincena_id
              AND qmue.ubicacion_id = planilla_horas_extras_manual.ubicacion_id
              AND qmue.modulo = 'horas_extras'
              AND qmue.estado = 'completado'
        )
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_horas_extras_manual_delete_modulo_no_confirmado"
    ON public.planilla_horas_extras_manual FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND NOT EXISTS (
            SELECT 1 FROM public.quincena_modulo_ubicacion_estado qmue
            WHERE qmue.quincena_id = planilla_horas_extras_manual.quincena_id
              AND qmue.ubicacion_id = planilla_horas_extras_manual.ubicacion_id
              AND qmue.modulo = 'horas_extras'
              AND qmue.estado = 'completado'
        )
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_horas_extras_manual ON public.planilla_horas_extras_manual;
CREATE TRIGGER tr_audit_planilla_horas_extras_manual
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_horas_extras_manual
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

COMMIT;
