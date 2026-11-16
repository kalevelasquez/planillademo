-- Migration: Horas Extras — "Sin horas extra esta ubicación" (IMPL-16 US-QNA-06 CA2, corrección de septiembre 2026)
-- Author: @alexis
-- Description: Horas Extras dejó de ser exclusión total del módulo — Imporfrut confirmó que sí
--              hay casos reales de una sucursal completa sin horas extra en el período. La
--              tabla `quincena_modulo_ubicacion_estado` (20260724090000) ya tiene la dimensión
--              de ubicación necesaria; solo falta la columna `via_sin_registros` (ya existe en
--              `quincena_modulo_estado` desde el origen, pero nunca se agregó a esta tabla
--              porque hasta ahora ninguna ubicación tenía forma de completarse sin datos
--              reales) y extender (no duplicar) el RPC `completar_ubicacion_modulo` para que
--              acepte y propague el flag.

BEGIN;

ALTER TABLE public.quincena_modulo_ubicacion_estado
    ADD COLUMN IF NOT EXISTS via_sin_registros BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.completar_ubicacion_modulo(
    p_quincena_id UUID,
    p_ubicacion_id UUID,
    p_modulo TEXT,
    p_user_id UUID,
    p_via_sin_registros BOOLEAN DEFAULT false
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID;
    v_modulo_estado_id UUID;
    v_total_activas INT;
    v_total_completadas INT;
    v_total_completadas_sin_registros INT;
BEGIN
    v_tenant_id := public.get_auth_tenant_id();

    INSERT INTO public.quincena_modulo_ubicacion_estado (tenant_id, quincena_id, ubicacion_id, modulo, estado, via_sin_registros, completado_por, completado_at)
    VALUES (v_tenant_id, p_quincena_id, p_ubicacion_id, p_modulo, 'completado', p_via_sin_registros, p_user_id, now())
    ON CONFLICT (quincena_id, ubicacion_id, modulo)
    DO UPDATE SET estado = 'completado', via_sin_registros = p_via_sin_registros, completado_por = p_user_id, completado_at = now();

    SELECT id INTO v_modulo_estado_id
    FROM public.quincena_modulo_estado
    WHERE quincena_id = p_quincena_id AND modulo = p_modulo
    FOR UPDATE;

    IF v_modulo_estado_id IS NULL THEN
        RETURN;
    END IF;

    SELECT count(*) INTO v_total_activas
    FROM public.planilla_ubicaciones u
    WHERE u.tenant_id = v_tenant_id AND u.estado = 'activo';

    SELECT count(*), count(*) FILTER (WHERE e.via_sin_registros) INTO v_total_completadas, v_total_completadas_sin_registros
    FROM public.quincena_modulo_ubicacion_estado e
    JOIN public.planilla_ubicaciones u ON u.id = e.ubicacion_id
    WHERE e.quincena_id = p_quincena_id AND e.modulo = p_modulo AND e.estado = 'completado' AND u.estado = 'activo';

    IF v_total_activas > 0 AND v_total_completadas >= v_total_activas THEN
        UPDATE public.quincena_modulo_estado
        SET estado = 'confirmado', confirmado_por = p_user_id, confirmado_at = now(),
            via_sin_registros = (v_total_completadas_sin_registros = v_total_activas)
        WHERE id = v_modulo_estado_id;
    END IF;
END;
$$;

COMMIT;
