BEGIN;

-- Gap documentado (planilla-contexto.md, IMPL-74 CA3: "se paga en la 2ª quincena del mes"):
-- calcular_bonos_incentivo_quincena nunca validaba el tipo/fecha de la quincena recibida —
-- se le podía pasar una quincena_25, un aguinaldo, o la 1ra quincena de un mes normal, y el
-- bono automático se insertaba igual sin ningún error. Mismo patrón ya usado en el proyecto
-- para la restricción análoga del recálculo semestral de Renta (RAISE EXCEPTION explícito,
-- ver 20260821090000_create_calcular_aguinaldo_y_recalculo_renta.sql). "2ª quincena" se
-- deriva igual que en el cliente (quincenaUtils.detectarRangoQuincenal): tipo='normal' y
-- fecha_inicio cae el día 16 del mes.
CREATE OR REPLACE FUNCTION public.calcular_bonos_incentivo_quincena(
    p_quincena_id UUID,
    p_utilidad_neta NUMERIC,
    p_user_id UUID
) RETURNS SETOF public.planilla_bonificaciones
LANGUAGE plpgsql
AS $$
DECLARE
    v_quincena public.quincenas;
    v_tabla RECORD;
    v_rango RECORD;
    v_empleado RECORD;
    v_result public.planilla_bonificaciones;
BEGIN
    SELECT * INTO v_quincena FROM public.quincenas
    WHERE id = p_quincena_id AND tenant_id = public.get_auth_tenant_id();

    IF v_quincena.id IS NULL THEN
        RAISE EXCEPTION 'Quincena no encontrada.';
    END IF;

    IF v_quincena.tipo != 'normal' OR EXTRACT(DAY FROM v_quincena.fecha_inicio) != 16 THEN
        RAISE EXCEPTION 'El cálculo automático de bonos por incentivo solo aplica a la 2ª quincena de un mes normal (US-BON-02 CA3).';
    END IF;

    FOR v_tabla IN
        SELECT * FROM public.planilla_tablas_incentivos
        WHERE tenant_id = public.get_auth_tenant_id() AND activo = true
    LOOP
        SELECT * INTO v_rango
        FROM public.planilla_tablas_incentivos_rangos
        WHERE tabla_id = v_tabla.id
          AND desde <= p_utilidad_neta
          AND (hasta IS NULL OR hasta >= p_utilidad_neta)
        LIMIT 1;

        IF v_rango IS NULL THEN
            CONTINUE;
        END IF;

        FOR v_empleado IN
            SELECT id FROM public.planilla_empleados
            WHERE tenant_id = public.get_auth_tenant_id()
              AND estado = 'activo'
              AND deleted_at IS NULL
              AND (
                  (v_tabla.empleado_id IS NOT NULL AND id = v_tabla.empleado_id)
                  OR (v_tabla.grupo IS NOT NULL AND departamento = v_tabla.grupo)
              )
        LOOP
            INSERT INTO public.planilla_bonificaciones (
                tenant_id, quincena_id, empleado_id, monto, gravabilidad, origen,
                tabla_incentivo_id, utilidad_neta_mes, created_by
            ) VALUES (
                public.get_auth_tenant_id(), p_quincena_id, v_empleado.id, v_rango.bono, 'gravable', 'automatico',
                v_tabla.id, p_utilidad_neta, p_user_id
            )
            ON CONFLICT (tabla_incentivo_id, empleado_id, quincena_id) WHERE origen = 'automatico'
            DO UPDATE SET monto = v_rango.bono, utilidad_neta_mes = p_utilidad_neta, updated_at = now()
            RETURNING * INTO v_result;

            RETURN NEXT v_result;
        END LOOP;
    END LOOP;

    RETURN;
END;
$$;

COMMIT;
