-- Migration: cablear tope de salario del IPSFA (IMPL-87 CA4, respuesta Imporfrut pregunta 13)
-- Author: @alexis
-- Description: Imporfrut confirmó la tasa IPSFA (6% empleado / 6% patronal, ya coincidía con el
--              DEFAULT de `planilla_config_fiscal` desde 20260817090000) pero además confirmó un
--              tope de salario de $2,449.05 MENSUAL que nunca se había cableado — el comentario
--              de IMPL-87 (20260924090000) decía explícitamente "sin tope — ni el CA4 ni
--              planilla_config_fiscal definen uno para IPSFA", que queda desactualizado con esta
--              respuesta.
--
--              Tope quincenal = $2,449.05 / 2 = $1,224.525 (mismo criterio que `isss_tope_base`:
--              se guarda el valor YA EXPRESADO por quincena, porque el motor opera sobre
--              `v_total_gravable`, que es el gravable DE LA QUINCENA, no mensual).
--
--              Se re-crea `calcular_planilla_empleado` completo (Postgres no permite parchear el
--              cuerpo de una función PL/pgSQL existente) — diffeado contra 20260929090000 antes
--              de finalizar: los únicos cambios reales son los dos `LEAST(v_total_gravable,
--              v_config.ipsfa_tope_base)` (lado empleado en el Paso 9-10, lado patronal en el
--              INSERT) y el comentario que ya no aplica.

BEGIN;

