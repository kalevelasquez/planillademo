-- Migration: Bloquear "Calcular Planilla" si hay Anticipos/Descuentos sin "Procesar Cuotas"
-- Author: @alexis
-- Description: Anticipos y Descuentos usan eventos perezosos — nada se descuenta solo, hace
--              falta que el Preparador apriete "Procesar Cuotas de esta Quincena" en cada
--              pantalla para que se cree el evento (`planilla_anticipo_pagos`/
--              `planilla_descuento_eventos`) que el motor de cálculo lee. `calcular_planilla_
--              empleado` SOLO cuenta como deducido lo que ya tiene un evento para esa quincena —
--              si el Preparador calcula la planilla ANTES de procesar cuotas, la planilla sale
--              calculada con $0 descontado en anticipos/descuentos pendientes, sin ningún error.
--
--              Se evaluó automatizar "Procesar Cuotas" como parte de "Calcular Planilla", pero
--              eso rompería "Suspender esta quincena" (US-ANT-04/US-DESC-02): esa acción solo
--              está disponible mientras NO exista un evento para el anticipo/descuento en esa
--              quincena — si el cálculo dispara el procesamiento automáticamente, ya no habría
--              ventana para que el Preparador decida suspender un cobro puntual antes de que se
--              aplique. El usuario confirmó que Suspender sí se usa — se descartó automatizar.
--
--              En su lugar: `contar_anticipos_descuentos_pendientes` (nueva, de solo lectura,
--              mismo criterio EXACTO que usan `procesar_cuotas_anticipos_quincena`/
--              `procesar_cuotas_descuentos_quincena` para decidir qué les falta procesar) permite
--              al cliente mostrar una advertencia ANTES de intentar calcular. `calcular_planilla_
--              quincena` además la usa como guard server-side (defensa en profundidad, mismo
--              patrón ya usado para `reabierta_at`/quincena cerrada en pasadas anteriores) —
--              bloquea con una excepción clara en vez de calcular en silencio con datos
--              incompletos.

BEGIN;

CREATE OR REPLACE FUNCTION public.contar_anticipos_descuentos_pendientes(p_quincena_id UUID)
RETURNS TABLE(anticipos_pendientes INT, descuentos_pendientes INT)
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
BEGIN
    RETURN QUERY
    SELECT
        (
            SELECT COUNT(*)::INT
            FROM public.planilla_anticipos a
            WHERE a.tenant_id = v_tenant_id
              AND a.estado = 'activo'
              AND NOT EXISTS (
                  SELECT 1 FROM public.planilla_anticipo_pagos p
                  WHERE p.anticipo_id = a.id AND p.quincena_id = p_quincena_id
              )
        ),
        (
            SELECT COUNT(*)::INT
            FROM public.planilla_descuentos d
            JOIN public.planilla_descuento_categorias c ON c.id = d.categoria_id
            WHERE d.tenant_id = v_tenant_id
              AND d.estado = 'activo'
              AND d.monto_total IS NOT NULL
              AND NOT (c.tipo = 'fijo' AND d.validado_at IS NULL)
              AND NOT EXISTS (
                  SELECT 1 FROM public.planilla_descuento_eventos e
                  WHERE e.descuento_id = d.id AND e.quincena_id = p_quincena_id
              )
        );
END;
$$;

-- Bugfix (defensa en profundidad): antes calculaba con datos incompletos en silencio si el
-- Preparador olvidaba procesar cuotas de Anticipos/Descuentos primero. Único cambio real sobre
-- la versión anterior: el chequeo agregado ANTES del loop por empleado.
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
