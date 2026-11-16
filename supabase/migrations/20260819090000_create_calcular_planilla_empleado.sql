-- Migration: Motor de Cálculo de Planilla — 16 Pasos (IMPL-85 / US-CALC-04, IMPL-90 + US-CALC-05,
--            IMPL-91 + US-CALC-09, IMPL-95)
-- Author: @alexis
-- Description: Un orquestador por empleado (`calcular_planilla_empleado`) + wrapper bulk
--              (`calcular_planilla_quincena`), mismo molde que `calcular_bonos_incentivo_quincena`
--              — un bloque PL/pgSQL único con comentarios de sección por cada uno de los 16
--              pasos (CAs literales de IMPL-90), NO 16 micro-funciones (inconsistente con el
--              estilo del resto del proyecto, sin precedente de tipos compuestos). Sin
--              `SECURITY DEFINER` (INVOKER): las policies de `planilla_calculo_empleado`
--              (gateadas por `quincena.estado='en_proceso'`) son las que autorizan.
--
--              Se extraen 2 funciones auxiliares genuinamente reutilizables:
--              `fn_calcular_renta_isr` (también la usará Aguinaldo, IMPL-96, con otra base) y
--              `fn_aplica_deduccion_fija` (aislada a propósito — IMPL-88 CA4 lo exige
--              explícitamente, para poder cambiar la interpretación sin tocar el motor completo).
--
--              NOTA sobre nombres de columna: `otros_ingresos_no_gravables`/
--              `otros_ingresos_bono10_base` en `planilla_calculo_empleado` agregan TODO ingreso
--              no gravable / base de Bono 10% que no sea viáticos/vacaciones/incapacidad — esto
--              incluye tanto `planilla_otros_ingresos` como bonificaciones manuales marcadas
--              `no_gravable`/`bono_10` (US-BON-03 CA2 permite las 3 gravabilidades en manuales,
--              no solo en Otros Ingresos). El nombre de columna quedó del diseño original
--              (pre-existía la posibilidad de bonificaciones no-gravables); se documenta acá en
--              vez de migrar el esquema, dato de solo lectura para auditoría interna.
--
--              5 decisiones provisionales documentadas (ver planilla-contexto.md para el detalle
--              completo citando los CAs de Jira):
--              1. Deducción fija: proyección anual = sueldo_mensual×12, sin prorratear (IMPL-88 CA3).
--              2. Salario mínimo inembargable: validación apagada mientras config sea NULL (IMPL-95 CA3).
--              3. Excedente de tope 20%: la categoría completa que lo superaría queda diferida, nunca
--                 se fuerza neto negativo (IMPL-95 CA1/CA2).
--              4. Redondeo: ROUND(x,2) después de CADA paso, no solo al final.
--              5. Días laborados: proración solo de ALTAS contra fecha_ingreso; bajas a mitad de
--                 quincena quedan fuera de alcance (requeriría fecha_baja, agregada pero sin uso
--                 todavía).

BEGIN;

-- Reutilizada por el Paso 12 (Renta sobre salario) y, más adelante, por el motor de Aguinaldo
-- (IMPL-96) sobre el excedente de $1,500.
CREATE OR REPLACE FUNCTION public.fn_calcular_renta_isr(
    p_tenant_id UUID,
    p_base NUMERIC,
    p_vigente_desde DATE
) RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
    v_tramo public.planilla_renta_tramos;
BEGIN
    IF p_base <= 0 THEN
        RETURN 0;
    END IF;

    SELECT * INTO v_tramo
    FROM public.planilla_renta_tramos
    WHERE tenant_id = p_tenant_id
      AND vigente_desde = p_vigente_desde
      AND desde <= p_base
      AND (hasta IS NULL OR hasta >= p_base)
    ORDER BY orden
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    RETURN ROUND(GREATEST(0, p_base - v_tramo.exceso_sobre) * v_tramo.tasa_pct + v_tramo.monto_fijo, 2);
END;
$$;

