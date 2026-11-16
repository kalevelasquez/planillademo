-- Migration: RPCs de transición de estado de Quincena (IMPL-102 / US-CIE-00)
-- Author: @alexis
-- Description: US-CIE-00 CA1 a CA5 — los 4 RPCs que la migración
--              20260718100000_quincenas_estado_lifecycle_rls.sql anticipó explícitamente.
--
--              enviar_a_aprobacion transiciona DESDE 'en_proceso', donde la política
--              "quincenas_update_roles" SÍ autoriza a admin/preparador_planilla — por eso
--              es INVOKER (mismo criterio sin-SECURITY-DEFINER que create_quincena).
--
--              aprobar_y_cerrar_quincena/rechazar_quincena/reabrir_quincena transicionan
--              DESDE 'enviada_aprobacion'/'aprobada_cerrada' — la cláusula USING de esa
--              misma política exige `estado = 'en_proceso'` en la fila VIEJA, así que
--              bloquea el UPDATE para CUALQUIER rol (no solo aprobador_planilla, que además
--              no tiene grant en absoluto). Por eso son SECURITY DEFINER: el chequeo de rol
--              que la RLS ya no puede hacer se hace a mano dentro de cada función.
--
--              Un UPDATE cuyo WHERE no matchea ninguna fila (por estado inválido) no lanza
--              excepción por sí solo — cada función chequea explícitamente `v_result IS
--              NULL` / `NOT FOUND` antes de devolver éxito.

BEGIN;

-- ============================================================
-- 1) Enviar a Aprobación (CA1) — INVOKER
-- ============================================================
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
    -- CA1: checklist de 7 módulos obligatorios confirmados
    SELECT COUNT(*) INTO v_modulos_faltantes
    FROM unnest(ARRAY['horas_extras', 'viaticos', 'vacaciones', 'bonificaciones', 'anticipos', 'incapacidades', 'descuentos']) AS m
    WHERE NOT EXISTS (
        SELECT 1 FROM public.quincena_modulo_estado qme
        WHERE qme.quincena_id = p_quincena_id AND qme.modulo = m AND qme.estado = 'confirmado'
    );

    IF v_modulos_faltantes > 0 THEN
        RAISE EXCEPTION 'El checklist de módulos no está completo — quedan % módulo(s) sin confirmar.', v_modulos_faltantes;
    END IF;

    -- Mismo criterio que calculoCompleto en PreparadorDashboardView.tsx: cálculo corrido
    -- para todos los empleados activos del tenant.
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

    RETURN v_result;
END;
$$;

-- ============================================================
-- 2) Aprobar y Cerrar (CA2, CA5) — SECURITY DEFINER
-- ============================================================
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

    -- CA5: segregación de funciones — quien envió no puede ser quien aprueba.
    IF v_quincena.enviada_por IS NOT NULL AND v_quincena.enviada_por = auth.uid() THEN
        RAISE EXCEPTION 'No puede aprobar una quincena que usted mismo envió a aprobación.';
    END IF;

    UPDATE public.quincenas
    SET estado = 'aprobada_cerrada', aprobada_por = auth.uid(), aprobada_at = now(), aprobada_comentario = p_comentario
    WHERE id = p_quincena_id
    RETURNING * INTO v_quincena;

    RETURN v_quincena;
END;
$$;

-- ============================================================
-- 3) Rechazar (CA3) — SECURITY DEFINER
-- ============================================================
-- CA3 dice literalmente solo rol Aprobador (sin Admin, a diferencia de CA4/Re-abrir) — se
-- implementa la letra literal; ver gap documentado en planilla-contexto.md (posible typo
-- de Jira, a confirmar con el cliente).
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

    RETURN v_quincena;
END;
$$;

-- ============================================================
-- 4) Re-abrir (CA4) — SECURITY DEFINER
-- ============================================================
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

    -- Nota (gap documentado): esto NO resetea quincena_modulo_ubicacion_estado — ver
    -- planilla-contexto.md, Marcaciones/HorasExtrasManual pueden quedar bloqueados tras
    -- una re-apertura. Fuera de alcance de esta iteración (ningún CA de Jira lo pide).
    UPDATE public.quincenas
    SET estado = 'en_proceso', reabierta_por = auth.uid(), reabierta_at = now(), reapertura_motivo = p_motivo
    WHERE id = p_quincena_id
    RETURNING * INTO v_quincena;

    RETURN v_quincena;
END;
$$;

COMMIT;
