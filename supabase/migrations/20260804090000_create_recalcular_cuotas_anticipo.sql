-- Migration: Anticipos — recalcular cuotas de un anticipo activo (IMPL-48 / US-ANT-06, IMPL-55)
-- Author: @alexis
-- Description: Sin tabla nueva. `recalcular_cuotas_anticipo` solo actualiza `numero_cuotas` y
--              `monto_cuota` de `planilla_anticipos` — nunca toca `planilla_anticipo_pagos`
--              (CA2: lo ya pagado es historial inmutable, el recálculo aplica solo sobre el
--              saldo pendiente y las cuotas restantes). CA4 (auditado con detalle anterior vs.
--              nuevo) queda satisfecho gratis por el trigger genérico `tr_audit_planilla_anticipos`
--              (AFTER UPDATE, ya definido en IMPL-51) — vuelca `to_jsonb(OLD)`/`to_jsonb(NEW)`
--              completos, no hace falta logging manual.

BEGIN;

-- Sin SECURITY DEFINER (mismo criterio que crear_anticipo): corre como INVOKER, la policy de
-- UPDATE de planilla_anticipos (ya definida en IMPL-51) es la que autoriza.
CREATE OR REPLACE FUNCTION public.recalcular_cuotas_anticipo(
    p_anticipo_id UUID,
    p_nuevo_numero_cuotas INT,
    p_autorizado_gg BOOLEAN,
    p_autorizado_gg_por TEXT
) RETURNS public.planilla_anticipos
LANGUAGE plpgsql
AS $$
DECLARE
    v_anticipo public.planilla_anticipos;
    v_saldo_pendiente NUMERIC;
    v_nuevo_monto_cuota NUMERIC;
BEGIN
    SELECT * INTO v_anticipo FROM public.planilla_anticipos WHERE id = p_anticipo_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Anticipo % no encontrado', p_anticipo_id;
    END IF;

    IF v_anticipo.estado = 'saldado' THEN
        RAISE EXCEPTION 'El anticipo % ya está saldado, no admite recálculo de cuotas', p_anticipo_id;
    END IF;

    -- CA3: mismo requisito de autorización de Gerencia General que la creación (US-ANT-02 CA3).
    IF v_anticipo.tipo IN ('vacaciones', 'aguinaldo') AND NOT p_autorizado_gg THEN
        RAISE EXCEPTION 'Este anticipo requiere autorización de Gerencia General para recalcular sus cuotas';
    END IF;

    v_saldo_pendiente := v_anticipo.monto_total - v_anticipo.monto_pagado;
    v_nuevo_monto_cuota := ROUND(v_saldo_pendiente / p_nuevo_numero_cuotas, 2);

    UPDATE public.planilla_anticipos
    SET numero_cuotas = p_nuevo_numero_cuotas,
        monto_cuota = v_nuevo_monto_cuota,
        autorizado_gg = p_autorizado_gg,
        autorizado_gg_por = p_autorizado_gg_por,
        updated_at = now()
    WHERE id = p_anticipo_id
    RETURNING * INTO v_anticipo;

    RETURN v_anticipo;
END;
$$;

COMMIT;