-- AMBIGÜEDAD #1 (IMPL-88 CA3, marcado ⏳ PENDIENTE en Jira) — decisión provisional, aislada acá a
-- propósito (CA4 lo exige) para poder cambiarla sin tocar el resto del motor.
CREATE OR REPLACE FUNCTION public.fn_aplica_deduccion_fija(
    p_sueldo_mensual NUMERIC,
    p_deduccion_fija_anual NUMERIC,
    p_tope_ingreso_anual NUMERIC,
    OUT o_aplica BOOLEAN,
    OUT o_monto NUMERIC,
    OUT o_motivo TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_proyeccion_anual NUMERIC;
BEGIN
    v_proyeccion_anual := ROUND(p_sueldo_mensual * 12, 2);
    o_aplica := v_proyeccion_anual <= p_tope_ingreso_anual;
    o_monto := CASE WHEN o_aplica THEN ROUND(p_deduccion_fija_anual / 24, 2) ELSE 0 END;
    o_motivo := format(
        'Ingreso anual proyectado $%s %s tope $%s — decisión provisional IMPL-88 CA3 (sin recalcular con variable pagado, sin prorratear)',
        v_proyeccion_anual, CASE WHEN o_aplica THEN '<=' ELSE '>' END, p_tope_ingreso_anual
    );
END;
$$;

-- Orquestador core — una fila (quincena, empleado). Testeado contra el mirror TS
-- (src/utils/calculoPlanillaUtils.ts) y, cuando existan, los 3 casos reales (Manzo/Solorzano/
-- Batres).
CREATE OR REPLACE FUNCTION public.calcular_planilla_empleado(
    p_quincena_id UUID,
    p_empleado_id UUID,
    p_user_id UUID
) RETURNS public.planilla_calculo_empleado
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID;
    v_empleado public.planilla_empleados;
    v_quincena public.quincenas;
    v_config public.planilla_config_fiscal;
    v_tramos_vigente_desde DATE;

    v_dias_laborados NUMERIC;
    v_sueldo_quincenal NUMERIC;
    v_sueldo_proporcional NUMERIC;

    v_horas_extras NUMERIC;

    v_viaticos_monto NUMERIC := 0;
    v_viaticos_bono10 NUMERIC := 0;

    v_vacaciones_gravable NUMERIC := 0;
    v_vacaciones_bono10 NUMERIC := 0;

    v_bonificaciones_gravable NUMERIC := 0;
    v_bonificaciones_no_gravable NUMERIC := 0;
    v_bonificaciones_bono10 NUMERIC := 0;

    v_otros_ing_gravable NUMERIC := 0;
    v_otros_ing_no_gravable NUMERIC := 0;
    v_otros_ing_bono10 NUMERIC := 0;

    v_incapacidad_bono10 NUMERIC := 0;

    v_total_gravable NUMERIC;
    v_total_no_gravable NUMERIC;

    v_isss NUMERIC;
    v_afp NUMERIC;
    v_deduccion_fija RECORD;
    v_base_renta NUMERIC;
    v_renta_isr NUMERIC;

    v_base_bono10_total NUMERIC;
    v_renta_bono10 NUMERIC;

    v_item RECORD;
    v_descuentos_obligatorios_total NUMERIC;
    v_tope_20 NUMERIC;
    v_no_obligatorios_solicitado NUMERIC := 0;
    v_no_obligatorios_aplicado NUMERIC := 0;
    v_excedente_diferido NUMERIC := 0;
    v_alerta_tope BOOLEAN := false;
    v_detalle JSONB := '[]'::JSONB;
    v_acumulado NUMERIC := 0;

    v_neto NUMERIC;
    v_alerta_minimo BOOLEAN := false;

    v_result public.planilla_calculo_empleado;
BEGIN
    SELECT * INTO v_empleado FROM public.planilla_empleados WHERE id = p_empleado_id;
    SELECT * INTO v_quincena FROM public.quincenas WHERE id = p_quincena_id;
    v_tenant_id := v_quincena.tenant_id;

    IF v_quincena.estado != 'en_proceso' THEN
        RAISE EXCEPTION 'No se puede calcular planilla: la quincena % no está en_proceso', p_quincena_id;
    END IF;

    -- CA4 de US-CALC-10 (Aguinaldo, IMPL-96): "se procesa en una planilla separada, no mezclada
    -- con la quincena normal" — este motor es solo para quincenas normales; Aguinaldo tiene su
    -- propio orquestador (calcular_aguinaldo_empleado) para no pisar el snapshot ya calculado.
    IF v_quincena.tipo != 'normal' THEN
        RAISE EXCEPTION 'calcular_planilla_empleado solo aplica a quincenas tipo normal (quincena % es tipo %). Aguinaldo usa calcular_aguinaldo_empleado.', p_quincena_id, v_quincena.tipo;
    END IF;

    -- Resuelve la vigencia fiscal aplicable a la fecha de fin de la quincena — se congela como
    -- config_fiscal_id en el snapshot, inmutable para siempre.
    SELECT * INTO v_config
    FROM public.planilla_config_fiscal
    WHERE tenant_id = v_tenant_id
      AND vigente_desde <= v_quincena.fecha_fin
      AND (vigente_hasta IS NULL OR vigente_hasta >= v_quincena.fecha_fin)
    ORDER BY vigente_desde DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No hay configuración fiscal vigente para la fecha %', v_quincena.fecha_fin;
    END IF;

    SELECT vigente_desde INTO v_tramos_vigente_desde
    FROM public.planilla_renta_tramos
    WHERE tenant_id = v_tenant_id AND vigente_desde <= v_quincena.fecha_fin
    ORDER BY vigente_desde DESC
    LIMIT 1;

    -- ===== Pasos 1-2: Sueldo base y proporcional (US-CALC-00/IMPL-86) =====
    -- AMBIGÜEDAD #5: solo prorratea ALTAS contra fecha_ingreso (dato ya firme); bajas a mitad de
    -- quincena quedan fuera de alcance (fecha_baja existe pero el motor no la consume todavía).
    v_sueldo_quincenal := ROUND(v_empleado.sueldo_mensual / 2, 2);
    v_dias_laborados := GREATEST(0, LEAST(
        v_quincena.dias_habiles,
        (v_quincena.fecha_fin - GREATEST(v_quincena.fecha_inicio, v_empleado.fecha_ingreso) + 1)
    ));
    v_sueldo_proporcional := ROUND(v_sueldo_quincenal * (v_dias_laborados / NULLIF(v_quincena.dias_habiles, 0)), 2);

    -- ===== Paso 3: Horas Extras (ya calculadas en la épica Horas Extras, IMPL-20) =====
    SELECT COALESCE(SUM(monto_total), 0) INTO v_horas_extras
    FROM public.planilla_horas_extras_manual
    WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;

    -- ===== Paso 4: Viáticos (no gravable, salvo excepción Bono 10% sobre viático GG fijo) =====
    SELECT
        COALESCE(SUM(CASE WHEN tipo = 'fijo' AND v_empleado.retencion_especial_viatico THEN 0 ELSE monto END), 0),
        COALESCE(SUM(CASE WHEN tipo = 'fijo' AND v_empleado.retencion_especial_viatico THEN monto ELSE 0 END), 0)
    INTO v_viaticos_monto, v_viaticos_bono10
    FROM public.planilla_viaticos_fijos_variables
    WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;

    v_viaticos_monto := v_viaticos_monto + (
        SELECT COALESCE(SUM(monto), 0) FROM public.planilla_viaticos_por_ruta
        WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id
    ) + (
        SELECT COALESCE(SUM(monto), 0) FROM public.planilla_viaticos_kilometraje
        WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id
    );

    -- ===== Paso 5: Vacaciones — no_gozada se trata como Bono 10%, no como salario ordinario =====
    SELECT
        COALESCE(SUM(monto_total) FILTER (WHERE NOT no_gozada), 0),
        COALESCE(SUM(monto_total) FILTER (WHERE no_gozada), 0)
    INTO v_vacaciones_gravable, v_vacaciones_bono10
    FROM public.planilla_vacaciones
    WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;

    -- ===== Paso 6: Bonificaciones — automáticas siempre gravables (US-BON-02 CA2); manuales
    -- pueden ser gravable/no_gravable/bono_10 (US-BON-03 CA2) =====
    SELECT
        COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'gravable'), 0),
        COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'no_gravable'), 0),
        COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'bono_10'), 0)
    INTO v_bonificaciones_gravable, v_bonificaciones_no_gravable, v_bonificaciones_bono10
    FROM public.planilla_bonificaciones
    WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;

    -- ===== Paso 7 + Paso 15: Otros Ingresos, por gravabilidad (US-OTR-01 CA2, 3 estados) =====
    SELECT
        COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'gravable'), 0),
        COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'no_gravable'), 0),
        COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'bono_10'), 0)
    INTO v_otros_ing_gravable, v_otros_ing_no_gravable, v_otros_ing_bono10
    FROM public.planilla_otros_ingresos
    WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;

    -- Incapacidad trabajada — 3ra fuente de Bono 10% (gap documentado: 3 tablas distintas)
    SELECT COALESCE(SUM(monto_bono_trabajado), 0) INTO v_incapacidad_bono10
    FROM public.planilla_incapacidades
    WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id AND trabajo_durante_incapacidad = true;

    -- ===== Paso 8: Total Ingresos Gravables (viáticos del Paso 4 quedan EXCLUIDOS) =====
    v_total_gravable := ROUND(
        v_sueldo_proporcional + v_horas_extras + v_vacaciones_gravable + v_bonificaciones_gravable + v_otros_ing_gravable,
        2
    );
    v_total_no_gravable := ROUND(v_viaticos_monto + v_bonificaciones_no_gravable + v_otros_ing_no_gravable, 2);

    -- ===== Pasos 9-10: ISSS y AFP (US-CALC-01/IMPL-87) =====
    v_isss := ROUND(LEAST(v_total_gravable, v_config.isss_tope_base) * v_config.isss_tasa_empleado, 2);
    v_afp := ROUND(
        (CASE WHEN v_config.afp_tope_base IS NULL THEN v_total_gravable ELSE LEAST(v_total_gravable, v_config.afp_tope_base) END)
        * v_config.afp_tasa_empleado,
        2
    );

    -- ===== Paso 11: Base Renta (deducción fija — AMBIGÜEDAD #1) =====
    SELECT * INTO v_deduccion_fija
    FROM public.fn_aplica_deduccion_fija(v_empleado.sueldo_mensual, v_config.deduccion_fija_anual, v_config.deduccion_fija_tope_ingreso_anual);
    v_base_renta := GREATEST(0, ROUND(v_total_gravable - v_isss - v_afp - v_deduccion_fija.o_monto, 2));

    -- ===== Paso 12: Renta ISR sobre salario =====
    v_renta_isr := public.fn_calcular_renta_isr(v_tenant_id, v_base_renta, v_tramos_vigente_desde);

    -- ===== Paso 13: Renta ISR sobre Bono 10% (US-CALC-05/IMPL-91) — línea SEPARADA =====
    v_base_bono10_total := ROUND(
        v_viaticos_bono10 + v_vacaciones_bono10 + v_bonificaciones_bono10 + v_otros_ing_bono10 + v_incapacidad_bono10,
        2
    );
    v_renta_bono10 := ROUND(v_base_bono10_total * v_config.bono10_tasa, 2);

    -- ===== Paso 14: Descuentos — orden de prioridad + tope 20% (US-CALC-09/IMPL-95) =====
    -- AMBIGÜEDAD #3: la categoría completa que superaría el tope queda DIFERIDA esa quincena
    -- (se reintenta la próxima corrida); nunca se fuerza neto negativo.
    v_descuentos_obligatorios_total := ROUND(v_isss + v_afp + v_renta_isr + v_renta_bono10, 2);
    v_tope_20 := ROUND(v_sueldo_quincenal * v_config.tope_descuentos_no_obligatorios_pct, 2);

    FOR v_item IN
        SELECT d.monto, CASE
            WHEN c.nombre ILIKE '%préstamo%' OR c.nombre ILIKE '%financiera%' OR c.nombre ILIKE '%vehículo%' THEN 4
            WHEN c.nombre ILIKE '%vivienda%' THEN 5
            WHEN c.nombre ILIKE '%uniforme%' OR c.nombre ILIKE '%lentes%' THEN 6
            ELSE 8
        END AS prioridad, c.nombre AS categoria
        FROM public.planilla_descuento_eventos e
        JOIN public.planilla_descuentos d ON d.id = e.descuento_id
        JOIN public.planilla_descuento_categorias c ON c.id = d.categoria_id
        WHERE e.quincena_id = p_quincena_id AND e.tipo = 'pago' AND d.empleado_id = p_empleado_id

        UNION ALL

        SELECT p.monto, 7 AS prioridad, 'Anticipo de salario' AS categoria
        FROM public.planilla_anticipo_pagos p
        JOIN public.planilla_anticipos a ON a.id = p.anticipo_id
        WHERE p.quincena_id = p_quincena_id AND p.tipo = 'pago' AND a.empleado_id = p_empleado_id

        ORDER BY prioridad
    LOOP
        v_no_obligatorios_solicitado := ROUND(v_no_obligatorios_solicitado + v_item.monto, 2);
        IF ROUND(v_acumulado + v_item.monto, 2) <= v_tope_20 THEN
            v_acumulado := ROUND(v_acumulado + v_item.monto, 2);
            v_no_obligatorios_aplicado := v_acumulado;
            v_detalle := v_detalle || jsonb_build_object('categoria', v_item.categoria, 'monto', v_item.monto, 'aplicado', v_item.monto, 'diferido', 0);
        ELSE
            v_excedente_diferido := ROUND(v_excedente_diferido + v_item.monto, 2);
            v_alerta_tope := true;
            v_detalle := v_detalle || jsonb_build_object('categoria', v_item.categoria, 'monto', v_item.monto, 'aplicado', 0, 'diferido', v_item.monto);
        END IF;
    END LOOP;

    -- ===== Paso 16: NETO A PAGAR =====
    v_neto := ROUND(
        v_total_gravable + v_total_no_gravable - v_isss - v_afp - v_renta_isr - v_renta_bono10 - v_no_obligatorios_aplicado,
        2
    );

    -- AMBIGÜEDAD #2 (IMPL-95 CA3, marcado ⚠️ Pendiente): validación apagada mientras
    -- salario_minimo_inembargable sea NULL.
    IF v_config.salario_minimo_inembargable IS NOT NULL AND v_neto < v_config.salario_minimo_inembargable THEN
        v_alerta_minimo := true;
    END IF;

    INSERT INTO public.planilla_calculo_empleado (
        tenant_id, quincena_id, empleado_id,
        dias_habiles_quincena, dias_laborados, sueldo_quincenal_base, sueldo_proporcional,
        horas_extras_monto,
        viaticos_monto, viaticos_bono10_base,
        vacaciones_monto, vacaciones_bono10_base,
        bonificaciones_monto,
        otros_ingresos_gravables, otros_ingresos_no_gravables, otros_ingresos_bono10_base,
        incapacidad_bono10_base,
        total_ingresos_gravables,
        isss_empleado, afp_empleado,
        deduccion_fija_aplicada, deduccion_fija_motivo, base_renta,
        renta_isr,
        base_bono10_total, renta_bono10,
        descuentos_obligatorios_total, descuentos_no_obligatorios_solicitado, descuentos_no_obligatorios_aplicado,
        descuentos_tope_20_base, descuentos_excedente_diferido, descuentos_alerta_tope_superado,
        alerta_neto_bajo_minimo, descuentos_detalle,
        total_no_gravable, neto_a_pagar,
        isss_patronal, afp_patronal, insaforp_patronal,
        config_fiscal_id, tramos_renta_vigente_desde, tipo_quincena,
        calculado_por
    ) VALUES (
        v_tenant_id, p_quincena_id, p_empleado_id,
        v_quincena.dias_habiles, v_dias_laborados, v_sueldo_quincenal, v_sueldo_proporcional,
        v_horas_extras,
        v_viaticos_monto, v_viaticos_bono10,
        v_vacaciones_gravable, v_vacaciones_bono10,
        v_bonificaciones_gravable,
        v_otros_ing_gravable, ROUND(v_otros_ing_no_gravable + v_bonificaciones_no_gravable, 2), ROUND(v_otros_ing_bono10 + v_bonificaciones_bono10, 2),
        v_incapacidad_bono10,
        v_total_gravable,
        v_isss, v_afp,
        v_deduccion_fija.o_monto, v_deduccion_fija.o_motivo, v_base_renta,
        v_renta_isr,
        v_base_bono10_total, v_renta_bono10,
        v_descuentos_obligatorios_total, v_no_obligatorios_solicitado, v_no_obligatorios_aplicado,
        v_tope_20, v_excedente_diferido, v_alerta_tope,
        v_alerta_minimo, v_detalle,
        v_total_no_gravable, v_neto,
        ROUND(v_total_gravable * v_config.isss_tasa_patronal, 2),
        ROUND((CASE WHEN v_config.afp_tope_base IS NULL THEN v_total_gravable ELSE LEAST(v_total_gravable, v_config.afp_tope_base) END) * v_config.afp_tasa_patronal, 2),
        ROUND(v_sueldo_quincenal * v_config.insaforp_tasa_patronal, 2),
        v_config.id, v_tramos_vigente_desde, v_quincena.tipo,
        p_user_id
    )
    ON CONFLICT (quincena_id, empleado_id) DO UPDATE SET
        dias_habiles_quincena = EXCLUDED.dias_habiles_quincena,
        dias_laborados = EXCLUDED.dias_laborados,
        sueldo_quincenal_base = EXCLUDED.sueldo_quincenal_base,
        sueldo_proporcional = EXCLUDED.sueldo_proporcional,
        horas_extras_monto = EXCLUDED.horas_extras_monto,
        viaticos_monto = EXCLUDED.viaticos_monto,
        viaticos_bono10_base = EXCLUDED.viaticos_bono10_base,
        vacaciones_monto = EXCLUDED.vacaciones_monto,
        vacaciones_bono10_base = EXCLUDED.vacaciones_bono10_base,
        bonificaciones_monto = EXCLUDED.bonificaciones_monto,
        otros_ingresos_gravables = EXCLUDED.otros_ingresos_gravables,
        otros_ingresos_no_gravables = EXCLUDED.otros_ingresos_no_gravables,
        otros_ingresos_bono10_base = EXCLUDED.otros_ingresos_bono10_base,
        incapacidad_bono10_base = EXCLUDED.incapacidad_bono10_base,
        total_ingresos_gravables = EXCLUDED.total_ingresos_gravables,
        isss_empleado = EXCLUDED.isss_empleado,
        afp_empleado = EXCLUDED.afp_empleado,
        deduccion_fija_aplicada = EXCLUDED.deduccion_fija_aplicada,
        deduccion_fija_motivo = EXCLUDED.deduccion_fija_motivo,
        base_renta = EXCLUDED.base_renta,
        renta_isr = EXCLUDED.renta_isr,
        base_bono10_total = EXCLUDED.base_bono10_total,
        renta_bono10 = EXCLUDED.renta_bono10,
        descuentos_obligatorios_total = EXCLUDED.descuentos_obligatorios_total,
        descuentos_no_obligatorios_solicitado = EXCLUDED.descuentos_no_obligatorios_solicitado,
        descuentos_no_obligatorios_aplicado = EXCLUDED.descuentos_no_obligatorios_aplicado,
        descuentos_tope_20_base = EXCLUDED.descuentos_tope_20_base,
        descuentos_excedente_diferido = EXCLUDED.descuentos_excedente_diferido,
        descuentos_alerta_tope_superado = EXCLUDED.descuentos_alerta_tope_superado,
        alerta_neto_bajo_minimo = EXCLUDED.alerta_neto_bajo_minimo,
        descuentos_detalle = EXCLUDED.descuentos_detalle,
        total_no_gravable = EXCLUDED.total_no_gravable,
        neto_a_pagar = EXCLUDED.neto_a_pagar,
        isss_patronal = EXCLUDED.isss_patronal,
        afp_patronal = EXCLUDED.afp_patronal,
        insaforp_patronal = EXCLUDED.insaforp_patronal,
        config_fiscal_id = EXCLUDED.config_fiscal_id,
        tramos_renta_vigente_desde = EXCLUDED.tramos_renta_vigente_desde,
        tipo_quincena = EXCLUDED.tipo_quincena,
        calculado_por = p_user_id,
        calculado_at = now(),
        updated_at = now()
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

-- Wrapper bulk — botón "Calcular planilla de esta quincena". Mismo criterio que
-- calcular_bonos_incentivo_quincena: recorre empleados activos, RETURN NEXT por cada uno.
CREATE OR REPLACE FUNCTION public.calcular_planilla_quincena(
    p_quincena_id UUID,
    p_user_id UUID
) RETURNS SETOF public.planilla_calculo_empleado
LANGUAGE plpgsql
AS $$
DECLARE
    v_empleado RECORD;
BEGIN
    FOR v_empleado IN
        SELECT pe.id FROM public.planilla_empleados pe
        JOIN public.quincenas q ON q.tenant_id = pe.tenant_id
        WHERE q.id = p_quincena_id AND pe.tenant_id = public.get_auth_tenant_id()
          AND pe.estado = 'activo' AND pe.deleted_at IS NULL
    LOOP
        RETURN NEXT public.calcular_planilla_empleado(p_quincena_id, v_empleado.id, p_user_id);
    END LOOP;

    RETURN;
END;
$$;

COMMIT;
