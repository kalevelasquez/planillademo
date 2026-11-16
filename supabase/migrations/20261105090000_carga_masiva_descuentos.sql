-- Migration: Carga masiva de Descuentos desde Excel (clon del patrón de Carga Masiva de Empleados)
-- Author: @alexis
-- Description: Imporfrut necesita cargar muchos descuentos de una sola vez (ej. tras migrar desde
--              otro sistema) en vez de uno por uno desde el formulario individual. A diferencia de
--              `confirmar_importacion_empleados` (20260928100000), que inserta directo porque
--              Empleados no tiene reglas de negocio no-triviales al dar de alta, Descuentos SÍ las
--              tiene (recalculo de monto_quincenal con cuota exacta, la regla especial de
--              "Préstamo bancario", validación de saldo inicial) y ya viven en `crear_descuento`
--              (ver 20261015130000). Para no duplicar esa lógica acá (mismo riesgo de divergencia
--              "mirror TS vs SQL real" ya documentado en el proyecto), este RPC simplemente LLAMA
--              a `crear_descuento` una vez por fila dentro de la misma transacción — mismo criterio
--              de "todo o nada" que `confirmar_importacion_empleados`: si una fila choca server-side
--              (ej. el RPC real detecta algo que el cliente no pre-validó), TODO el lote revierte.
--
--              Sin SECURITY DEFINER: corre como INVOKER, exactamente como `crear_descuento` — el
--              chequeo de rol de abajo es solo para devolver un mensaje de negocio legible antes de
--              iterar, la policy de INSERT real de `planilla_descuentos` es la que autoriza cada
--              INSERT individual dentro del loop.

BEGIN;

CREATE OR REPLACE FUNCTION public.confirmar_importacion_descuentos(p_descuentos JSONB, p_user_id UUID)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_row JSONB;
    v_creados INT := 0;
BEGIN
    IF NOT ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles())) THEN
        RAISE EXCEPTION 'No tenés permiso para importar descuentos.';
    END IF;

    FOR v_row IN SELECT * FROM jsonb_array_elements(p_descuentos)
    LOOP
        PERFORM public.crear_descuento(
            (v_row->>'empleado_id')::UUID,
            (v_row->>'categoria_id')::UUID,
            NULLIF(v_row->>'institucion', ''),
            (v_row->>'monto_quincenal')::NUMERIC,
            (v_row->>'monto_total')::NUMERIC,
            (v_row->>'numero_cuotas')::INT,
            p_user_id,
            (v_row->>'fecha_fin')::DATE,
            (v_row->>'cuota_exacta')::NUMERIC,
            COALESCE((v_row->>'monto_pagado_inicial')::NUMERIC, 0),
            0
        );

        v_creados := v_creados + 1;
    END LOOP;

    RETURN v_creados;
END;
$$;

COMMIT;