ALTER TABLE public.planilla_config_fiscal
    ADD COLUMN IF NOT EXISTS ipsfa_tope_base NUMERIC NOT NULL DEFAULT 1224.525;

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
    v_permisos_sin_goce_monto NUMERIC := 0;

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
    v_ipsfa NUMERIC := 0;
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

    -- ===== Paso 2b: Permisos Sin Goce de Salario (IMPL-181/US-PER-01 CA4) — ver cabecera de
    -- esta migración para la justificación de por qué resta acá y no como descuento (Paso 14). =====
    BEGIN
        SELECT COALESCE(SUM(
            CASE p.granularidad
                WHEN 'dia_completo' THEN COALESCE(v_empleado.sueldo_mensual, 0) / 30
                WHEN 'medio_dia' THEN COALESCE(v_empleado.sueldo_mensual, 0) / 60
                WHEN 'horas' THEN p.horas * COALESCE(v_empleado.sueldo_mensual, 0) / 240
            END
        ), 0) INTO v_permisos_sin_goce_monto
        FROM public.planilla_permisos p
        WHERE p.quincena_id = p_quincena_id AND p.empleado_id = p_empleado_id AND p.tipo = 'sin_goce';

        v_permisos_sin_goce_monto := ROUND(v_permisos_sin_goce_monto, 2);
        v_sueldo_proporcional := GREATEST(0, ROUND(v_sueldo_proporcional - v_permisos_sin_goce_monto, 2));
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 2b (Permisos Sin Goce) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 3: Horas Extras (ya calculadas en la épica Horas Extras, IMPL-20) =====
    BEGIN
        -- IMPL-189 CA1 — redondear ACÁ, antes de usarlo en el Paso 8 y en el INSERT: el monto por
        -- fila lo calcula calcularMontoHorasExtras() (TS, horasExtrasUtils.ts) sin redondear antes
        -- de insertar en planilla_horas_extras_manual, así que sin este ROUND la columna
        -- horas_extras_monto queda con todos los decimales (ej. 34.53333333333333) y descuadra
        -- $0.01 contra lo que se muestra por fila.
        SELECT ROUND(COALESCE(SUM(monto_total), 0), 2) INTO v_horas_extras
        FROM public.planilla_horas_extras_manual
        WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 3 (Horas Extras) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 4: Viáticos (no gravable, ADEMÁS Bono 10% sobre viático GG fijo — IMPL-174:
    -- el monto SIEMPRE cuenta como ingreso no gravable, la retención especial solo agrega una
    -- base de impuesto adicional, nunca reemplaza el ingreso) =====
    BEGIN
        SELECT
            COALESCE(SUM(monto), 0),
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

    -- ===== Paso 8: Total Ingresos Gravables/No Gravables =====
    -- BUGFIX (encontrado investigando IMPL-178): v_total_no_gravable ahora SUMA las bases
    -- "bono10" de vacaciones/bonificaciones/otros_ingresos/incapacidad — antes esa plata nunca
    -- llegaba a ningún total de ingreso, aunque v_renta_bono10 (Paso 13) SÍ la gravaba y se
    -- restaba del Neto (Paso 16). Van a v_total_no_gravable (no a v_total_gravable) a propósito:
    -- el mecanismo "Bono con Renta 10%" es una tasa plana EN VEZ DE la progresiva normal, meterlas
    -- en v_total_gravable las sometería TAMBIÉN a v_base_renta (Paso 11) — doble tributación en
    -- la dirección contraria. v_viaticos_bono10 NO se suma acá aparte porque v_viaticos_monto
    -- (Paso 4) ya lo incluye completo desde IMPL-174 — patrón distinto, ya correcto.
    BEGIN
        v_total_gravable := ROUND(
            v_sueldo_proporcional + v_horas_extras + v_vacaciones_gravable + v_bonificaciones_gravable + v_otros_ing_gravable,
            2
        );
        v_total_no_gravable := ROUND(
            v_viaticos_monto + v_bonificaciones_no_gravable + v_otros_ing_no_gravable
            + v_vacaciones_bono10 + v_bonificaciones_bono10 + v_otros_ing_bono10 + v_incapacidad_bono10,
            2
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 8 (Total Ingresos Gravables) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Pasos 9-10: ISSS, AFP e IPSFA (US-CALC-01/IMPL-87) =====
    BEGIN
        v_isss := ROUND(LEAST(v_total_gravable, v_config.isss_tope_base) * v_config.isss_tasa_empleado, 2);
        -- IMPL-87 CA4 — IPSFA es una cotización de retiro DISTINTA de AFP (otra institución,
        -- solo militares afiliados) — un empleado ipsfa nunca cotiza a AFP, cotiza a IPSFA en
        -- su lugar (ver también el INSERT más abajo, lado patronal).
        v_afp := CASE
            WHEN v_empleado.tipo_afiliacion IN ('jubilado', 'ipsfa') THEN 0
            ELSE ROUND(
                (CASE WHEN v_config.afp_tope_base IS NULL THEN v_total_gravable ELSE LEAST(v_total_gravable, v_config.afp_tope_base) END)
                * v_config.afp_tasa_empleado,
                2
            )
        END;
        -- Respuesta Imporfrut pregunta 13 (2026-10-02): tope de salario de $2,449.05 mensual
        -- ($1,224.525 quincenal, ver cabecera de esta migración) — antes sin tope.
        v_ipsfa := CASE
            WHEN v_empleado.tipo_afiliacion = 'ipsfa' THEN ROUND(LEAST(v_total_gravable, v_config.ipsfa_tope_base) * v_config.ipsfa_tasa_empleado, 2)
            ELSE 0
        END;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 9-10 (ISSS, AFP e IPSFA) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 11: Base Renta — deducción fija IMPL-88 CA2/CA5: compara el gravable REAL de
    -- esta quincena (v_total_gravable, ya calculado en el Paso 8) contra el tope quincenal, NUNCA
    -- el sueldo mensual contractual (defecto IMPL-175, corregido acá en el motor real; el mirror
    -- TS ya se había corregido antes pero nunca se sincronizó este call site) =====
    BEGIN
        SELECT * INTO v_deduccion_fija
        FROM public.fn_aplica_deduccion_fija(v_total_gravable, v_config.deduccion_fija_anual, v_config.deduccion_fija_tope_ingreso_anual);
        v_base_renta := GREATEST(0, ROUND(v_total_gravable - v_isss - v_afp - v_ipsfa - v_deduccion_fija.o_monto, 2));
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
        v_descuentos_obligatorios_total := ROUND(v_isss + v_afp + v_ipsfa + v_renta_isr + v_renta_bono10, 2);
        v_tope_20 := ROUND(v_sueldo_proporcional * v_config.tope_descuentos_no_obligatorios_pct, 2);

        FOR v_item IN
            SELECT e.monto, c.tipo, CASE
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
            v_total_gravable + v_total_no_gravable - v_isss - v_afp - v_ipsfa - v_renta_isr - v_renta_bono10 - v_no_obligatorios_aplicado,
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
            permisos_sin_goce_monto,
            horas_extras_monto,
            viaticos_monto, viaticos_bono10_base,
            vacaciones_monto, vacaciones_bono10_base,
            bonificaciones_monto,
            otros_ingresos_gravables, otros_ingresos_no_gravables, otros_ingresos_bono10_base,
            incapacidad_bono10_base,
            total_ingresos_gravables,
            isss_empleado, afp_empleado, ipsfa_empleado,
            deduccion_fija_aplicada, deduccion_fija_motivo, base_renta,
            renta_isr,
            base_bono10_total, renta_bono10,
            descuentos_obligatorios_total, descuentos_no_obligatorios_solicitado, descuentos_no_obligatorios_aplicado,
            descuentos_tope_20_base, descuentos_excedente_diferido, descuentos_alerta_tope_superado,
            alerta_neto_bajo_minimo, descuentos_detalle,
            total_no_gravable, neto_a_pagar,
            isss_patronal, afp_patronal, ipsfa_patronal, insaforp_patronal,
            config_fiscal_id, tramos_renta_vigente_desde, tipo_quincena,
            calculado_por
        ) VALUES (
            v_tenant_id, p_quincena_id, p_empleado_id,
            v_quincena.dias_habiles, v_dias_laborados, v_sueldo_quincenal, v_sueldo_proporcional,
            v_permisos_sin_goce_monto,
            v_horas_extras,
            v_viaticos_monto, v_viaticos_bono10,
            v_vacaciones_gravable, v_vacaciones_bono10,
            v_bonificaciones_gravable,
            v_otros_ing_gravable, ROUND(v_otros_ing_no_gravable + v_bonificaciones_no_gravable, 2), ROUND(v_otros_ing_bono10 + v_bonificaciones_bono10, 2),
            v_incapacidad_bono10,
            v_total_gravable,
            v_isss, v_afp, v_ipsfa,
            v_deduccion_fija.o_monto, v_deduccion_fija.o_motivo, v_base_renta,
            v_renta_isr,
            v_base_bono10_total, v_renta_bono10,
            v_descuentos_obligatorios_total, v_no_obligatorios_solicitado, v_no_obligatorios_aplicado,
            v_tope_20, v_excedente_diferido, v_alerta_tope,
            v_alerta_minimo, v_detalle,
            v_total_no_gravable, v_neto,
            -- Defecto real (2026-09-24, IMPL-87 CA1) — antes sin LEAST, el ISSS patronal no
            -- aplicaba el tope de $500 quincenal.
            ROUND(LEAST(v_total_gravable, v_config.isss_tope_base) * v_config.isss_tasa_patronal, 2),
            -- IMPL-87 CA4 — un empleado ipsfa no cotiza AFP patronal (cotiza IPSFA patronal,
            -- ver la línea siguiente).
            ROUND((CASE
                WHEN v_empleado.tipo_afiliacion = 'ipsfa' THEN 0
                WHEN v_config.afp_tope_base IS NULL THEN v_total_gravable
                ELSE LEAST(v_total_gravable, v_config.afp_tope_base)
            END) * v_config.afp_tasa_patronal, 2),
            -- Respuesta Imporfrut pregunta 13 (2026-10-02): mismo tope de $1,224.525 quincenal
            -- del lado empleado, ver Paso 9-10 arriba.
            ROUND(CASE WHEN v_empleado.tipo_afiliacion = 'ipsfa' THEN LEAST(v_total_gravable, v_config.ipsfa_tope_base) * v_config.ipsfa_tasa_patronal ELSE 0 END, 2),
            ROUND(v_sueldo_quincenal * v_config.insaforp_tasa_patronal, 2),
            v_config.id, v_tramos_vigente_desde, v_quincena.tipo,
            p_user_id
        )
        ON CONFLICT (quincena_id, empleado_id) DO UPDATE SET
            dias_habiles_quincena = EXCLUDED.dias_habiles_quincena,
            dias_laborados = EXCLUDED.dias_laborados,
            sueldo_quincenal_base = EXCLUDED.sueldo_quincenal_base,
            sueldo_proporcional = EXCLUDED.sueldo_proporcional,
            permisos_sin_goce_monto = EXCLUDED.permisos_sin_goce_monto,
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
            ipsfa_empleado = EXCLUDED.ipsfa_empleado,
            deduccion_fija_aplicada = EXCLUDED.deduccion_fija_aplicada,
            deduccion_fija_motivo = EXCLUDED.deduccion_fija_motivo,
            base_renta = EXCLUDED.base_renta,
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
            ipsfa_patronal = EXCLUDED.ipsfa_patronal,
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

COMMIT;
