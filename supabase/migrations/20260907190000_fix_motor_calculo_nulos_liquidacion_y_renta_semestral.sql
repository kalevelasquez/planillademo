-- Migration: Motor de Cálculo — 3 bugs críticos encontrados en auditoría (2026-08-13)
-- Author: @alexis
-- Description: Auditoría crítica módulo por módulo (a pedido del usuario) encontró 3 gaps
--              reales de plata/cumplimiento en el motor de cálculo:
--
--              1. `sueldo_mensual` NULL (posible desde que el campo se relajó a opcional en
--                 20260906090600) propagaba NULL por toda la aritmética hasta violar un
--                 NOT NULL en el INSERT — como `calcular_planilla_quincena` procesa a todos los
--                 empleados dentro de la misma transacción implícita, ESE error revertía a
--                 TODOS los empleados ya calculados en la misma corrida. Fix: `COALESCE(...,0)`
--                 en el Paso 1-2, y la corrida bulk ahora aísla cada empleado en su propio
--                 sub-bloque (ver punto 3) para que ningún fallo individual tumbe el resto.
--
--              2. Un empleado liquidado (`estado='inactivo'`) a mitad de quincena: (a) por
--                 defecto quedaba invisible (sin fila, sin pago) salvo que tuviera horas extra
--                 pendientes (parche de 20260907150000, demasiado angosto), y (b) incluso en ese
--                 caso puntual, `v_dias_laborados` nunca leía `fecha_baja` — se le pagaba el
--                 período COMPLETO como si siguiera activo. El código de trabajo salvadoreño
--                 exige pagar los días efectivamente trabajados hasta la liquidación. Fix:
--                 se generaliza la inclusión a cualquier inactivo cuya `fecha_baja` caiga dentro
--                 o después del inicio de la quincena (se mantiene el chequeo de horas extra
--                 como red de seguridad adicional), y `v_dias_laborados` ahora topea el límite
--                 superior con `fecha_baja`, igual que ya topeaba el inferior con `fecha_ingreso`.
--
--              3. `recalcular_renta_semestral` aplica un ajuste ADITIVO sobre `renta_isr`/
--                 `neto_a_pagar`, pero `calcular_planilla_empleado` (vía `ON CONFLICT DO UPDATE`)
--                 recalcula esas mismas columnas DESDE CERO en cualquier corrida posterior de
--                 "Calcular Planilla" — un uso completamente normal (ej. corregir un dato tarde)
--                 borra el ajuste semestral en silencio, sin ningún registro de que existió. Fix:
--                 se agregan 2 columnas (`renta_semestral_diferencia`, `renta_semestral_ajustada_at`)
--                 que persisten el ajuste ya aplicado; el `ON CONFLICT DO UPDATE` ahora recalcula
--                 `renta_isr`/`neto_a_pagar` desde los datos fuente y LUEGO re-aplica encima
--                 cualquier diferencia semestral ya registrada — el ajuste sobrevive a cualquier
--                 recálculo posterior en vez de perderse.
--
--              Todos los `BEGIN/EXCEPTION` por paso (IMPL-114 CA2, 20260907120000) se preservan
--              intactos — solo cambian los Pasos 1-2 y el guardado final.

BEGIN;

ALTER TABLE public.planilla_calculo_empleado
    ADD COLUMN IF NOT EXISTS renta_semestral_diferencia NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS renta_semestral_ajustada_at TIMESTAMPTZ;

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
    v_empleado_ref TEXT;
