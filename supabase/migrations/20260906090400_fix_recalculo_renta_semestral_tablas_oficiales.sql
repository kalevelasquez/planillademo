-- Migration: Recálculo Semestral de Renta — tablas oficiales de DGII (IMPL-85 / US-CALC-08, IMPL-94)
-- Author: @alexis
-- Description: BUG REAL corregido (revisión historia por historia). `recalcular_renta_semestral`
--              reutilizaba la tabla de tramos QUINCENAL (`planilla_renta_tramos`, tramos desde
--              $275) para calcular el ISR sobre un acumulado SEMESTRAL/ANUAL (montos desde
--              $3,300 en junio, $6,600 en diciembre) — producía un ISR muy por encima del real,
--              porque cualquier acumulado semestral cae directo en el tramo IV (30%) de la tabla
--              quincenal. El Jira de IMPL-94 estaba marcado "sin tabla anual real" al momento de
--              construir esta historia; ahora trae las 2 tablas oficiales exactas (Resolución DGII
--              700-DGII-DC-2025-01), una para el recálculo de junio (acumulado enero-junio) y otra
--              para el de diciembre (acumulado enero-diciembre COMPLETO, no solo 2do semestre —
--              corrección también confirmada en el CA1 actualizado; el código YA sumaba el año
--              completo para diciembre, eso no era el bug).
--
--              Se agrega `periodo` a `planilla_renta_tramos` (en vez de una tabla nueva) para
--              mantener el mismo mecanismo de vigencia por fecha ya validado — 3 tablas conviven
--              bajo el mismo `vigente_desde`, distinguidas por `periodo`. `fn_calcular_renta_isr`
--              gana un 4to parámetro `p_periodo` con DEFAULT 'quincenal' — los 3 call-sites
--              existentes (Paso 12 del motor normal, Aguinaldo, el fix de AFP jubilado) seguían
--              sin cambios porque todos calculan sobre una base quincenal real.

BEGIN;

ALTER TABLE public.planilla_renta_tramos
    ADD COLUMN IF NOT EXISTS periodo TEXT NOT NULL DEFAULT 'quincenal'
        CHECK (periodo IN ('quincenal', 'semestral_junio', 'anual_diciembre'));

ALTER TABLE public.planilla_renta_tramos
    DROP CONSTRAINT IF EXISTS planilla_renta_tramos_tenant_id_vigente_desde_orden_key;

ALTER TABLE public.planilla_renta_tramos
    ADD CONSTRAINT planilla_renta_tramos_tenant_id_vigente_desde_periodo_orden_key
        UNIQUE (tenant_id, vigente_desde, periodo, orden);

-- Tabla oficial de junio (CA1/CA3): acumulado enero-junio.
INSERT INTO public.planilla_renta_tramos (tenant_id, vigente_desde, periodo, orden, desde, hasta, tasa_pct, exceso_sobre, monto_fijo)
SELECT t.id, '2026-01-01', 'semestral_junio', v.orden, v.desde, v.hasta, v.tasa_pct, v.exceso_sobre, v.monto_fijo
FROM public.tenants t
CROSS JOIN (VALUES
    (1, 0.01, 3300.00, 0.00, 0.00, 0.00),
    (2, 3300.01, 5371.44, 0.10, 3300.00, 106.20),
    (3, 5371.45, 12228.60, 0.20, 5371.44, 360.00),
    (4, 12228.61, NULL, 0.30, 12228.60, 1731.42)
) AS v(orden, desde, hasta, tasa_pct, exceso_sobre, monto_fijo)
ON CONFLICT (tenant_id, vigente_desde, periodo, orden) DO NOTHING;

