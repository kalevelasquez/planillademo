-- Migration: Ampliar catálogo de herramientas de consulta del Asistente de IA (preguntas agregadas)
-- Author: @alexis
-- Description: El catálogo original (20260830090000_create_ia_herramientas_consulta.sql, 8
--              herramientas) solo cubría consultas POR EMPLEADO o POR QUINCENA PUNTUAL. No
--              tenía respuesta para preguntas agregadas tipo "¿cuántos empleados tenemos?" o
--              "¿cuánto se debe en anticipos?" — el asistente respondía honestamente que no
--              tenía herramienta (CA2 de US-IA-02: nunca inventa datos). Esta migración agrega
--              5 RPCs de solo lectura para cubrirlas:
--                - ia_consultar_resumen_empleados: total/activos/inactivos + conteo por departamento
--                - ia_consultar_anticipos_descuentos_pendientes: saldo pendiente total + detalle
--                - ia_consultar_horas_extras_quincena: totales de horas (HED/HEN/nocturnidad/feriado) y monto
--                - ia_consultar_proximos_feriados: feriados del tenant desde hoy
--                - ia_consultar_incapacidades_quincena: total/días por tipo de una quincena
--
--              Mismo criterio que el catálogo original: INVOKER (sin SECURITY DEFINER) — corren
--              con los privilegios de quien las invoca y la RLS de cada tabla autoriza sola;
--              solo lectura (SELECT); retornan JSONB. Las 3 que aceptan quincena opcional
--              resuelven "la quincena actual" con el MISMO criterio que
--              ia_consultar_quincena_actual (la más reciente por fecha_inicio que no esté
--              'aprobada_cerrada') vía el helper ia_quincena_activa_id().

BEGIN;

-- ============================================================
-- Helper: id de la quincena activa (mismo criterio que ia_consultar_quincena_actual)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_quincena_activa_id()
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_id UUID;
BEGIN
    SELECT id INTO v_id
    FROM public.quincenas
    WHERE tenant_id = v_tenant_id AND estado <> 'aprobada_cerrada' AND deleted_at IS NULL
    ORDER BY fecha_inicio DESC
    LIMIT 1;
    RETURN v_id;
END;
$$;

-- ============================================================
-- 9) Resumen de empleados (total/activos/inactivos + por departamento)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_consultar_resumen_empleados()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_total INT := 0;
    v_activos INT := 0;
    v_inactivos INT := 0;
    v_por_departamento JSONB;
BEGIN
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE estado = 'activo'),
        COUNT(*) FILTER (WHERE estado = 'inactivo')
    INTO v_total, v_activos, v_inactivos
    FROM public.planilla_empleados
    WHERE tenant_id = v_tenant_id AND deleted_at IS NULL;

    -- Agrupa por el texto libre de departamento tal cual viene (sin catálogo propio),
    -- mismo criterio que getEmpleadosPorDepartamento() en planillaEmpleadosService.ts.
    SELECT COALESCE(jsonb_agg(jsonb_build_object('departamento', depto, 'empleados', cnt) ORDER BY cnt DESC), '[]'::jsonb)
    INTO v_por_departamento
    FROM (
        SELECT COALESCE(NULLIF(TRIM(departamento), ''), 'sin departamento') AS depto, COUNT(*) AS cnt
        FROM public.planilla_empleados
        WHERE tenant_id = v_tenant_id AND deleted_at IS NULL AND estado = 'activo'
        GROUP BY 1
    ) t;

    RETURN jsonb_build_object(
        'total', v_total,
        'activos', v_activos,
        'inactivos', v_inactivos,
        'por_departamento', v_por_departamento
    );
END;
$$;

-- ============================================================
-- 10) Anticipos y descuentos activos: saldo pendiente total + detalle por empleado
-- ============================================================
-- "Pendiente" = saldo por cobrar del anticipo/descuento (monto_total - monto_pagado), no el
-- cobro de una quincena puntual — responde "¿cuánto se debe en anticipos/descuentos?".
CREATE OR REPLACE FUNCTION public.ia_consultar_anticipos_descuentos_pendientes()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_anticipos JSONB;
    v_total_anticipos NUMERIC := 0;
    v_descuentos JSONB;
    v_total_descuentos NUMERIC := 0;
BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'empleado', e.nombre_completo,
        'numero_vale', a.numero_vale,
        'tipo', a.tipo,
        'monto_total', a.monto_total,
        'monto_pagado', a.monto_pagado,
        'saldo_pendiente', a.monto_total - a.monto_pagado
    )), '[]'::jsonb), COALESCE(SUM(a.monto_total - a.monto_pagado), 0)
    INTO v_anticipos, v_total_anticipos
    FROM public.planilla_anticipos a
    JOIN public.planilla_empleados e ON e.id = a.empleado_id
    WHERE a.tenant_id = v_tenant_id AND a.estado = 'activo';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'empleado', e.nombre_completo,
        'categoria', c.nombre,
        'monto_total', d.monto_total,
        'monto_pagado', d.monto_pagado,
        'saldo_pendiente', CASE WHEN d.monto_total IS NULL THEN NULL ELSE d.monto_total - d.monto_pagado END
    )), '[]'::jsonb), COALESCE(SUM(d.monto_total - d.monto_pagado), 0)
    INTO v_descuentos, v_total_descuentos
    FROM public.planilla_descuentos d
    JOIN public.planilla_empleados e ON e.id = d.empleado_id
    LEFT JOIN public.planilla_descuento_categorias c ON c.id = d.categoria_id
    WHERE d.tenant_id = v_tenant_id AND d.estado = 'activo' AND d.monto_total IS NOT NULL;

    RETURN jsonb_build_object(
        'total_saldo_pendiente_anticipos', v_total_anticipos,
        'anticipos', v_anticipos,
        'total_saldo_pendiente_descuentos', v_total_descuentos,
        'descuentos', v_descuentos
    );
