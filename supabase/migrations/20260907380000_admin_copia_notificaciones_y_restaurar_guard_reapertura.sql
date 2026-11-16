-- Migration: Admin recibe copia de las 3 notificaciones de quincena + restaurar guard perdido
-- Author: @alexis
-- Description: Dos cosas en una sola migración porque ambas tocan las mismas 3 funciones:
--
--              1) IMPL-127 (US-CIE-04) CA2 — quedaba explícitamente sin confirmar si Admin
--                 debe recibir copia de los 3 eventos (enviada a aprobación, aprobada y
--                 cerrada, rechazada). Confirmado: sí. Se agrega Admin como destinatario
--                 adicional en los 3 eventos, deduplicado contra los destinatarios existentes
--                 (un Admin que también es Aprobador, o que resulta ser el mismo Preparador que
--                 envió, recibe UNA sola notificación, no dos).
--
--              2) BUG REAL AUTODETECTADO: 20260907370000 (agregar nombre del ejecutor) se
--                 escribió tomando como base el `enviar_a_aprobacion` de 20260907170000 sin
--                 revisar que 20260907200000 ("bloquear envío con cálculo obsoleto tras
--                 reabrir") ya lo había modificado — CREATE OR REPLACE pisó esa validación por
--                 completo, sin ningún error visible (no hay tests de integración contra la
--                 base real). Se restaura acá el guard de `v_reabierta_at`/
--                 `v_calculo_obsoleto_count` de 20260907200000, ahora combinado con el nombre
--                 del ejecutor de 20260907370000.
--
--              `fn_notificar_aprobadores_planilla` pasa a incluir también `admin` en su propio
--              WHERE (una sola query con `role && ARRAY[...]`, dedup automático por ser
--              SELECT DISTINCT-like — un usuario con ambos roles aparece una sola vez). Para
--              aprobar_y_cerrar_quincena/rechazar_quincena se agrega
--              `fn_notificar_preparador_y_admins_planilla`, mismo criterio de dedup vía OR en
--              el WHERE en vez de dos llamadas separadas.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_notificar_aprobadores_planilla(
    p_tenant_id UUID, p_tipo TEXT, p_titulo TEXT, p_mensaje TEXT, p_referencia_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usuario_id UUID;
BEGIN
    -- CA2: Aprobadores + Admin (copia), una sola query — dedup natural si un usuario tiene
    -- ambos roles.
    FOR v_usuario_id IN
        SELECT id FROM public.user_profiles
        WHERE tenant_id = p_tenant_id AND is_active
          AND (role && ARRAY['aprobador_planilla', 'admin'])
    LOOP
        PERFORM public.fn_crear_notificacion(p_tenant_id, v_usuario_id, p_tipo, p_titulo, p_mensaje, p_referencia_id);
    END LOOP;
END;
$$;

-- Nueva: mismo criterio que fn_notificar_aprobadores_planilla pero para los otros 2 eventos,
-- cuyo destinatario base es UN preparador puntual (enviada_por), no un rol completo.
CREATE OR REPLACE FUNCTION public.fn_notificar_preparador_y_admins_planilla(
    p_tenant_id UUID, p_preparador_id UUID, p_tipo TEXT, p_titulo TEXT, p_mensaje TEXT, p_referencia_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usuario_id UUID;
BEGIN
    FOR v_usuario_id IN
        SELECT id FROM public.user_profiles
        WHERE tenant_id = p_tenant_id AND is_active
          AND (id = p_preparador_id OR 'admin' = ANY(role))
    LOOP
        PERFORM public.fn_crear_notificacion(p_tenant_id, v_usuario_id, p_tipo, p_titulo, p_mensaje, p_referencia_id);
    END LOOP;
END;
$$;

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
    v_reabierta_at TIMESTAMPTZ;
    v_calculo_obsoleto_count INT;
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

    -- Restaurado (20260907200000, perdido sin querer en 20260907370000): si la quincena se
    -- reabrió después del último cálculo de algún empleado, esos montos pueden no reflejar
    -- correcciones hechas post-reapertura.
    SELECT reabierta_at INTO v_reabierta_at FROM public.quincenas WHERE id = p_quincena_id;

    IF v_reabierta_at IS NOT NULL THEN
        SELECT COUNT(*) INTO v_calculo_obsoleto_count
        FROM public.planilla_calculo_empleado
        WHERE quincena_id = p_quincena_id AND calculado_at < v_reabierta_at;

        IF v_calculo_obsoleto_count > 0 THEN
            RAISE EXCEPTION 'Esta quincena fue reabierta después del último cálculo de % empleado(s) — volvé a "Calcular Planilla de esta Quincena" antes de enviar a aprobación.', v_calculo_obsoleto_count;
        END IF;
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

    SELECT full_name INTO v_nombre_ejecutor FROM public.user_profiles WHERE id = auth.uid();

    PERFORM public.fn_notificar_preparador_y_admins_planilla(
        v_quincena.tenant_id, v_quincena.enviada_por, 'quincena_aprobada_cerrada',
        'Quincena aprobada y cerrada',
        format('La quincena "%s" fue aprobada y cerrada por %s.', v_quincena.etiqueta_estandar, COALESCE(v_nombre_ejecutor, 'un aprobador')),
        p_quincena_id
    );

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

    SELECT full_name INTO v_nombre_ejecutor FROM public.user_profiles WHERE id = auth.uid();

    PERFORM public.fn_notificar_preparador_y_admins_planilla(
        v_quincena.tenant_id, v_quincena.enviada_por, 'quincena_rechazada',
        'Quincena rechazada',
        format('La quincena "%s" fue rechazada por %s. Motivo: %s', v_quincena.etiqueta_estandar, COALESCE(v_nombre_ejecutor, 'un aprobador'), p_motivo),
        p_quincena_id
    );

    RETURN v_quincena;
END;
$$;

COMMIT;
