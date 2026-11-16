BEGIN;

-- Gap documentado (planilla-contexto.md, Cierre y Aprobación #1): reabrir_quincena solo
-- movía quincenas.estado, dejando quincena_modulo_ubicacion_estado (que es lo que de verdad
-- gatea INSERT/DELETE en planilla_marcaciones y planilla_horas_extras_manual vía RLS, no
-- quincenas.estado directamente) todavía en 'completado' — Horas Extras quedaba bloqueado
-- aunque la quincena volviera a 'en_proceso'. También se resetea quincena_modulo_estado
-- (nivel tenant-quincena, usado por el checklist del Preparador) para que no siga mostrando
-- "Horas Extras: confirmado" mientras la captura está de nuevo desbloqueada.
CREATE OR REPLACE FUNCTION public.reabrir_quincena(p_quincena_id UUID, p_motivo TEXT)
RETURNS public.quincenas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_quincena public.quincenas;
BEGIN
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'El motivo de re-apertura es obligatorio.';
    END IF;

    SELECT * INTO v_quincena FROM public.quincenas
    WHERE id = p_quincena_id AND tenant_id = public.get_auth_tenant_id()
    FOR UPDATE;

    IF v_quincena.id IS NULL THEN
        RAISE EXCEPTION 'Quincena no encontrada.';
    END IF;

    IF NOT ('admin' = ANY(public.get_auth_roles()) OR 'aprobador_planilla' = ANY(public.get_auth_roles())) THEN
        RAISE EXCEPTION 'No tiene permisos para re-abrir esta quincena.';
    END IF;

    IF v_quincena.estado <> 'aprobada_cerrada' THEN
        RAISE EXCEPTION 'Solo se pueden re-abrir quincenas Aprobadas y Cerradas.';
    END IF;

    UPDATE public.quincenas
    SET estado = 'en_proceso', reabierta_por = auth.uid(), reabierta_at = now(), reapertura_motivo = p_motivo
    WHERE id = p_quincena_id
    RETURNING * INTO v_quincena;

    UPDATE public.quincena_modulo_ubicacion_estado
    SET estado = 'pendiente', completado_por = NULL, completado_at = NULL
    WHERE quincena_id = p_quincena_id AND modulo = 'horas_extras' AND estado = 'completado';

    UPDATE public.quincena_modulo_estado
    SET estado = 'pendiente', confirmado_por = NULL, confirmado_at = NULL, via_sin_registros = false
    WHERE quincena_id = p_quincena_id AND modulo = 'horas_extras' AND estado = 'confirmado';

    RETURN v_quincena;
END;
$$;

COMMIT;
