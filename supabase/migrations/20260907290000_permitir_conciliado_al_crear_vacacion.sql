-- Migration: Permitir marcar "conciliado" al crear una vacación (IMPL-144, hallazgo UAT)
-- Author: @alexis
-- Description: `VacacionModal.tsx` muestra el toggle "Conciliado" tanto al crear como al editar,
--              pero `crear_vacacion` nunca aceptó ese parámetro — solo `actualizar_vacacion` lo
--              tiene. El cliente ya manda el valor a `crear()`, pero se pierde silenciosamente
--              porque la función no tiene dónde recibirlo: toda vacación nueva queda
--              `conciliado = false` sin importar lo que el usuario haya elegido en el formulario.
--
--              Se agrega `p_conciliado BOOLEAN DEFAULT false` al final de la firma (parámetro
--              nuevo con default, no rompe llamadas existentes) y se persiste en el INSERT. Se
--              re-crea la función completa porque Postgres no permite parchear un solo parámetro
--              de una función PL/pgSQL existente — mismo criterio de siempre en este proyecto.

BEGIN;

CREATE OR REPLACE FUNCTION public.crear_vacacion(
    p_quincena_id UUID,
    p_empleado_id UUID,
    p_fecha_inicio DATE,
    p_fecha_fin DATE,
    p_sueldo_mensual NUMERIC,
    p_no_gozada BOOLEAN,
    p_user_id UUID,
    p_conciliado BOOLEAN DEFAULT false
) RETURNS public.planilla_vacaciones
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.planilla_vacaciones;
    v_dias INT;
    v_sueldo_diario NUMERIC;
    v_monto_base NUMERIC;
    v_recargo_30 NUMERIC;
    v_solapada BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM public.planilla_vacaciones
        WHERE empleado_id = p_empleado_id AND fecha_inicio <= p_fecha_fin AND fecha_fin >= p_fecha_inicio
        UNION ALL
        SELECT 1 FROM public.planilla_incapacidades
        WHERE empleado_id = p_empleado_id AND fecha_inicio <= p_fecha_fin AND fecha_fin >= p_fecha_inicio
    ) INTO v_solapada;

    IF v_solapada THEN
        RAISE EXCEPTION 'Este empleado ya tiene una vacación o incapacidad registrada que se superpone con el rango % a %', p_fecha_inicio, p_fecha_fin;
    END IF;

    v_dias := (p_fecha_fin - p_fecha_inicio) + 1;
    v_sueldo_diario := ROUND(p_sueldo_mensual / 30, 2);
    v_monto_base := ROUND(v_sueldo_diario * v_dias, 2);
    v_recargo_30 := ROUND(v_monto_base * 0.30, 2);

    INSERT INTO public.planilla_vacaciones (
        tenant_id, quincena_id, empleado_id, fecha_inicio, fecha_fin, dias,
        sueldo_diario, monto_base, recargo_30, monto_total, no_gozada, conciliado, created_by
    ) VALUES (
        public.get_auth_tenant_id(), p_quincena_id, p_empleado_id, p_fecha_inicio, p_fecha_fin, v_dias,
        v_sueldo_diario, v_monto_base, v_recargo_30, v_monto_base + v_recargo_30, p_no_gozada, p_conciliado, p_user_id
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

COMMIT;
