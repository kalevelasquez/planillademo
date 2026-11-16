-- Migration: Descuentos — ciclo de descuento + finalización automática (IMPL-56 / US-DESC-04, IMPL-61)
-- Author: @alexis
-- Description: `procesar_cuotas_descuentos_quincena` es el análogo exacto de
--              `procesar_cuotas_anticipos_quincena` — misma interpretación de "automático" sin
--              que exista el motor de Cálculo de Planilla (IMPL-85): un botón en bloque que el
--              Preparador corre por quincena, en vez de un trigger real del sistema.
--
--              CA2: la finalización automática SOLO aplica a descuentos con monto_total definido
--              — los indefinidos (monto_total IS NULL) se excluyen del filtro `WHERE monto_total
--              IS NOT NULL`, siguen incurriendo monto_quincenal para siempre hasta que se pausen
--              manualmente (US-DESC-01 CA4), nunca pasan a 'completado'.

BEGIN;

-- Sin SECURITY DEFINER (mismo criterio que procesar_cuotas_anticipos_quincena): corre como
-- INVOKER, las policies de INSERT/UPDATE ya definidas son las que autorizan cada operación.
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
        WHERE d.tenant_id = v_tenant_id
          AND d.estado = 'activo'
          AND d.monto_total IS NOT NULL -- CA2: indefinidos nunca finalizan, se excluyen acá
          AND NOT EXISTS (
              SELECT 1 FROM public.planilla_descuento_eventos e
              WHERE e.descuento_id = d.id AND e.quincena_id = p_quincena_id
          )
        FOR UPDATE
    LOOP
        v_monto := LEAST(v_descuento.monto_quincenal, v_descuento.monto_total - v_descuento.monto_pagado);

        INSERT INTO public.planilla_descuento_eventos (tenant_id, descuento_id, quincena_id, tipo, monto, registrado_por)
        VALUES (v_tenant_id, v_descuento.id, p_quincena_id, 'pago', v_monto, p_user_id);

        v_nuevo_monto_pagado := v_descuento.monto_pagado + v_monto;

        -- CA1: transición automática a 'completado' al llegar a saldo $0, sin acción manual.
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
