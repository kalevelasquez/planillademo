-- Migration: calcular_planilla_quincena — bloquear sobre quincena cerrada
-- Author: @alexis
-- Description: Hallazgo real (2026-09-03), mismo patron que el fix ya aplicado a
--              recalcular_renta_semestral (20260907240000): `calcular_planilla_empleado` SI
--              exige `estado = 'en_proceso'` desde su creacion (20260819090000), pero el
--              wrapper que lo llama por cada empleado, `calcular_planilla_quincena`, nunca
--              chequeaba el estado de la quincena ANTES de arrancar el loop. En la practica
--              esto no corrompia datos (cada llamada a calcular_planilla_empleado igual
--              fallaba con su propia excepcion), pero el loop atrapa esa excepcion por
--              empleado (`EXCEPTION WHEN OTHERS THEN RAISE WARNING`) y sigue — el resultado es
--              un SETOF vacio sin ningun error visible, indistinguible en la UI de "no hay
--              nada que calcular". El boton "Calcular Planilla" en el frontend tampoco se
--              deshabilitaba por esto, solo por anticipos/descuentos pendientes.
--
--              Fix: mismo guard explicito que ya usa calcular_planilla_empleado y
--              recalcular_renta_semestral, agregado ANTES del chequeo de pendientes. El guard
--              cliente (CalculoPlanillaView.tsx, handleCalcular + disabled del boton) ya corta
--              el flujo antes de llamar al RPC — este chequeo es defensa en profundidad.

BEGIN;

CREATE OR REPLACE FUNCTION public.calcular_planilla_quincena(
    p_quincena_id UUID,
    p_user_id UUID
) RETURNS SETOF public.planilla_calculo_empleado
LANGUAGE plpgsql
AS $$
DECLARE
    v_empleado RECORD;
    v_row public.planilla_calculo_empleado;
    v_pendientes RECORD;
    v_quincena public.quincenas;
BEGIN
    SELECT * INTO v_quincena FROM public.quincenas WHERE id = p_quincena_id;

    IF v_quincena.estado != 'en_proceso' THEN
        RAISE EXCEPTION 'No se puede calcular planilla: la quincena % no está en_proceso', p_quincena_id;
    END IF;

    SELECT * INTO v_pendientes FROM public.contar_anticipos_descuentos_pendientes(p_quincena_id);

    IF v_pendientes.anticipos_pendientes > 0 OR v_pendientes.descuentos_pendientes > 0 THEN
        RAISE EXCEPTION 'Hay % anticipo(s) y % descuento(s) sin procesar para esta quincena — procesalos en sus pantallas antes de calcular la planilla.',
            v_pendientes.anticipos_pendientes, v_pendientes.descuentos_pendientes;
    END IF;

    FOR v_empleado IN
        SELECT pe.id FROM public.planilla_empleados pe
        JOIN public.quincenas q ON q.tenant_id = pe.tenant_id
        WHERE q.id = p_quincena_id AND pe.tenant_id = public.get_auth_tenant_id()
          AND pe.deleted_at IS NULL
          AND (
              pe.estado = 'activo'
              OR (pe.estado = 'inactivo' AND pe.fecha_baja IS NOT NULL AND pe.fecha_baja >= q.fecha_inicio)
              OR EXISTS (
                  SELECT 1 FROM public.planilla_horas_extras_manual hem
                  WHERE hem.quincena_id = p_quincena_id AND hem.empleado_id = pe.id
              )
          )
    LOOP
        BEGIN
            v_row := public.calcular_planilla_empleado(p_quincena_id, v_empleado.id, p_user_id);
            RETURN NEXT v_row;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'calcular_planilla_quincena: no se pudo calcular el empleado % — %', v_empleado.id, SQLERRM;
        END;
    END LOOP;

    RETURN;
END;
$$;

COMMIT;
