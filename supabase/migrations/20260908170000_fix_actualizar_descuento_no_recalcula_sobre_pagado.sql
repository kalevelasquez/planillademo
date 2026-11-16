-- Migration: actualizar_descuento no debe recalcular la cuota sobre el total bruto cuando ya
-- hay cuotas pagadas (defecto UAT IMPL-152, 2026-09-02)
-- Author: @alexis
-- Description: `actualizar_descuento` (20260908110000) siempre calculaba
--              `monto_quincenal = ROUND(monto_total / numero_cuotas, 2)` con los valores tal
--              cual se re-tecleaban en el formulario de edición, sin leer nunca `monto_pagado`
--              ni `cuotas_pagadas` de la fila. Caso real: un descuento se creó con datos mal
--              tecleados (cuota resultante $12.50), se procesó una cuota con ese monto erróneo
--              (evento inmutable ya guardado en planilla_descuento_eventos), y al corregir
--              después el descuento a $1,200/10 cuotas, la cuota FUTURA se recalculó bien
--              ($120.00) pero el evento viejo de $12.50 quedó contaminando el historial y
--              `monto_pagado` para siempre.
--
--              Mismo criterio ya usado en Anticipos (`recalcular_cuotas_anticipo`,
--              20260804090000): lo ya pagado es historial inmutable — un recálculo debe aplicar
--              sobre el SALDO PENDIENTE y las CUOTAS RESTANTES, no sobre el total/cuotas brutos,
--              en cuanto `cuotas_pagadas > 0`.

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
    v_descuento public.planilla_descuentos;
    v_result public.planilla_descuentos;
    v_monto_quincenal NUMERIC;
BEGIN
    SELECT * INTO v_descuento FROM public.planilla_descuentos WHERE id = p_descuento_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Descuento no encontrado.';
    END IF;

    v_monto_quincenal := CASE
        WHEN p_monto_total IS NOT NULL AND p_numero_cuotas IS NOT NULL THEN
            CASE WHEN v_descuento.cuotas_pagadas > 0 THEN
                ROUND(
                    (p_monto_total - v_descuento.monto_pagado)
                    / GREATEST(p_numero_cuotas - v_descuento.cuotas_pagadas, 1),
                    2
                )
            ELSE
                ROUND(p_monto_total / p_numero_cuotas, 2)
            END
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

    RETURN v_result;
END;
$$;

COMMIT;
