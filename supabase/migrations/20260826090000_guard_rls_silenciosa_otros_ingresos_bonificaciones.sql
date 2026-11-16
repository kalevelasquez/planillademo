-- Migration: Guard explícito contra bloqueo silencioso de RLS (IMPL-104 / US-CIE-01 CA1)
-- Author: @alexis
-- Description: `actualizar_otro_ingreso` y `actualizar_bonificacion` corren INVOKER — si la
--              policy de UPDATE bloquea la fila (quincena 'aprobada_cerrada', desde
--              20260825090000), el UPDATE afecta 0 filas SIN lanzar excepción: `v_result`
--              queda con todos los campos NULL y la función retorna esa fila-fantasma como
--              si hubiera tenido éxito — el cliente nunca se entera. CA1 exige mostrar
--              "Esta quincena está cerrada y no permite modificaciones."; sin este guard
--              esa condición nunca se cumple, se "guarda" en silencio y no se guarda nada.

BEGIN;

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

    IF v_result.id IS NULL THEN
        RAISE EXCEPTION 'Esta quincena está cerrada y no permite modificaciones.';
    END IF;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.actualizar_bonificacion(
    p_id UUID,
    p_tipo_id UUID,
    p_monto NUMERIC,
    p_gravabilidad TEXT
) RETURNS public.planilla_bonificaciones
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.planilla_bonificaciones;
BEGIN
    UPDATE public.planilla_bonificaciones SET
        tipo_id = p_tipo_id,
        monto = p_monto,
        gravabilidad = p_gravabilidad,
        updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_result;

    IF v_result.id IS NULL THEN
        RAISE EXCEPTION 'Esta quincena está cerrada y no permite modificaciones.';
    END IF;

    RETURN v_result;
END;
$$;

COMMIT;
