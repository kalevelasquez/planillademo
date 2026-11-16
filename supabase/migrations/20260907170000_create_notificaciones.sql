-- Migration: Notificaciones push in-app de cambio de estado de Quincena (US-CIE-04 / IMPL-127)
-- Author: @alexis
-- Description: Alcance de esta ronda: SOLO el canal push (ícono de campana). El canal email
--              queda fuera — no hay proveedor de correo transaccional integrado todavía (ver
--              planilla-contexto.md). CA1 pide 3 eventos: enviada a aprobación, rechazada,
--              aprobada y cerrada. CA2 deja explícitamente sin confirmar si Admin debe recibir
--              copia de los 3 — NO se incluye acá a propósito, solo lo que el CA confirma
--              (Aprobadores en el envío; Preparador en rechazo/aprobación).
--
--              Tabla genérica `notificaciones` (no `planilla_notificaciones`) porque el
--              mecanismo de push in-app ya existe para Pedidos (NotificationBell.tsx /
--              notificationStore.ts, 100% client-side/localStorage) — esta tabla es la
--              persistencia que le faltaba a ESE sistema, generalizado con un campo `tipo`
--              para poder sumar más dominios además de Quincenas más adelante.
--
--              Los inserts NO tienen policy de INSERT para el rol authenticated — pasan
--              siempre por las funciones SECURITY DEFINER de abajo, así un Preparador puede
--              generar una notificación para un Aprobador (otro usuario) sin necesitar un
--              permiso de INSERT arbitrario sobre filas de terceros.

BEGIN;

CREATE TABLE public.notificaciones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,
    titulo TEXT NOT NULL,
    mensaje TEXT NOT NULL,
    referencia_id UUID,
    leida BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notificaciones_usuario ON public.notificaciones(usuario_id, created_at DESC);

ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY notificaciones_select ON public.notificaciones
    FOR SELECT
    USING (usuario_id = auth.uid() AND tenant_id = public.get_auth_tenant_id());

-- Solo permite marcar como leída (o revertir) la propia notificación — no cambiar su contenido.
CREATE POLICY notificaciones_update_propia ON public.notificaciones
    FOR UPDATE
    USING (usuario_id = auth.uid() AND tenant_id = public.get_auth_tenant_id())
    WITH CHECK (usuario_id = auth.uid() AND tenant_id = public.get_auth_tenant_id());

-- ============================================================
-- Realtime — mismo patrón que 20260320180000_enable_orders_realtime.sql
-- ============================================================
ALTER TABLE public.notificaciones REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.notificaciones;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Table notificaciones already in publication or error: %', SQLERRM;
        END;
    END IF;
END $$;

-- ============================================================
-- Helpers SECURITY DEFINER — únicos puntos de entrada para insertar notificaciones
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_crear_notificacion(
    p_tenant_id UUID, p_usuario_id UUID, p_tipo TEXT, p_titulo TEXT, p_mensaje TEXT, p_referencia_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.notificaciones (tenant_id, usuario_id, tipo, titulo, mensaje, referencia_id)
    VALUES (p_tenant_id, p_usuario_id, p_tipo, p_titulo, p_mensaje, p_referencia_id);
END;
$$;

-- Fan-out a todos los Aprobadores de Planilla activos del tenant (CA2: "enviada a aprobación").
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
    FOR v_usuario_id IN
        SELECT id FROM public.user_profiles
        WHERE tenant_id = p_tenant_id AND 'aprobador_planilla' = ANY(role) AND is_active
    LOOP
        PERFORM public.fn_crear_notificacion(p_tenant_id, v_usuario_id, p_tipo, p_titulo, p_mensaje, p_referencia_id);
    END LOOP;
END;
$$;

-- ============================================================
-- Enganchar los 3 eventos en los RPCs de transición ya existentes
-- (20260824090000_create_quincenas_rpcs_transicion_estado.sql)
-- ============================================================

-- 1) Enviar a Aprobación → notifica a Aprobadores. Se mantiene INVOKER (sin cambios de
--    seguridad) porque fn_notificar_aprobadores_planilla ya es SECURITY DEFINER por su cuenta.
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

    PERFORM public.fn_notificar_aprobadores_planilla(
        v_tenant_id, 'quincena_enviada_aprobacion',
        'Quincena enviada a aprobación',
        format('La quincena "%s" está lista para tu revisión.', v_result.etiqueta_estandar),
        p_quincena_id
    );

    RETURN v_result;
END;
$$;

-- 2) Aprobar y Cerrar → notifica al Preparador que la envió.
CREATE OR REPLACE FUNCTION public.aprobar_y_cerrar_quincena(p_quincena_id UUID, p_comentario TEXT DEFAULT NULL)
RETURNS public.quincenas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_quincena public.quincenas;
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
        PERFORM public.fn_crear_notificacion(
            v_quincena.tenant_id, v_quincena.enviada_por, 'quincena_aprobada_cerrada',
            'Quincena aprobada y cerrada',
            format('La quincena "%s" fue aprobada y cerrada.', v_quincena.etiqueta_estandar),
            p_quincena_id
        );
    END IF;

    RETURN v_quincena;
END;
$$;

-- 3) Rechazar → notifica al Preparador que la envió.
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
