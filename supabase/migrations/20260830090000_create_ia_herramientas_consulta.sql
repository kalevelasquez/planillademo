-- Migration: Catálogo de herramientas de consulta para el Asistente de IA (IMPL-115 / US-IA-01)
-- Author: @alexis
-- Description: US-IA-01 CA1/CA4 — cada función es INVOKER (sin SECURITY DEFINER), mismo
--              criterio que la mayoría de RPCs de lectura del proyecto: corre con los
--              privilegios de quien la invoca, así que la RLS ya existente de cada tabla
--              autoriza sola — no se duplica ninguna lógica de permisos acá. Un Preparador
--              que le pregunta al asistente por un empleado que no puede ver en pantalla
--              tampoco lo va a poder ver a través de estas funciones, porque la fila ni
--              siquiera es visible bajo su RLS.
--
--              CA3 (solo lectura): ninguna de las 6 funciones hace INSERT/UPDATE/DELETE.
--
--              Retornan JSONB (no un tipo compuesto fijo) para poder anexar campos nuevos
--              sin romper el contrato de la función — el futuro Edge Function del chat
--              (IMPL-117) las expone como "tools" de Anthropic con un schema de entrada
--              simple (un UUID), y les pasa el resultado JSONB tal cual como tool_result.
--
--              Se agregan 2 herramientas extra (`ia_buscar_empleado`,
--              `ia_consultar_quincena_actual`) NO pedidas literalmente por el CA2 de Jira,
--              pero necesarias en la práctica: una pregunta en lenguaje natural nunca trae
--              un UUID — trae un nombre ("¿cuántos días tomó Juan Pérez?") o una referencia
--              implícita ("la quincena actual"). Sin estas dos, el asistente no tendría
--              forma de resolver ninguna de las otras 6 herramientas desde una pregunta
--              real. Mismo criterio INVOKER/solo-lectura que el resto.

BEGIN;

-- ============================================================
-- 1) Estado de vacaciones de un empleado (Lotes 1 y 8)
-- ============================================================
-- Gap documentado (no inventado acá): el sistema NUNCA calculó el derecho anual de
-- vacaciones por ley (15 días/año tras 1 año de antigüedad, Código de Trabajo) — solo
-- registra períodos ya tomados. "dias_pendientes"/"fecha_vencimiento" quedan NULL con una
-- nota explícita, en vez de inventar un cálculo de acumulación no validado en ningún otro
-- lugar del proyecto (mismo criterio que salario_minimo_inembargable en Cálculo de Planilla).
CREATE OR REPLACE FUNCTION public.ia_consultar_estado_vacaciones(p_empleado_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_periodos JSONB;
    v_dias_gozados_anio INT;
BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'fecha_inicio', v.fecha_inicio,
        'fecha_fin', v.fecha_fin,
        'dias', v.dias,
        'no_gozada', v.no_gozada
    ) ORDER BY v.fecha_inicio DESC), '[]'::jsonb)
    INTO v_periodos
    FROM public.planilla_vacaciones v
    WHERE v.tenant_id = v_tenant_id AND v.empleado_id = p_empleado_id;

    SELECT COALESCE(SUM(v.dias), 0) INTO v_dias_gozados_anio
    FROM public.planilla_vacaciones v
    WHERE v.tenant_id = v_tenant_id AND v.empleado_id = p_empleado_id
      AND v.fecha_inicio >= date_trunc('year', now());

    RETURN jsonb_build_object(
        'empleado_id', p_empleado_id,
        'dias_gozados_anio_actual', v_dias_gozados_anio,
        'periodos', v_periodos,
        'dias_pendientes', NULL,
        'fecha_vencimiento', NULL,
        'nota', 'El sistema todavía no calcula el derecho anual de vacaciones por ley — solo registra los períodos ya tomados que se listan en "periodos".'
    );
END;
$$;

