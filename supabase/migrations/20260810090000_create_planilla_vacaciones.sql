-- Migration: Vacaciones — registro con cálculo de pago (IMPL-63 / US-VAC-01/02, IMPL-65/66)
-- Author: @alexis
-- Description: `sueldo_diario`, `monto_base`, `recargo_30` y `monto_total` se calculan
--              SERVER-SIDE (RPCs `crear_vacacion`/`actualizar_vacacion`) y se persisten como
--              snapshot — mismo criterio que horas extras/viáticos/anticipos: si la regla de
--              negocio cambia en el futuro, los registros ya emitidos no se reinterpretan.
--
--              El recargo 30% (Art. 177 CT) se calcula y persiste AQUÍ (monto correcto, según
--              CA2), pero CUÁNDO se aplica realmente en una planilla (la 2ª quincena del mes de
--              aniversario de fecha_ingreso, CA3 — que puede no ser la quincena en la que se
--              registra el descanso) queda diferido al Motor de Cálculo de Planilla (IMPL-85):
--              no existe ningún mecanismo en el proyecto para proyectar hacia una quincena
--              futura que todavía no existe como fila (mismo principio ya establecido en
--              Anticipos/IMPL-52) — IMPL-85 deberá leer estos registros y, en el momento en que
--              la quincena de aniversario correspondiente exista, aplicar el recargo. Mismo
--              patrón de "captura real ahora, consumo diferido" ya usado para Bono 10%
--              (Incapacidades/IMPL-46) y Retención 10% (Viáticos/IMPL-38).
--
--              `quincena_id` es la quincena en la que se REGISTRA el descanso (CA4: los días se
--              incluyen como días laborados en esa quincena) — no la quincena del recargo.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_vacaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    quincena_id UUID NOT NULL REFERENCES public.quincenas(id) ON DELETE CASCADE,
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id),
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL CHECK (fecha_fin >= fecha_inicio),
    dias INT NOT NULL CHECK (dias > 0),
    sueldo_diario NUMERIC NOT NULL CHECK (sueldo_diario > 0),
    monto_base NUMERIC NOT NULL CHECK (monto_base > 0),
    recargo_30 NUMERIC NOT NULL CHECK (recargo_30 >= 0),
    monto_total NUMERIC NOT NULL CHECK (monto_total > 0),
    conciliado BOOLEAN NOT NULL DEFAULT false,
    no_gozada BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planilla_vacaciones_quincena ON public.planilla_vacaciones(quincena_id);
CREATE INDEX IF NOT EXISTS idx_planilla_vacaciones_empleado ON public.planilla_vacaciones(empleado_id);

ALTER TABLE public.planilla_vacaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_vacaciones_select_tenant"
    ON public.planilla_vacaciones FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_vacaciones_insert_quincena_en_proceso"
    ON public.planilla_vacaciones FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

CREATE POLICY "planilla_vacaciones_update_quincena_en_proceso"
    ON public.planilla_vacaciones FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_vacaciones_delete_quincena_en_proceso"
    ON public.planilla_vacaciones FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_vacaciones ON public.planilla_vacaciones;
CREATE TRIGGER tr_audit_planilla_vacaciones
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_vacaciones
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- Sin SECURITY DEFINER (mismo criterio que crear_anticipo/crear_descuento): corre como
-- INVOKER, la policy de INSERT es la que autoriza. sueldo_diario/monto_base/recargo_30/
-- monto_total se calculan acá, nunca se confía en lo que mande el cliente.
CREATE OR REPLACE FUNCTION public.crear_vacacion(
    p_quincena_id UUID,
    p_empleado_id UUID,
    p_fecha_inicio DATE,
    p_fecha_fin DATE,
    p_sueldo_mensual NUMERIC,
    p_no_gozada BOOLEAN,
    p_user_id UUID
) RETURNS public.planilla_vacaciones
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.planilla_vacaciones;
    v_dias INT;
    v_sueldo_diario NUMERIC;
    v_monto_base NUMERIC;
    v_recargo_30 NUMERIC;
BEGIN
    v_dias := (p_fecha_fin - p_fecha_inicio) + 1;
    v_sueldo_diario := ROUND(p_sueldo_mensual / 30, 2);
    v_monto_base := ROUND(v_sueldo_diario * v_dias, 2);
    v_recargo_30 := ROUND(v_monto_base * 0.30, 2);

    INSERT INTO public.planilla_vacaciones (
        tenant_id, quincena_id, empleado_id, fecha_inicio, fecha_fin, dias,
        sueldo_diario, monto_base, recargo_30, monto_total, no_gozada, created_by
    ) VALUES (
        public.get_auth_tenant_id(), p_quincena_id, p_empleado_id, p_fecha_inicio, p_fecha_fin, v_dias,
        v_sueldo_diario, v_monto_base, v_recargo_30, v_monto_base + v_recargo_30, p_no_gozada, p_user_id
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

-- US-VAC-02 (IMPL-66) CA1: edición completa recalcula días y montos en vivo, igual criterio
-- que Incapacidades — el recálculo siempre parte del estado actual del formulario, no preserva
-- los montos viejos.
CREATE OR REPLACE FUNCTION public.actualizar_vacacion(
    p_id UUID,
    p_empleado_id UUID,
    p_fecha_inicio DATE,
    p_fecha_fin DATE,
    p_sueldo_mensual NUMERIC,
    p_no_gozada BOOLEAN,
    p_conciliado BOOLEAN
) RETURNS public.planilla_vacaciones
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.planilla_vacaciones;
    v_dias INT;
    v_sueldo_diario NUMERIC;
    v_monto_base NUMERIC;
    v_recargo_30 NUMERIC;
BEGIN
    v_dias := (p_fecha_fin - p_fecha_inicio) + 1;
    v_sueldo_diario := ROUND(p_sueldo_mensual / 30, 2);
    v_monto_base := ROUND(v_sueldo_diario * v_dias, 2);
    v_recargo_30 := ROUND(v_monto_base * 0.30, 2);

    UPDATE public.planilla_vacaciones
    SET empleado_id = p_empleado_id,
        fecha_inicio = p_fecha_inicio,
        fecha_fin = p_fecha_fin,
        dias = v_dias,
        sueldo_diario = v_sueldo_diario,
        monto_base = v_monto_base,
        recargo_30 = v_recargo_30,
        monto_total = v_monto_base + v_recargo_30,
        no_gozada = p_no_gozada,
        conciliado = p_conciliado,
        updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registro de vacaciones % no encontrado', p_id;
    END IF;

    RETURN v_result;
END;
$$;

COMMIT;
