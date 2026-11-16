-- Migration: No silenciar una falla total en "Calcular Planilla de esta Quincena"
-- Author: @alexis
-- Description: Reporte UAT — el Preparador aprieta "Calcular" (quincena en_proceso, sin
--              anticipos/descuentos pendientes) y la tabla de Calcular Planilla queda vacía
--              sin ningún error visible, incluso buscando a un empleado puntual.
--
--              Causa raíz: `calcular_planilla_quincena` recorre los empleados candidatos y
--              atrapa la excepción de `calcular_planilla_empleado` INDIVIDUALMENTE por cada uno
--              (RAISE WARNING, invisible para el cliente vía RPC) — pensado para que un dato
--              corrupto de UN empleado no bloquee el cálculo de los demás. El problema es que
--              varias de esas excepciones dependen de la QUINCENA, no del empleado (ej. "No hay
--              configuración fiscal vigente para la fecha %" si no existe una fila de
--              `planilla_config_fiscal` vigente para `fecha_fin`) — fallan IGUAL para el 100% de
--              los empleados. Resultado: el RPC devuelve un SETOF vacío sin ningún error, el
--              cliente muestra un toast de "éxito" con 0 calculados, y la tabla queda vacía,
--              indistinguible de "no había nadie que calcular".
--
--              Fix mínimo: se mantiene la resiliencia por-empleado (un dato corrupto puntual no
--              debe tumbar a todos), pero si hubo candidatos y NINGUNO se pudo calcular, eso ya
--              no es "un empleado con datos malos" — es una falla de precondición a nivel
--              quincena, y debe frenar con una excepción clara (con el primer mensaje real de
--              Postgres) en vez de camuflarse como éxito vacío. Mismo criterio que ya usa el
--              guard de anticipos/descuentos pendientes (20260907270000): fallar fuerte con un
--              mensaje accionable, no calcular en silencio con datos incompletos.

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
    v_candidatos INT := 0;
    v_calculados INT := 0;
    v_primer_error TEXT;
BEGIN
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
        v_candidatos := v_candidatos + 1;
        BEGIN
            v_row := public.calcular_planilla_empleado(p_quincena_id, v_empleado.id, p_user_id);
            v_calculados := v_calculados + 1;
            RETURN NEXT v_row;
        EXCEPTION WHEN OTHERS THEN
            v_primer_error := COALESCE(v_primer_error, SQLERRM);
            RAISE WARNING 'calcular_planilla_quincena: no se pudo calcular el empleado % — %', v_empleado.id, SQLERRM;
        END;
    END LOOP;

    IF v_candidatos > 0 AND v_calculados = 0 THEN
        RAISE EXCEPTION 'No se pudo calcular ningún empleado (% candidatos) — %', v_candidatos, v_primer_error;
    END IF;

    RETURN;
END;
$$;

COMMIT;
