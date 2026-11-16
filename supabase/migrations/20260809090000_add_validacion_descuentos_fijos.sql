-- Migration: Descuentos — validación antes de aplicar un fijo por primera vez
-- (IMPL-56 / US-DESC-05, IMPL-62)
-- Author: @alexis
-- Description: `validado_at` ya existía en `planilla_descuentos` desde IMPL-58 (reservada, sin
--              uso real todavía). Esta historia la activa: `procesar_cuotas_descuentos_quincena`
--              ahora EXCLUYE descuentos Fijos con `validado_at IS NULL` — el Preparador debe
--              validar el registro (una sola vez, cualquier quincena, vía
--              `descuentosService.validar`) antes de que se incluya en el primer procesamiento.
--              Una vez validado, `validado_at` queda fijo para siempre — no hay que re-chequear
--              el historial de eventos, un timestamp de "ya se revisó al menos una vez" alcanza
--              para cumplir CA1 ("antes de aplicarse por primera vez").
--
--              Solo aplica a Fijos (CA1 lo dice explícitamente en el título de la historia) —
--              los Variables no requieren esta validación previa.

BEGIN;

CREATE OR REPLACE FUNCTION public.procesar_cuotas_descuentos_quincena(
    p_quincena_id UUID,
    p_user_id UUID
) RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_descuento RECORD;
    v_monto NUMERIC;
    v_nuevo_monto_pagado NUMERIC;
    v_procesados INT := 0;
BEGIN
    FOR v_descuento IN
        SELECT d.* FROM public.planilla_descuentos d
        JOIN public.planilla_descuento_categorias c ON c.id = d.categoria_id
        WHERE d.tenant_id = v_tenant_id
          AND d.estado = 'activo'
          AND d.monto_total IS NOT NULL
          AND NOT (c.tipo = 'fijo' AND d.validado_at IS NULL) -- US-DESC-05 CA1
          AND NOT EXISTS (
              SELECT 1 FROM public.planilla_descuento_eventos e
              WHERE e.descuento_id = d.id AND e.quincena_id = p_quincena_id
          )
        FOR UPDATE OF d
    LOOP
        v_monto := LEAST(v_descuento.monto_quincenal, v_descuento.monto_total - v_descuento.monto_pagado);

        INSERT INTO public.planilla_descuento_eventos (tenant_id, descuento_id, quincena_id, tipo, monto, registrado_por)
        VALUES (v_tenant_id, v_descuento.id, p_quincena_id, 'pago', v_monto, p_user_id);

        v_nuevo_monto_pagado := v_descuento.monto_pagado + v_monto;

        UPDATE public.planilla_descuentos
        SET monto_pagado = v_nuevo_monto_pagado,
            cuotas_pagadas = v_descuento.cuotas_pagadas + 1,
            estado = CASE WHEN v_nuevo_monto_pagado >= v_descuento.monto_total THEN 'completado' ELSE 'activo' END,
            updated_at = now()
        WHERE id = v_descuento.id;

        v_procesados := v_procesados + 1;
    END LOOP;

    RETURN v_procesados;
END;
$$;

COMMIT;