-- ============================================================
-- 2) Estado de una quincena (Lote 2 / Cierre y Aprobación)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_consultar_estado_quincena(p_quincena_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_quincena public.quincenas;
    v_checklist JSONB;
BEGIN
    SELECT * INTO v_quincena FROM public.quincenas
    WHERE id = p_quincena_id AND tenant_id = v_tenant_id;

    IF v_quincena.id IS NULL THEN
        RETURN jsonb_build_object('encontrada', false);
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('modulo', qme.modulo, 'estado', qme.estado)), '[]'::jsonb)
    INTO v_checklist
    FROM public.quincena_modulo_estado qme
    WHERE qme.quincena_id = p_quincena_id;

    RETURN jsonb_build_object(
        'encontrada', true,
        'quincena_id', v_quincena.id,
        'etiqueta_estandar', v_quincena.etiqueta_estandar,
        'tipo', v_quincena.tipo,
        'fecha_inicio', v_quincena.fecha_inicio,
        'fecha_fin', v_quincena.fecha_fin,
        'estado', v_quincena.estado,
        'checklist_modulos', v_checklist,
        'enviada_por', v_quincena.enviada_por,
        'enviada_at', v_quincena.enviada_at,
        'aprobada_por', v_quincena.aprobada_por,
        'aprobada_at', v_quincena.aprobada_at,
        'rechazada_at', v_quincena.rechazada_at,
        'rechazo_motivo', v_quincena.rechazo_motivo
    );
END;
$$;

-- ============================================================
-- 3) Descuentos activos y saldo pendiente de un empleado (Lote 7)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_consultar_descuentos_activos(p_empleado_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_result JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', d.id,
        'categoria_id', d.categoria_id,
        'estado', d.estado,
        'monto_total', d.monto_total,
        'monto_pagado', d.monto_pagado,
        'saldo_pendiente', CASE WHEN d.monto_total IS NULL THEN NULL ELSE d.monto_total - d.monto_pagado END,
        'monto_quincenal', d.monto_quincenal,
        'es_indefinido', d.monto_total IS NULL
    )), '[]'::jsonb)
    INTO v_result
    FROM public.planilla_descuentos d
    WHERE d.tenant_id = v_tenant_id AND d.empleado_id = p_empleado_id AND d.estado IN ('activo', 'pausado');

    RETURN jsonb_build_object('empleado_id', p_empleado_id, 'descuentos_activos', v_result);
END;
$$;

-- ============================================================
-- 4) Anticipos activos y saldo pendiente de un empleado (Lote 6)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_consultar_anticipos_activos(p_empleado_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_result JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', a.id,
        'numero_vale', a.numero_vale,
        'tipo', a.tipo,
        'fecha_vale', a.fecha_vale,
        'estado', a.estado,
        'monto_total', a.monto_total,
        'monto_pagado', a.monto_pagado,
        'saldo_pendiente', a.monto_total - a.monto_pagado,
        'monto_quincenal', a.monto_quincenal
    )), '[]'::jsonb)
    INTO v_result
    FROM public.planilla_anticipos a
    WHERE a.tenant_id = v_tenant_id AND a.empleado_id = p_empleado_id AND a.estado = 'activo';

    RETURN jsonb_build_object('empleado_id', p_empleado_id, 'anticipos_activos', v_result);
END;
$$;

-- ============================================================
-- 5) Incapacidades registradas en el período (Lote 5)
-- ============================================================
-- p_quincena_id opcional: si se omite, devuelve TODAS las incapacidades del empleado
-- (últimas primero) en vez de limitarlas a una sola quincena.
CREATE OR REPLACE FUNCTION public.ia_consultar_incapacidades_periodo(p_empleado_id UUID, p_quincena_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_result JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', i.id,
        'quincena_id', i.quincena_id,
        'numero_cit', i.numero_cit,
        'tipo', i.tipo,
        'fecha_inicio', i.fecha_inicio,
        'fecha_fin', i.fecha_fin,
        'dias', i.dias,
        'con_subsidio', i.con_subsidio,
        'trabajo_durante_incapacidad', i.trabajo_durante_incapacidad
    ) ORDER BY i.fecha_inicio DESC), '[]'::jsonb)
    INTO v_result
    FROM public.planilla_incapacidades i
    WHERE i.tenant_id = v_tenant_id AND i.empleado_id = p_empleado_id
      AND (p_quincena_id IS NULL OR i.quincena_id = p_quincena_id);

    RETURN jsonb_build_object('empleado_id', p_empleado_id, 'quincena_id', p_quincena_id, 'incapacidades', v_result);
