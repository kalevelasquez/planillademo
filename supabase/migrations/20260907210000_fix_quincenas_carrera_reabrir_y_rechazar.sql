-- Migration: Quincenas — 3 hallazgos importantes de la auditoría corregidos (2026-08-13)
-- Author: @alexis
-- Description: Tercera pasada de la auditoría crítica módulo por módulo, sobre el ciclo de
--              vida de Quincenas:
--
--              1. Condición de carrera real en create_quincena (CA6 de US-QNA-01): el chequeo
--                 de solapamiento (`SELECT EXISTS`) y el `INSERT` son dos statements separados
--                 sin lock — dos Preparadores creando quincenas que se solapan casi al mismo
--                 instante pueden ambos ver "sin solapamiento" antes de que cualquiera
--                 confirme. Se serializa con `pg_advisory_xact_lock` sobre un hash de
--                 (tenant_id, tipo) — se libera solo automáticamente al terminar la
--                 transacción, sin necesitar una extensión nueva (el proyecto no tiene
--                 precedente de `btree_gist`/EXCLUDE constraints, ver comentario original de
--                 20260718090000).
--
--              2. `reabrir_quincena` solo reseteaba el checklist de `horas_extras` — los otros
--                 6 módulos quedaban "confirmado" aunque su RLS ya volvía a permitir edición en
--                 cuanto la quincena volvía a 'en_proceso', dejando el checklist desincronizado
--                 con la realidad. Se generaliza el reset a los 7 módulos.
--
--              3. `rechazar_quincena` solo permitía al rol Aprobador — un Admin puro (que la UI
--                 sí deja entrar a la pantalla de Aprobador y habilita el botón) recibía la
--                 excepción cruda "No tiene permisos de Aprobador." Confirmado con el usuario:
--                 Admin también puede rechazar, mismo criterio que ya tienen
--                 aprobar_y_cerrar_quincena y reabrir_quincena.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_quincena(
    p_tipo TEXT,
    p_nombre TEXT,
    p_etiqueta_estandar TEXT,
    p_fecha_inicio DATE,
    p_fecha_fin DATE,
    p_dias_habiles INT
)
RETURNS public.quincenas
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.quincenas;
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_solapada BOOLEAN;
BEGIN
    -- Bugfix (auditoría): serializa el chequeo+insert por (tenant, tipo) — sin esto, dos
    -- creaciones casi simultáneas para el mismo tipo podían ambas pasar el chequeo de
    -- solapamiento antes de que cualquiera confirmara. El lock se libera solo al terminar la
    -- transacción (xact), nunca hay que liberarlo a mano.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id::TEXT || ':' || p_tipo, 0));

    SELECT EXISTS (
        SELECT 1 FROM public.quincenas
        WHERE tenant_id = v_tenant_id
          AND tipo = p_tipo
          AND deleted_at IS NULL
          AND fecha_inicio <= p_fecha_fin
          AND fecha_fin >= p_fecha_inicio
    ) INTO v_solapada;

    IF v_solapada THEN
        RAISE EXCEPTION 'Ya existe una quincena de tipo "%" con un rango de fechas que se superpone (%  a  %)', p_tipo, p_fecha_inicio, p_fecha_fin;
    END IF;

    INSERT INTO public.quincenas (
        tenant_id, tipo, nombre, etiqueta_estandar, fecha_inicio, fecha_fin, dias_habiles, created_by
    ) VALUES (
        v_tenant_id, p_tipo, p_nombre, p_etiqueta_estandar, p_fecha_inicio, p_fecha_fin, p_dias_habiles, auth.uid()
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

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

    -- Bugfix (auditoría): antes solo resetaba 'horas_extras' — los otros 6 módulos quedaban
    -- "confirmado" en el checklist aunque su RLS ya permitiera editarlos de nuevo.
    UPDATE public.quincena_modulo_ubicacion_estado
    SET estado = 'pendiente', completado_por = NULL, completado_at = NULL
    WHERE quincena_id = p_quincena_id AND estado = 'completado';

    UPDATE public.quincena_modulo_estado
    SET estado = 'pendiente', confirmado_por = NULL, confirmado_at = NULL, via_sin_registros = false
    WHERE quincena_id = p_quincena_id AND estado = 'confirmado';

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

    -- Bugfix (auditoría, confirmado con el usuario): Admin también puede rechazar, mismo
    -- criterio que aprobar_y_cerrar_quincena y reabrir_quincena — antes un Admin puro (a quien
    -- la UI sí deja entrar y habilita el botón) recibía la excepción cruda de más abajo.
    IF NOT ('admin' = ANY(public.get_auth_roles()) OR 'aprobador_planilla' = ANY(public.get_auth_roles())) THEN
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
        PERFORM public.fn_crear_notificacion(
            v_quincena.tenant_id, v_quincena.enviada_por, 'quincena_rechazada',
            'Quincena rechazada',
            format('La quincena "%s" fue rechazada. Motivo: %s', v_quincena.etiqueta_estandar, p_motivo),
            p_quincena_id
        );
    END IF;

    RETURN v_quincena;
END;
$$;

COMMIT;
