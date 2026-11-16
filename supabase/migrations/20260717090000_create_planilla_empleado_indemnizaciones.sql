-- Migration: Historial de Indemnizaciones del Empleado (IMPL-5 / US-EMP-03)
-- Author: @alexis
-- Description: Tabla de relación uno-a-muchos con planilla_empleados (un empleado puede
--              tener varias indemnizaciones a lo largo del tiempo). Se agrega también un
--              RPC transaccional que inserta la indemnización Y reinicia fecha_ingreso del
--              empleado en la misma operación (CA2), para que no queden inconsistentes si
--              una de las dos escrituras fallara.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_empleado_indemnizaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    motivo TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planilla_indemnizaciones_empleado ON public.planilla_empleado_indemnizaciones(empleado_id, fecha DESC);

ALTER TABLE public.planilla_empleado_indemnizaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_indemnizaciones_select_tenant"
    ON public.planilla_empleado_indemnizaciones FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_indemnizaciones_write_roles"
    ON public.planilla_empleado_indemnizaciones FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND (
            'admin' = ANY(public.get_auth_roles())
            OR 'preparador_planilla' = ANY(public.get_auth_roles())
        )
    );

-- Sin UPDATE/DELETE — CA1/CA2 solo piden ver el historial y registrar altas nuevas,
-- una indemnización ya registrada no se edita ni se borra (es un hecho histórico).

DROP TRIGGER IF EXISTS tr_audit_planilla_empleado_indemnizaciones ON public.planilla_empleado_indemnizaciones;
CREATE TRIGGER tr_audit_planilla_empleado_indemnizaciones
    AFTER INSERT ON public.planilla_empleado_indemnizaciones
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- ============================================================
-- RPC transaccional: registrar indemnización + reiniciar fecha_ingreso
-- ============================================================
-- Sin SECURITY DEFINER a propósito: corre con los privilegios/RLS del usuario que llama,
-- para que sigan aplicando las mismas políticas de escritura que ya rigen ambas tablas
-- (solo admin/preparador_planilla pueden escribir en planilla_empleados e indemnizaciones).
CREATE OR REPLACE FUNCTION public.register_indemnizacion(
    p_empleado_id UUID,
    p_fecha DATE,
    p_motivo TEXT DEFAULT NULL
)
RETURNS public.planilla_empleado_indemnizaciones
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.planilla_empleado_indemnizaciones;
    v_tenant_id UUID := public.get_auth_tenant_id();
BEGIN
    INSERT INTO public.planilla_empleado_indemnizaciones (tenant_id, empleado_id, fecha, motivo)
    VALUES (v_tenant_id, p_empleado_id, p_fecha, p_motivo)
    RETURNING * INTO v_result;

    UPDATE public.planilla_empleados
    SET fecha_ingreso = p_fecha, updated_at = now()
    WHERE id = p_empleado_id AND tenant_id = v_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Empleado % no encontrado en el tenant actual', p_empleado_id;
    END IF;

    RETURN v_result;
END;
$$;

COMMIT;