END;
$$;

-- ============================================================
-- 11) Horas extras de una quincena (opcional; default: la activa)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_consultar_horas_extras_quincena(p_quincena_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_quincena_id UUID := COALESCE(p_quincena_id, public.ia_quincena_activa_id());
    v_etiqueta TEXT;
    v_empleados INT := 0;
    v_hed NUMERIC := 0;
    v_hen NUMERIC := 0;
    v_nocturnidad NUMERIC := 0;
    v_feriado NUMERIC := 0;
    v_monto NUMERIC := 0;
BEGIN
    IF v_quincena_id IS NULL THEN
        RETURN jsonb_build_object('quincena_id', NULL, 'encontrada', false, 'nota', 'No hay ninguna quincena activa en este momento.');
    END IF;

    SELECT etiqueta_estandar INTO v_etiqueta
    FROM public.quincenas
    WHERE id = v_quincena_id AND tenant_id = v_tenant_id;
    IF v_etiqueta IS NULL THEN
        RETURN jsonb_build_object('quincena_id', v_quincena_id, 'encontrada', false, 'nota', 'La quincena no existe o no es visible para este usuario.');
    END IF;

    SELECT
        COUNT(DISTINCT empleado_id),
        COALESCE(SUM(hed), 0),
        COALESCE(SUM(hen), 0),
        COALESCE(SUM(nocturnidad), 0),
        COALESCE(SUM(feriado), 0),
        COALESCE(SUM(monto_total), 0)
    INTO v_empleados, v_hed, v_hen, v_nocturnidad, v_feriado, v_monto
    FROM public.planilla_horas_extras_manual
    WHERE quincena_id = v_quincena_id;

    RETURN jsonb_build_object(
        'quincena_id', v_quincena_id,
        'quincena', v_etiqueta,
        'encontrada', true,
        'empleados_con_horas', v_empleados,
        'total_hed_horas', v_hed,
        'total_hen_horas', v_hen,
        'total_nocturnidad_horas', v_nocturnidad,
        'total_feriado_horas', v_feriado,
        'monto_total', v_monto,
        'nota', 'Incluye las horas consolidadas en planilla_horas_extras_manual (tanto la carga manual como la importación de reloj confirmada).'
    );
END;
$$;

-- ============================================================
-- 12) Próximos feriados del tenant (desde hoy)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_consultar_proximos_feriados(p_limite INT DEFAULT 5)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_result JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'fecha', f.fecha,
        'nombre', COALESCE(NULLIF(f.nombre, ''), 'Feriado')
    ) ORDER BY f.fecha), '[]'::jsonb)
    INTO v_result
    FROM public.planilla_feriados f
    WHERE f.tenant_id = v_tenant_id AND f.fecha >= CURRENT_DATE
    LIMIT GREATEST(COALESCE(p_limite, 5), 1);

    RETURN jsonb_build_object('proximos_feriados', v_result);
END;
$$;

-- ============================================================
-- 13) Incapacidades de una quincena (opcional; default: la activa)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_consultar_incapacidades_quincena(p_quincena_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_quincena_id UUID := COALESCE(p_quincena_id, public.ia_quincena_activa_id());
    v_etiqueta TEXT;
    v_total INT := 0;
    v_dias NUMERIC := 0;
    v_por_tipo JSONB;
BEGIN
    IF v_quincena_id IS NULL THEN
        RETURN jsonb_build_object('quincena_id', NULL, 'encontrada', false, 'nota', 'No hay ninguna quincena activa en este momento.');
    END IF;

    SELECT etiqueta_estandar INTO v_etiqueta
    FROM public.quincenas
    WHERE id = v_quincena_id AND tenant_id = v_tenant_id;
    IF v_etiqueta IS NULL THEN
        RETURN jsonb_build_object('quincena_id', v_quincena_id, 'encontrada', false, 'nota', 'La quincena no existe o no es visible para este usuario.');
    END IF;

    SELECT COUNT(*), COALESCE(SUM(i.dias), 0)
    INTO v_total, v_dias
    FROM public.planilla_incapacidades i
    WHERE i.tenant_id = v_tenant_id AND i.quincena_id = v_quincena_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('tipo', i.tipo, 'registros', cnt, 'dias', dias) ORDER BY cnt DESC), '[]'::jsonb)
    INTO v_por_tipo
    FROM (
        SELECT i.tipo, COUNT(*) AS cnt, COALESCE(SUM(i.dias), 0) AS dias
        FROM public.planilla_incapacidades i
        WHERE i.tenant_id = v_tenant_id AND i.quincena_id = v_quincena_id
        GROUP BY 1
    ) i;

    RETURN jsonb_build_object(
        'quincena_id', v_quincena_id,
        'quincena', v_etiqueta,
        'encontrada', true,
        'total_incapacidades', v_total,
        'total_dias', v_dias,
        'por_tipo', v_por_tipo
    );
END;
$$;

COMMIT;
