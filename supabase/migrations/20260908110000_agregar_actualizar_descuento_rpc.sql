-- Migration: RPC para editar un descuento existente (US-DESC-01 / IMPL-58 CA4)
-- Author: @alexis
-- Description: CA4 pide "Botón + Agregar; edición y switch Activo/Pausado por fila" en el tab
--              Descuentos del perfil del empleado. `crear_descuento` (20260805090000) y el
--              toggle de pausado ya existían, pero no había ninguna forma de corregir
--              categoría/institución/monto de un registro ya creado — bug real encontrado en
--              revisión de UAT (IMPL-58 CA4), no un gap de alcance.
--
--              Mismo criterio que `crear_descuento`: sin SECURITY DEFINER (corre como INVOKER,
--              autoriza la policy `planilla_descuentos_update_rol` ya existente), y
--              monto_quincenal se recalcula server-side cuando hay monto_total+numero_cuotas
--              (single source of truth, no lo decide el cliente).
--
--              Sin chequeo adicional de `estado`: el CHECK ya existente
--              `monto_total IS NULL OR monto_pagado <= monto_total` es quien impide bajar el
--              total por debajo de lo ya pagado — el cliente debe traducir esa violación a un
--              mensaje legible, no se duplica la validación acá.

BEGIN;

CREATE OR REPLACE FUNCTION public.actualizar_descuento(
    p_descuento_id UUID,
    p_categoria_id UUID,
    p_institucion TEXT,
    p_monto_quincenal NUMERIC,
    p_monto_total NUMERIC,
    p_numero_cuotas INT
) RETURNS public.planilla_descuentos
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.planilla_descuentos;
    v_monto_quincenal NUMERIC;
BEGIN
    v_monto_quincenal := CASE
        WHEN p_monto_total IS NOT NULL AND p_numero_cuotas IS NOT NULL
            THEN ROUND(p_monto_total / p_numero_cuotas, 2)
        ELSE p_monto_quincenal
    END;

    UPDATE public.planilla_descuentos
    SET categoria_id = p_categoria_id,
        institucion = p_institucion,
        monto_quincenal = v_monto_quincenal,
        monto_total = p_monto_total,
        numero_cuotas = p_numero_cuotas,
        updated_at = now()
    WHERE id = p_descuento_id
    RETURNING * INTO v_result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Descuento no encontrado.';
    END IF;

    RETURN v_result;
END;
$$;

COMMIT;
