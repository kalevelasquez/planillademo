-- Migration: Agregar "quién ejecutó la acción" al contenido de las notificaciones de quincena
-- Author: @alexis
-- Description: IMPL-127 (US-CIE-04) CA4 exige que el contenido de la notificación incluya
--              "quién lo ejecutó" — la implementación original (20260907170000) omitía este
--              dato en los 3 mensajes (enviada a aprobación, aprobada y cerrada, rechazada).
--              Se agrega resolviendo `auth.uid()` contra `user_profiles.full_name` en cada uno
--              de los 3 RPCs de transición, con un fallback genérico por rol si el nombre no
--              está disponible (usuario desactivado/eliminado, full_name nulo).

BEGIN;

CREATE OR REPLACE FUNCTION public.enviar_a_aprobacion(p_quincena_id UUID)
RETURNS public.quincenas
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.quincenas;
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_modulos_faltantes INT;
    v_total_activos INT;
    v_calculo_count INT;
    v_nombre_ejecutor TEXT;
BEGIN
    SELECT COUNT(*) INTO v_modulos_faltantes
    FROM unnest(ARRAY['horas_extras', 'viaticos', 'vacaciones', 'bonificaciones', 'anticipos', 'incapacidades', 'descuentos']) AS m
    WHERE NOT EXISTS (
        SELECT 1 FROM public.quincena_modulo_estado qme
        WHERE qme.quincena_id = p_quincena_id AND qme.modulo = m AND qme.estado = 'confirmado'
    );

    IF v_modulos_faltantes > 0 THEN
        RAISE EXCEPTION 'El checklist de módulos no está completo — quedan % módulo(s) sin confirmar.', v_modulos_faltantes;
    END IF;

    SELECT COUNT(*) INTO v_total_activos
    FROM public.planilla_empleados
    WHERE tenant_id = v_tenant_id AND deleted_at IS NULL AND estado = 'activo';

    SELECT COUNT(*) INTO v_calculo_count
    FROM public.planilla_calculo_empleado
    WHERE quincena_id = p_quincena_id;

    IF v_total_activos = 0 OR v_calculo_count < v_total_activos THEN
        RAISE EXCEPTION 'El Cálculo de Planilla no está completo para todos los empleados activos.';
    END IF;

    UPDATE public.quincenas
    SET estado = 'enviada_aprobacion', enviada_por = auth.uid(), enviada_at = now()
    WHERE id = p_quincena_id AND estado = 'en_proceso'
    RETURNING * INTO v_result;

    IF v_result.id IS NULL THEN
        RAISE EXCEPTION 'No tiene permisos para enviar esta quincena, o no está en estado En Proceso.';
    END IF;

    SELECT full_name INTO v_nombre_ejecutor FROM public.user_profiles WHERE id = auth.uid();

    PERFORM public.fn_notificar_aprobadores_planilla(
        v_tenant_id, 'quincena_enviada_aprobacion',
        'Quincena enviada a aprobación',
        format('La quincena "%s" está lista para tu revisión. Enviada por %s.', v_result.etiqueta_estandar, COALESCE(v_nombre_ejecutor, 'un preparador')),
        p_quincena_id
    );

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.aprobar_y_cerrar_quincena(p_quincena_id UUID, p_comentario TEXT DEFAULT NULL)
RETURNS public.quincenas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_quincena public.quincenas;
    v_nombre_ejecutor TEXT;
BEGIN
    SELECT * INTO v_quincena FROM public.quincenas
    WHERE id = p_quincena_id AND tenant_id = public.get_auth_tenant_id()
    FOR UPDATE;

    IF v_quincena.id IS NULL THEN
        RAISE EXCEPTION 'Quincena no encontrada.';
    END IF;

    IF NOT ('admin' = ANY(public.get_auth_roles()) OR 'aprobador_planilla' = ANY(public.get_auth_roles())) THEN
        RAISE EXCEPTION 'No tiene permisos de Aprobador.';
    END IF;

    IF v_quincena.estado <> 'enviada_aprobacion' THEN
        RAISE EXCEPTION 'La quincena no está pendiente de aprobación.';
    END IF;

    IF v_quincena.enviada_por IS NOT NULL AND v_quincena.enviada_por = auth.uid() THEN
        RAISE EXCEPTION 'No puede aprobar una quincena que usted mismo envió a aprobación.';
    END IF;

    UPDATE public.quincenas
    SET estado = 'aprobada_cerrada', aprobada_por = auth.uid(), aprobada_at = now(), aprobada_comentario = p_comentario
    WHERE id = p_quincena_id
    RETURNING * INTO v_quincena;

    IF v_quincena.enviada_por IS NOT NULL THEN
        SELECT full_name INTO v_nombre_ejecutor FROM public.user_profiles WHERE id = auth.uid();

        PERFORM public.fn_crear_notificacion(
            v_quincena.tenant_id, v_quincena.enviada_por, 'quincena_aprobada_cerrada',
            'Quincena aprobada y cerrada',
            format('La quincena "%s" fue aprobada y cerrada por %s.', v_quincena.etiqueta_estandar, COALESCE(v_nombre_ejecutor, 'un aprobador')),
            p_quincena_id
        );
    END IF;

    RETURN v_quincena;
END;
$$;

CREATE OR REPLACE FUNCTION public.rechazar_quincena(p_quincena_id UUID, p_motivo TEXT)
RETURNS public.quincenas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_quincena public.quincenas;
    v_nombre_ejecutor TEXT;
BEGIN
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'El motivo de rechazo es obligatorio.';
    END IF;

    SELECT * INTO v_quincena FROM public.quincenas
    WHERE id = p_quincena_id AND tenant_id = public.get_auth_tenant_id()
    FOR UPDATE;

    IF v_quincena.id IS NULL THEN
        RAISE EXCEPTION 'Quincena no encontrada.';
    END IF;

    IF NOT ('aprobador_planilla' = ANY(public.get_auth_roles())) THEN
        RAISE EXCEPTION 'No tiene permisos de Aprobador.';
    END IF;

    IF v_quincena.estado <> 'enviada_aprobacion' THEN
        RAISE EXCEPTION 'La quincena no está pendiente de aprobación.';
    END IF;

    UPDATE public.quincenas
    SET estado = 'en_proceso', rechazada_por = auth.uid(), rechazada_at = now(), rechazo_motivo = p_motivo
    WHERE id = p_quincena_id
    RETURNING * INTO v_quincena;

    IF v_quincena.enviada_por IS NOT NULL THEN
        SELECT full_name INTO v_nombre_ejecutor FROM public.user_profiles WHERE id = auth.uid();

        PERFORM public.fn_crear_notificacion(
            v_quincena.tenant_id, v_quincena.enviada_por, 'quincena_rechazada',
            'Quincena rechazada',
            format('La quincena "%s" fue rechazada por %s. Motivo: %s', v_quincena.etiqueta_estandar, COALESCE(v_nombre_ejecutor, 'un aprobador'), p_motivo),
            p_quincena_id
        );
    END IF;

    RETURN v_quincena;
END;
$$;

COMMIT;
