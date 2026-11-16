-- Migration: Reabrir un módulo/ubicación mientras la quincena sigue en_proceso (IMPL-124)
-- Author: @alexis
-- Description: Gap reportado por el usuario en Horas Extras — el mensaje de solo-lectura
--              ("reabrir la quincena, disponible cuando exista Cierre y Aprobación") es
--              correcto una vez que la quincena está 'aprobada_cerrada' (`reabrir_quincena`,
--              20260907110000), pero NO existe forma de corregir un error mientras la
--              quincena sigue 'en_proceso': una vez que `completar_ubicacion_modulo` marca
--              una ubicación como 'completado', queda bloqueada hasta que alguien cierre y
--              re-abra la quincena entera — desproporcionado para corregir un solo dato.
--
--              Se generaliza a los 7 módulos (no solo horas_extras) porque
--              `quincena_modulo_ubicacion_estado` ya es genérica por `modulo` desde su
--              creación (20260724090000) — no hay motivo para restringir el RPC inverso a un
--              solo módulo.
--
--              Sin SECURITY DEFINER: la RLS de UPDATE ya existente en
--              `quincena_modulo_ubicacion_estado` y `quincena_modulo_estado` (admin/
--              preparador_planilla + quincena.estado = 'en_proceso') permite exactamente este
--              escenario — mismo criterio que `completar_ubicacion_modulo`.

BEGIN;

-- Motivo obligatorio persistido en la propia fila, mismo criterio que
-- quincenas.reapertura_motivo/reabierta_por/reabierta_at (20260907110000).
ALTER TABLE public.quincena_modulo_ubicacion_estado
    ADD COLUMN IF NOT EXISTS reabierta_por UUID REFERENCES public.user_profiles(id),
    ADD COLUMN IF NOT EXISTS reabierta_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reapertura_motivo TEXT;

CREATE OR REPLACE FUNCTION public.reabrir_modulo_ubicacion(
    p_quincena_id UUID,
    p_ubicacion_id UUID,
    p_modulo TEXT,
    p_motivo TEXT
) RETURNS public.quincena_modulo_ubicacion_estado
LANGUAGE plpgsql
AS $$
DECLARE
    v_row public.quincena_modulo_ubicacion_estado;
BEGIN
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'El motivo de re-apertura es obligatorio.';
    END IF;

    UPDATE public.quincena_modulo_ubicacion_estado
    SET estado = 'pendiente',
        completado_por = NULL,
        completado_at = NULL,
        reabierta_por = auth.uid(),
        reabierta_at = now(),
        reapertura_motivo = p_motivo
    WHERE quincena_id = p_quincena_id
      AND ubicacion_id = p_ubicacion_id
      AND modulo = p_modulo
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'No existe un registro de completitud para esta ubicación y módulo.';
    END IF;

    -- Un módulo confirmado a nivel de quincena ya no lo está si una de sus ubicaciones
    -- vuelve a 'pendiente' — mismo des-cascade que reabrir_quincena hace para horas_extras,
    -- generalizado acá a cualquier módulo.
    UPDATE public.quincena_modulo_estado
    SET estado = 'pendiente', confirmado_por = NULL, confirmado_at = NULL, via_sin_registros = false
    WHERE quincena_id = p_quincena_id AND modulo = p_modulo AND estado = 'confirmado';

    RETURN v_row;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.audit_action'::regtype AND enumlabel = 'REAPERTURA_MODULO') THEN
        ALTER TYPE public.audit_action ADD VALUE 'REAPERTURA_MODULO';
    END IF;
END $$;

COMMIT;