BEGIN
    SELECT * INTO v_empleado FROM public.planilla_empleados WHERE id = p_empleado_id;
    SELECT * INTO v_quincena FROM public.quincenas WHERE id = p_quincena_id;
    v_tenant_id := v_quincena.tenant_id;
    v_empleado_ref := COALESCE(v_empleado.nombre_completo, p_empleado_id::TEXT);

    IF v_quincena.estado != 'en_proceso' THEN
        RAISE EXCEPTION 'No se puede calcular planilla: la quincena % no está en_proceso', p_quincena_id;
    END IF;

    IF v_quincena.tipo != 'normal' THEN
        RAISE EXCEPTION 'calcular_planilla_empleado solo aplica a quincenas tipo normal (quincena % es tipo %). Aguinaldo usa calcular_aguinaldo_empleado.', p_quincena_id, v_quincena.tipo;
    END IF;

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
    -- Bugfix (auditoría): sueldo_mensual NULL ya no propaga NULL (COALESCE a 0, en vez de
    -- abortar el cálculo). fecha_baja ahora topea el límite SUPERIOR de días laborados, igual
    -- que fecha_ingreso ya topeaba el inferior — antes un liquidado a mitad de quincena se
    -- pagaba el período completo como si siguiera activo.
    BEGIN
        v_sueldo_quincenal := ROUND(COALESCE(v_empleado.sueldo_mensual, 0) / 2, 2);
        v_dias_laborados := GREATEST(0, LEAST(
            v_quincena.dias_habiles,
            (LEAST(v_quincena.fecha_fin, COALESCE(v_empleado.fecha_baja, v_quincena.fecha_fin))
                - GREATEST(v_quincena.fecha_inicio, v_empleado.fecha_ingreso) + 1)
        ));
        v_sueldo_proporcional := ROUND(v_sueldo_quincenal * (v_dias_laborados / NULLIF(v_quincena.dias_habiles, 0)), 2);
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 1-2 (Sueldo base y proporcional) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 3: Horas Extras (ya calculadas en la épica Horas Extras, IMPL-20) =====
    BEGIN
        SELECT COALESCE(SUM(monto_total), 0) INTO v_horas_extras
        FROM public.planilla_horas_extras_manual
        WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 3 (Horas Extras) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 4: Viáticos (no gravable, salvo excepción Bono 10% sobre viático GG fijo) =====
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 4 (Viáticos) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 5: Vacaciones — no_gozada se trata como Bono 10%, no como salario ordinario =====
    BEGIN
        SELECT
            COALESCE(SUM(monto_total) FILTER (WHERE NOT no_gozada), 0),
            COALESCE(SUM(monto_total) FILTER (WHERE no_gozada), 0)
        INTO v_vacaciones_gravable, v_vacaciones_bono10
        FROM public.planilla_vacaciones
        WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 5 (Vacaciones) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 6: Bonificaciones — automáticas siempre gravables (US-BON-02 CA2); manuales
    -- pueden ser gravable/no_gravable/bono_10 (US-BON-03 CA2) =====
    BEGIN
        SELECT
            COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'gravable'), 0),
            COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'no_gravable'), 0),
            COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'bono_10'), 0)
        INTO v_bonificaciones_gravable, v_bonificaciones_no_gravable, v_bonificaciones_bono10
        FROM public.planilla_bonificaciones
        WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 6 (Bonificaciones) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 7 + Paso 15: Otros Ingresos, por gravabilidad (US-OTR-01 CA2, 3 estados) =====
    BEGIN
        SELECT
            COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'gravable'), 0),
            COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'no_gravable'), 0),
            COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'bono_10'), 0)
        INTO v_otros_ing_gravable, v_otros_ing_no_gravable, v_otros_ing_bono10
        FROM public.planilla_otros_ingresos
        WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;

        SELECT COALESCE(SUM(monto_bono_trabajado), 0) INTO v_incapacidad_bono10
        FROM public.planilla_incapacidades
        WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id AND trabajo_durante_incapacidad = true;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 7/15 (Otros Ingresos) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 8: Total Ingresos Gravables (viáticos del Paso 4 quedan EXCLUIDOS) =====
    BEGIN
        v_total_gravable := ROUND(
            v_sueldo_proporcional + v_horas_extras + v_vacaciones_gravable + v_bonificaciones_gravable + v_otros_ing_gravable,
            2
        );
        v_total_no_gravable := ROUND(v_viaticos_monto + v_bonificaciones_no_gravable + v_otros_ing_no_gravable, 2);
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 8 (Total Ingresos Gravables) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Pasos 9-10: ISSS y AFP (US-CALC-01/IMPL-87) =====
    BEGIN
        v_isss := ROUND(LEAST(v_total_gravable, v_config.isss_tope_base) * v_config.isss_tasa_empleado, 2);
        v_afp := CASE
            WHEN v_empleado.tipo_afiliacion = 'jubilado' THEN 0
            ELSE ROUND(
                (CASE WHEN v_config.afp_tope_base IS NULL THEN v_total_gravable ELSE LEAST(v_total_gravable, v_config.afp_tope_base) END)
                * v_config.afp_tasa_empleado,
                2
            )
        END;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 9-10 (ISSS y AFP) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 11: Base Renta (deducción fija — AMBIGÜEDAD #1) =====
    BEGIN
        SELECT * INTO v_deduccion_fija
        FROM public.fn_aplica_deduccion_fija(v_empleado.sueldo_mensual, v_config.deduccion_fija_anual, v_config.deduccion_fija_tope_ingreso_anual);
        v_base_renta := GREATEST(0, ROUND(v_total_gravable - v_isss - v_afp - v_deduccion_fija.o_monto, 2));
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 11 (Base Renta) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 12: Renta ISR sobre salario =====
    BEGIN
        v_renta_isr := public.fn_calcular_renta_isr(v_tenant_id, v_base_renta, v_tramos_vigente_desde);
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 12 (Renta ISR sobre salario) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 13: Renta ISR sobre Bono 10% (US-CALC-05/IMPL-91) — línea SEPARADA =====
    BEGIN
        v_base_bono10_total := ROUND(
            v_viaticos_bono10 + v_vacaciones_bono10 + v_bonificaciones_bono10 + v_otros_ing_bono10 + v_incapacidad_bono10,
            2
        );
        v_renta_bono10 := ROUND(v_base_bono10_total * v_config.bono10_tasa, 2);
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 13 (Renta ISR sobre Bono 10%%) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 14: Descuentos — orden de prioridad + tope 20% (US-CALC-09/IMPL-95) =====
    BEGIN
        v_descuentos_obligatorios_total := ROUND(v_isss + v_afp + v_renta_isr + v_renta_bono10, 2);
        v_tope_20 := ROUND(v_sueldo_quincenal * v_config.tope_descuentos_no_obligatorios_pct, 2);

        FOR v_item IN
            SELECT d.monto, c.tipo, CASE
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

            SELECT p.monto, 'variable' AS tipo, 7 AS prioridad, 'Anticipo de salario' AS categoria
            FROM public.planilla_anticipo_pagos p
            JOIN public.planilla_anticipos a ON a.id = p.anticipo_id
            WHERE p.quincena_id = p_quincena_id AND p.tipo = 'pago' AND a.empleado_id = p_empleado_id

            ORDER BY prioridad
        LOOP
            v_no_obligatorios_solicitado := ROUND(v_no_obligatorios_solicitado + v_item.monto, 2);
            IF v_item.tipo = 'fijo' THEN
                v_no_obligatorios_aplicado := ROUND(v_no_obligatorios_aplicado + v_item.monto, 2);
                v_detalle := v_detalle || jsonb_build_object('categoria', v_item.categoria, 'monto', v_item.monto, 'aplicado', v_item.monto, 'diferido', 0);
            ELSIF ROUND(v_acumulado + v_item.monto, 2) <= v_tope_20 THEN
                v_acumulado := ROUND(v_acumulado + v_item.monto, 2);
                v_no_obligatorios_aplicado := ROUND(v_no_obligatorios_aplicado + v_item.monto, 2);
                v_detalle := v_detalle || jsonb_build_object('categoria', v_item.categoria, 'monto', v_item.monto, 'aplicado', v_item.monto, 'diferido', 0);
            ELSE
                v_excedente_diferido := ROUND(v_excedente_diferido + v_item.monto, 2);
                v_alerta_tope := true;
                v_detalle := v_detalle || jsonb_build_object('categoria', v_item.categoria, 'monto', v_item.monto, 'aplicado', 0, 'diferido', v_item.monto);
            END IF;
        END LOOP;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 14 (Descuentos) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 16: NETO A PAGAR =====
    BEGIN
        v_neto := ROUND(
            v_total_gravable + v_total_no_gravable - v_isss - v_afp - v_renta_isr - v_renta_bono10 - v_no_obligatorios_aplicado,
            2
        );

        IF v_config.salario_minimo_inembargable IS NOT NULL AND v_neto < v_config.salario_minimo_inembargable THEN
            v_alerta_minimo := true;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 16 (Neto a Pagar) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    BEGIN
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
            -- Bugfix (auditoría, hallazgo crítico #4): antes esto pisaba renta_isr/neto_a_pagar
            -- desde cero, borrando en silencio cualquier ajuste semestral ya aplicado por
            -- recalcular_renta_semestral. Ahora se recalcula desde los datos fuente y se
            -- re-aplica encima la diferencia semestral ya registrada (0 si nunca se ajustó).
            renta_isr = EXCLUDED.renta_isr + public.planilla_calculo_empleado.renta_semestral_diferencia,
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
            neto_a_pagar = EXCLUDED.neto_a_pagar - public.planilla_calculo_empleado.renta_semestral_diferencia,
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
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Guardado del resultado (INSERT/UPDATE planilla_calculo_empleado) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    RETURN v_result;
END;
$$;

-- Bugfix (auditoría, hallazgo crítico #2 y #3): la corrida bulk ahora (a) incluye a cualquier
-- inactivo cuya fecha_baja caiga dentro o después del inicio de la quincena (liquidación a
-- mitad de período, generaliza el parche angosto de 20260907150000 que solo cubría horas
-- extra pendientes), y (b) aísla cada empleado en su propio sub-bloque — si UNO falla (ej. un
-- dato corrupto que ningún COALESCE anticipó), se registra una advertencia y se sigue con el
-- resto, en vez de revertir toda la corrida.
CREATE OR REPLACE FUNCTION public.calcular_planilla_quincena(
    p_quincena_id UUID,
    p_user_id UUID
) RETURNS SETOF public.planilla_calculo_empleado
LANGUAGE plpgsql
AS $$
DECLARE
    v_empleado RECORD;
    v_row public.planilla_calculo_empleado;
BEGIN
    FOR v_empleado IN
        SELECT pe.id FROM public.planilla_empleados pe
        JOIN public.quincenas q ON q.tenant_id = pe.tenant_id
        WHERE q.id = p_quincena_id AND pe.tenant_id = public.get_auth_tenant_id()
          AND pe.deleted_at IS NULL
          AND (
              pe.estado = 'activo'
              OR (pe.estado = 'inactivo' AND pe.fecha_baja IS NOT NULL AND pe.fecha_baja >= q.fecha_inicio)
              OR EXISTS (
                  SELECT 1 FROM public.planilla_horas_extras_manual hem
                  WHERE hem.quincena_id = p_quincena_id AND hem.empleado_id = pe.id
              )
          )
    LOOP
        BEGIN
            v_row := public.calcular_planilla_empleado(p_quincena_id, v_empleado.id, p_user_id);
            RETURN NEXT v_row;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'calcular_planilla_quincena: no se pudo calcular el empleado % — %', v_empleado.id, SQLERRM;
        END;
    END LOOP;

    RETURN;
END;
$$;

-- Bugfix (auditoría, hallazgo crítico #4): registra el ajuste semestral en columnas dedicadas
-- para que calcular_planilla_empleado pueda re-aplicarlo tras cualquier recálculo posterior.
CREATE OR REPLACE FUNCTION public.recalcular_renta_semestral(
    p_quincena_id UUID,
    p_user_id UUID
) RETURNS SETOF public.planilla_calculo_empleado
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID;
    v_quincena public.quincenas;
    v_anio INT;
    v_periodo TEXT;
    v_empleado RECORD;
    v_gravable_acumulado NUMERIC;
    v_renta_retenida_acumulada NUMERIC;
    v_tramos_vigente_desde DATE;
    v_renta_esperada NUMERIC;
    v_diferencia NUMERIC;
    v_row public.planilla_calculo_empleado;
BEGIN
    SELECT * INTO v_quincena FROM public.quincenas WHERE id = p_quincena_id;
    v_tenant_id := v_quincena.tenant_id;
    v_anio := EXTRACT(YEAR FROM v_quincena.fecha_fin);

    IF v_quincena.tipo != 'normal' OR EXTRACT(DAY FROM v_quincena.fecha_fin) < 16
       OR EXTRACT(MONTH FROM v_quincena.fecha_fin) NOT IN (6, 12) THEN
        RAISE EXCEPTION 'El recálculo de Renta semestral solo aplica a la 2ª quincena de junio o diciembre (US-CALC-08 CA1/CA2)';
    END IF;

    v_periodo := CASE WHEN EXTRACT(MONTH FROM v_quincena.fecha_fin) = 6 THEN 'semestral_junio' ELSE 'anual_diciembre' END;

    SELECT vigente_desde INTO v_tramos_vigente_desde
    FROM public.planilla_renta_tramos
    WHERE tenant_id = v_tenant_id AND vigente_desde <= v_quincena.fecha_fin
    ORDER BY vigente_desde DESC LIMIT 1;

    FOR v_empleado IN
        SELECT empleado_id, SUM(total_ingresos_gravables) AS gravable, SUM(renta_isr) AS renta_retenida
        FROM public.planilla_calculo_empleado ce
        JOIN public.quincenas q ON q.id = ce.quincena_id
        WHERE q.tenant_id = v_tenant_id AND q.tipo = 'normal' AND EXTRACT(YEAR FROM q.fecha_fin) = v_anio
          AND q.fecha_fin <= v_quincena.fecha_fin
        GROUP BY empleado_id
    LOOP
        v_gravable_acumulado := v_empleado.gravable;
        v_renta_retenida_acumulada := v_empleado.renta_retenida;

        v_renta_esperada := public.fn_calcular_renta_isr(v_tenant_id, v_gravable_acumulado, v_tramos_vigente_desde, v_periodo);
        v_diferencia := ROUND(v_renta_esperada - v_renta_retenida_acumulada, 2);

        -- CA6: si se retuvo de más, NO se ajusta (no hay devolución vía sistema).
        IF v_diferencia > 0 THEN
            UPDATE public.planilla_calculo_empleado SET
                renta_isr = renta_isr + v_diferencia,
                neto_a_pagar = neto_a_pagar - v_diferencia,
                renta_semestral_diferencia = renta_semestral_diferencia + v_diferencia,
                renta_semestral_ajustada_at = now(),
                deduccion_fija_motivo = COALESCE(deduccion_fija_motivo || ' | ', '') || format('Ajuste Renta ISR semestral: +$%s (US-CALC-08)', v_diferencia),
                calculado_por = p_user_id,
                updated_at = now()
            WHERE quincena_id = p_quincena_id AND empleado_id = v_empleado.empleado_id
            RETURNING * INTO v_row;

            IF FOUND THEN
                RETURN NEXT v_row;
            END IF;
        END IF;
    END LOOP;

    RETURN;
END;
$$;

COMMIT;
