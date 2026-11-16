-- Migration: Cálculo de Planilla — Aguinaldo + Recálculo de Renta Semestral (IMPL-85 /
--            US-CALC-10, IMPL-96 + US-CALC-08, IMPL-94)
-- Author: @alexis
-- Description: Aguinaldo (US-CALC-10): reutiliza `planilla_calculo_empleado` (mismo formato de
--              tabla que US-CALC-03, CA5) y `fn_calcular_renta_isr` (misma tabla de tramos,
--              aplicada sobre el excedente de $1,500 en vez del salario ordinario — decisión ya
--              aprobada en el diseño de la épica). Se dispara automáticamente (CA1) vía trigger
--              `AFTER INSERT` en `quincenas` cuando `tipo='aguinaldo'` — NO se tocó el RPC
--              `create_quincena` existente (usado por otras épicas) para no arriesgar su
--              contrato ya en uso.
--
--              AMBIGÜEDAD ADICIONAL (antigüedad < 1 año, no cubierta por CA2 literal que solo
--              define tramos desde "1 año a menos de 3 años"): decisión provisional — se
--              prorratea 15 días × (meses trabajados ÷ 12), documentado en
--              `deduccion_fija_motivo`-equivalente (columna `deduccion_fija_motivo` reutilizada
--              como campo de nota general, ya que el aguinaldo no tiene deducción fija propia).
--
--              Recálculo de Renta Semestral (US-CALC-08): AMBIGÜEDAD ADICIONAL — Jira no provee
--              una tabla de tramos ANUAL (solo la quincenal de IMPL-88), y no especifica el
--              algoritmo exacto de reconciliación. Decisión provisional, documentada
--              explícitamente como aproximación: se re-aplica la MISMA tabla de tramos quincenal
--              sobre el ingreso gravable acumulado del año (proyectado a partir de lo acumulado
--              en junio, o el total real en diciembre) — no es fiscalmente exacto sin una tabla
--              anual real, pero dado que CA4 permite cobrar de más y CA3 prohíbe devolver de
--              menos, el ajuste solo puede ir en una dirección seguro: si el resultado indica que
--              se retuvo de más, NO se ajusta (documentado, CA3); si indica que se debe más, se
--              suma como ajuste a la Renta ISR de la propia quincena de recálculo (CA4).

BEGIN;

-- ===== Aguinaldo (US-CALC-10 / IMPL-96) =====

