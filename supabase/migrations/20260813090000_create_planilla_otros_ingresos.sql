-- Migration: Otros Ingresos — Registro con Tratamiento Fiscal de 3 Estados (IMPL-71 / US-OTR-01, IMPL-78)
-- Author: @alexis
-- Description: `planilla_otros_ingresos` es una tabla simple con `quincena_id` FK directo (sin
--              cabecera+eventos — no hay cuotas ni periodicidad en ninguna CA de esta épica),
--              mismo molde que Horas Extras/Viáticos.
--
--              `gravabilidad` reemplaza el toggle binario anterior por 3 estados: 'gravable' |
--              'no_gravable' | 'bono_10' (CA2). Precarga desde `concepto.gravabilidad_default`
--              pero es editable al registrar (CA2 de US-OTR-00) — por eso NO hay FK "computada",
--              el cliente manda el valor elegido y el server solo lo valida contra el CHECK.
--
--              CA3 de este ticket sugiere que Vacaciones (no_gozada) e Incapacidades (trabajo_
--              durante_incapacidad) deberían registrar su Bono 10% acá — deliberadamente NO se
--              retrofit-ean esas dos épicas ya shippeadas (mismo criterio que la no-unificación
--              del catálogo de Descuentos con Bonificaciones). Documentado como gap: IMPL-85
--              (Motor de Cálculo) deberá agregar el Bono 10% desde TRES tablas distintas.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_otros_ingresos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    quincena_id UUID NOT NULL REFERENCES public.quincenas(id),
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id),
    concepto_id UUID NOT NULL REFERENCES public.planilla_otros_ingresos_conceptos(id),
    monto NUMERIC NOT NULL CHECK (monto > 0),
    gravabilidad TEXT NOT NULL CHECK (gravabilidad IN ('gravable', 'no_gravable', 'bono_10')),
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planilla_otros_ingresos_empleado ON public.planilla_otros_ingresos(empleado_id);
CREATE INDEX IF NOT EXISTS idx_planilla_otros_ingresos_quincena ON public.planilla_otros_ingresos(quincena_id);

ALTER TABLE public.planilla_otros_ingresos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_otros_ingresos_select_tenant"
    ON public.planilla_otros_ingresos FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_otros_ingresos_insert_rol"
    ON public.planilla_otros_ingresos FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_otros_ingresos_update_rol"
    ON public.planilla_otros_ingresos FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_otros_ingresos_delete_rol"
    ON public.planilla_otros_ingresos FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_otros_ingresos ON public.planilla_otros_ingresos;
CREATE TRIGGER tr_audit_planilla_otros_ingresos
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_otros_ingresos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- Sin SECURITY DEFINER (mismo criterio que crear_descuento/crear_vacacion): corre como INVOKER,
-- la policy de INSERT de arriba es la que autoriza.
CREATE OR REPLACE FUNCTION public.crear_otro_ingreso(
    p_quincena_id UUID,
    p_empleado_id UUID,
    p_concepto_id UUID,
    p_monto NUMERIC,
    p_gravabilidad TEXT,
    p_user_id UUID
) RETURNS public.planilla_otros_ingresos
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.planilla_otros_ingresos;
BEGIN
    INSERT INTO public.planilla_otros_ingresos (
        tenant_id, quincena_id, empleado_id, concepto_id, monto, gravabilidad, created_by
    ) VALUES (
        public.get_auth_tenant_id(), p_quincena_id, p_empleado_id, p_concepto_id, p_monto, p_gravabilidad, p_user_id
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

-- Sin SECURITY DEFINER: RPC de edición simétrica a crear_otro_ingreso (US-OTR-02 / IMPL-79).
CREATE OR REPLACE FUNCTION public.actualizar_otro_ingreso(
    p_id UUID,
    p_empleado_id UUID,
    p_concepto_id UUID,
    p_monto NUMERIC,
    p_gravabilidad TEXT
) RETURNS public.planilla_otros_ingresos
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.planilla_otros_ingresos;
BEGIN
    UPDATE public.planilla_otros_ingresos SET
        empleado_id = p_empleado_id,
        concepto_id = p_concepto_id,
        monto = p_monto,
        gravabilidad = p_gravabilidad,
        updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

COMMIT;