-- Tabla oficial de diciembre (CA1/CA3): acumulado enero-diciembre completo.
INSERT INTO public.planilla_renta_tramos (tenant_id, vigente_desde, periodo, orden, desde, hasta, tasa_pct, exceso_sobre, monto_fijo)
SELECT t.id, '2026-01-01', 'anual_diciembre', v.orden, v.desde, v.hasta, v.tasa_pct, v.exceso_sobre, v.monto_fijo
FROM public.tenants t
CROSS JOIN (VALUES
    (1, 0.01, 6600.00, 0.00, 0.00, 0.00),
    (2, 6600.01, 10742.86, 0.10, 6600.00, 212.12),
    (3, 10742.87, 24457.14, 0.20, 10742.86, 720.00),
    (4, 24457.15, NULL, 0.30, 24457.14, 3462.86)
) AS v(orden, desde, hasta, tasa_pct, exceso_sobre, monto_fijo)
ON CONFLICT (tenant_id, vigente_desde, periodo, orden) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_calcular_renta_isr(
    p_tenant_id UUID,
    p_base NUMERIC,
    p_vigente_desde DATE,
    p_periodo TEXT DEFAULT 'quincenal'
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
      AND periodo = p_periodo
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

-- Corregido: usaba la tabla quincenal (periodo default) sobre un acumulado semestral/anual —
-- ahora selecciona la tabla oficial correcta según el mes de la quincena de recálculo.
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

-- CA de admin_crear_vigencia_fiscal (US-CALC-01/02): cada elemento de p_tramos puede traer un
-- 'periodo' opcional (default 'quincenal') para que una vigencia fiscal nueva pueda re-seedear
-- las 3 tablas de una sola vez — sin romper el contrato ya usado (tramos sin 'periodo' siguen
-- interpretándose como quincenales).
CREATE OR REPLACE FUNCTION public.admin_crear_vigencia_fiscal(
    p_desde DATE,
    p_isss_tasa_empleado NUMERIC, p_isss_tasa_patronal NUMERIC, p_isss_tope_base NUMERIC,
    p_afp_tasa_empleado NUMERIC, p_afp_tasa_patronal NUMERIC, p_afp_tope_base NUMERIC,
    p_insaforp_tasa_patronal NUMERIC,
    p_deduccion_fija_anual NUMERIC, p_deduccion_fija_tope_ingreso_anual NUMERIC,
    p_salario_minimo_inembargable NUMERIC,
    p_tramos JSONB,
    p_user_id UUID
) RETURNS public.planilla_config_fiscal
LANGUAGE plpgsql
AS $$
DECLARE
    v_config public.planilla_config_fiscal;
    v_tramo JSONB;
BEGIN
    UPDATE public.planilla_config_fiscal
    SET vigente_hasta = p_desde - 1
    WHERE tenant_id = public.get_auth_tenant_id() AND vigente_hasta IS NULL;

    UPDATE public.planilla_renta_tramos
    SET vigente_hasta = p_desde - 1
    WHERE tenant_id = public.get_auth_tenant_id() AND vigente_hasta IS NULL;

    INSERT INTO public.planilla_config_fiscal (
        tenant_id, vigente_desde, isss_tasa_empleado, isss_tasa_patronal, isss_tope_base,
        afp_tasa_empleado, afp_tasa_patronal, afp_tope_base, insaforp_tasa_patronal,
        deduccion_fija_anual, deduccion_fija_tope_ingreso_anual, salario_minimo_inembargable,
        created_by
    ) VALUES (
        public.get_auth_tenant_id(), p_desde, p_isss_tasa_empleado, p_isss_tasa_patronal, p_isss_tope_base,
        p_afp_tasa_empleado, p_afp_tasa_patronal, p_afp_tope_base, p_insaforp_tasa_patronal,
        p_deduccion_fija_anual, p_deduccion_fija_tope_ingreso_anual, p_salario_minimo_inembargable,
        p_user_id
    )
    RETURNING * INTO v_config;

    FOR v_tramo IN SELECT * FROM jsonb_array_elements(p_tramos)
    LOOP
        INSERT INTO public.planilla_renta_tramos (
            tenant_id, vigente_desde, periodo, orden, desde, hasta, tasa_pct, exceso_sobre, monto_fijo
        ) VALUES (
            v_config.tenant_id, p_desde,
            COALESCE(v_tramo->>'periodo', 'quincenal'),
            (v_tramo->>'orden')::INT,
            (v_tramo->>'desde')::NUMERIC,
            NULLIF(v_tramo->>'hasta', '')::NUMERIC,
            (v_tramo->>'tasa_pct')::NUMERIC,
            (v_tramo->>'exceso_sobre')::NUMERIC,
            (v_tramo->>'monto_fijo')::NUMERIC
        );
    END LOOP;

    RETURN v_config;
END;
$$;

COMMIT;