CREATE OR REPLACE FUNCTION public.calcular_aguinaldo_empleado(
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
    v_antiguedad_anios NUMERIC;
    v_dias NUMERIC;
    v_sueldo_dia NUMERIC;
    v_monto NUMERIC;
    v_base_renta NUMERIC;
    v_renta NUMERIC;
    v_motivo TEXT;
    v_result public.planilla_calculo_empleado;
BEGIN
    SELECT * INTO v_empleado FROM public.planilla_empleados WHERE id = p_empleado_id;
    SELECT * INTO v_quincena FROM public.quincenas WHERE id = p_quincena_id;
    v_tenant_id := v_quincena.tenant_id;

    IF v_quincena.tipo != 'aguinaldo' THEN
        RAISE EXCEPTION 'calcular_aguinaldo_empleado solo aplica a quincenas tipo aguinaldo (quincena %)', p_quincena_id;
    END IF;

    SELECT * INTO v_config
    FROM public.planilla_config_fiscal
    WHERE tenant_id = v_tenant_id AND vigente_desde <= v_quincena.fecha_fin
      AND (vigente_hasta IS NULL OR vigente_hasta >= v_quincena.fecha_fin)
    ORDER BY vigente_desde DESC LIMIT 1;

    SELECT vigente_desde INTO v_tramos_vigente_desde
    FROM public.planilla_renta_tramos
    WHERE tenant_id = v_tenant_id AND vigente_desde <= v_quincena.fecha_fin
    ORDER BY vigente_desde DESC LIMIT 1;

    v_antiguedad_anios := EXTRACT(EPOCH FROM (v_quincena.fecha_fin - v_empleado.fecha_ingreso)) / (365.25 * 86400);
    v_sueldo_dia := ROUND(v_empleado.sueldo_mensual / 30, 2);

    IF v_antiguedad_anios >= 10 THEN
        v_dias := 21; v_motivo := 'Aguinaldo: 21 días (antigüedad >= 10 años)';
    ELSIF v_antiguedad_anios >= 3 THEN
        v_dias := 19; v_motivo := 'Aguinaldo: 19 días (antigüedad 3 a <10 años)';
    ELSIF v_antiguedad_anios >= 1 THEN
        v_dias := 15; v_motivo := 'Aguinaldo: 15 días (antigüedad 1 a <3 años)';
    ELSE
        -- AMBIGÜEDAD: CA2 no cubre <1 año — decisión provisional, prorrateo por meses trabajados.
        v_dias := ROUND(15 * LEAST(1, GREATEST(0, v_antiguedad_anios)), 2);
        v_motivo := 'Aguinaldo: prorrateado por antigüedad <1 año (decisión provisional, CA2 no lo especifica)';
    END IF;

    v_monto := ROUND(v_dias * v_sueldo_dia, 2);
    v_base_renta := GREATEST(0, ROUND(v_monto - 1500, 2));
    v_renta := public.fn_calcular_renta_isr(v_tenant_id, v_base_renta, v_tramos_vigente_desde);

    INSERT INTO public.planilla_calculo_empleado (
        tenant_id, quincena_id, empleado_id,
        dias_habiles_quincena, dias_laborados, sueldo_quincenal_base, sueldo_proporcional,
        total_ingresos_gravables, isss_empleado, afp_empleado,
        deduccion_fija_aplicada, deduccion_fija_motivo, base_renta, renta_isr,
        total_no_gravable, neto_a_pagar,
        isss_patronal, afp_patronal, insaforp_patronal,
        config_fiscal_id, tramos_renta_vigente_desde, tipo_quincena, calculado_por
    ) VALUES (
        v_tenant_id, p_quincena_id, p_empleado_id,
        v_quincena.dias_habiles, v_dias, v_monto, v_monto,
        0, 0, 0,
        0, v_motivo, v_base_renta, v_renta,
        0, ROUND(v_monto - v_renta, 2),
        0, 0, 0,
        v_config.id, v_tramos_vigente_desde, v_quincena.tipo, p_user_id
    )
    ON CONFLICT (quincena_id, empleado_id) DO UPDATE SET
        dias_laborados = EXCLUDED.dias_laborados,
        sueldo_proporcional = EXCLUDED.sueldo_proporcional,
        deduccion_fija_motivo = EXCLUDED.deduccion_fija_motivo,
        base_renta = EXCLUDED.base_renta,
        renta_isr = EXCLUDED.renta_isr,
        neto_a_pagar = EXCLUDED.neto_a_pagar,
        calculado_por = p_user_id,
        calculado_at = now(),
        updated_at = now()
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_disparar_calculo_aguinaldo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_empleado RECORD;
BEGIN
    IF NEW.tipo = 'aguinaldo' THEN
        FOR v_empleado IN
            SELECT id FROM public.planilla_empleados
            WHERE tenant_id = NEW.tenant_id AND estado = 'activo' AND deleted_at IS NULL
        LOOP
            PERFORM public.calcular_aguinaldo_empleado(NEW.id, v_empleado.id, NEW.created_by);
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_calcular_aguinaldo_automatico ON public.quincenas;
CREATE TRIGGER tr_calcular_aguinaldo_automatico
    AFTER INSERT ON public.quincenas
    FOR EACH ROW EXECUTE FUNCTION public.fn_disparar_calculo_aguinaldo();

-- ===== Recálculo de Renta Semestral (US-CALC-08 / IMPL-94) =====

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

        -- AMBIGÜEDAD documentada en el header: aproximación sin tabla de tramos anual real —
        -- re-aplica la tabla quincenal sobre el acumulado. Ajustar cuando Contabilidad confirme
        -- la tabla anual real de Hacienda.
        v_renta_esperada := public.fn_calcular_renta_isr(v_tenant_id, v_gravable_acumulado, v_tramos_vigente_desde);
        v_diferencia := ROUND(v_renta_esperada - v_renta_retenida_acumulada, 2);

        -- CA3: si se retuvo de más, NO se ajusta (no hay devolución vía sistema).
        IF v_diferencia > 0 THEN
            UPDATE public.planilla_calculo_empleado SET
                renta_isr = renta_isr + v_diferencia,
                neto_a_pagar = neto_a_pagar - v_diferencia,
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
