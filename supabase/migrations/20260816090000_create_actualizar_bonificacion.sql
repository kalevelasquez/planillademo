-- Migration: Bonificaciones — Editar Bonificación (IMPL-71 / US-BON-04, IMPL-76)
-- Author: @alexis
-- Description: RPC `actualizar_bonificacion`, simétrico a `actualizar_otro_ingreso` (IMPL-78/79).
--              CA1 exige que edición/eliminación apliquen tanto a automáticos como manuales —
--              el RPC acepta ambos, pero la UI (BonificacionesView.tsx) restringe qué campos se
--              exponen según `origen`: un automático solo permite corregir `monto` (su
--              `gravabilidad` sigue fija en 'gravable' y no tiene `tipo_id`, por diseño de
--              IMPL-74); un manual permite `tipo_id`, `monto` y `gravabilidad`. El DELETE no
--              necesita RPC nuevo — la policy `planilla_bonificaciones_delete_rol` (ya creada en
--              IMPL-74) alcanza para ambos orígenes.

BEGIN;

-- Sin SECURITY DEFINER: corre como INVOKER, la policy de UPDATE ya definida autoriza.
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

    RETURN v_result;
END;
$$;

COMMIT;