END;
$$;

-- ============================================================
-- 6) Resumen financiero de una quincena (Lote 10)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_consultar_resumen_financiero_quincena(p_quincena_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_total_empleados INT;
    v_sueldos_base NUMERIC;
    v_horas_extras NUMERIC;
    v_viaticos NUMERIC;
    v_bonificaciones NUMERIC;
    v_isss NUMERIC;
    v_afp NUMERIC;
    v_renta_isr NUMERIC;
    v_descuentos_anticipos NUMERIC;
    v_neto NUMERIC;
BEGIN
    SELECT
        COUNT(*),
        COALESCE(SUM(ce.sueldo_proporcional), 0),
        COALESCE(SUM(ce.horas_extras_monto), 0),
        COALESCE(SUM(ce.viaticos_monto), 0),
        COALESCE(SUM(ce.bonificaciones_monto), 0),
        COALESCE(SUM(ce.isss_empleado), 0),
        COALESCE(SUM(ce.afp_empleado), 0),
        COALESCE(SUM(ce.renta_isr + ce.renta_bono10), 0),
        COALESCE(SUM(ce.descuentos_no_obligatorios_aplicado), 0),
        COALESCE(SUM(ce.neto_a_pagar), 0)
    INTO
        v_total_empleados, v_sueldos_base, v_horas_extras, v_viaticos, v_bonificaciones,
        v_isss, v_afp, v_renta_isr, v_descuentos_anticipos, v_neto
    FROM public.planilla_calculo_empleado ce
    JOIN public.quincenas q ON q.id = ce.quincena_id
    WHERE q.tenant_id = v_tenant_id AND ce.quincena_id = p_quincena_id;

    IF v_total_empleados = 0 THEN
        RETURN jsonb_build_object('quincena_id', p_quincena_id, 'calculado', false, 'nota', 'Esta quincena todavía no tiene el Cálculo de Planilla corrido.');
    END IF;

    RETURN jsonb_build_object(
        'quincena_id', p_quincena_id,
        'calculado', true,
        'total_empleados', v_total_empleados,
        'sueldos_base', v_sueldos_base,
        'horas_extras', v_horas_extras,
        'viaticos', v_viaticos,
        'bonificaciones', v_bonificaciones,
        'isss', v_isss,
        'afp', v_afp,
        'renta_isr', v_renta_isr,
        'descuentos_y_anticipos_aplicados', v_descuentos_anticipos,
        'neto_total_a_pagar', v_neto
    );
END;
$$;

-- ============================================================
-- 7) Buscar empleado por nombre/código (resuelve referencias en lenguaje natural)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_buscar_empleado(p_busqueda TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_result JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', e.id,
        'nombre_completo', e.nombre_completo,
        'codigo', e.codigo,
        'cargo', e.cargo,
        'departamento', e.departamento,
        'estado', e.estado
    )), '[]'::jsonb)
    INTO v_result
    FROM public.planilla_empleados e
    WHERE e.tenant_id = v_tenant_id AND e.deleted_at IS NULL
      AND (e.nombre_completo ILIKE '%' || p_busqueda || '%' OR e.codigo ILIKE '%' || p_busqueda || '%')
    LIMIT 10;

    RETURN jsonb_build_object('busqueda', p_busqueda, 'resultados', v_result);
END;
$$;

-- ============================================================
-- 8) Quincena actual (mismo criterio que "quincenaActiva" en PreparadorDashboardView.tsx:
-- la más reciente por fecha_inicio cuyo estado no sea 'aprobada_cerrada')
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_consultar_quincena_actual()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_quincena_id UUID;
BEGIN
    SELECT id INTO v_quincena_id
    FROM public.quincenas
    WHERE tenant_id = v_tenant_id AND estado <> 'aprobada_cerrada' AND deleted_at IS NULL
    ORDER BY fecha_inicio DESC
    LIMIT 1;

    IF v_quincena_id IS NULL THEN
        RETURN jsonb_build_object('encontrada', false, 'nota', 'No hay ninguna quincena activa en este momento.');
    END IF;

    RETURN public.ia_consultar_estado_quincena(v_quincena_id);
END;
$$;

COMMIT;
