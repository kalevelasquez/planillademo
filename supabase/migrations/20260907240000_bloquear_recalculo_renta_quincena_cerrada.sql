-- Migration: recalcular_renta_semestral — bloquear sobre quincena cerrada
-- Author: @alexis
-- Description: Auditoría crítica módulo por módulo (2026-08-13), hallazgo MENOR #3 de la 6ª
--              pasada sobre Cálculo de Planilla: `recalcular_renta_semestral` no chequeaba
--              `v_quincena.estado`, a diferencia de `calcular_planilla_empleado` (que sí exige
--              'en_proceso' desde 20260819090000). Sobre una quincena ya aprobada_cerrada, el
--              RPC corría igual — como cualquier diferencia semestral ya fue aplicada al
--              recalcular antes del cierre, la corrida no encontraba nada que ajustar y
--              devolvía un SETOF vacío. En la UI eso se ve indistinguible de "no había ajuste
--              pendiente" (0 ajustados, sin error), cuando la razón real es que la quincena está
--              bloqueada para cualquier recálculo. Fix: mismo guard explícito que ya usa
--              `calcular_planilla_empleado`, agregado ANTES del chequeo de tipo/fecha existente.
--
--              El guard cliente (CalculoPlanillaView.tsx, handleRecalcularRenta) ya corta el
--              flujo antes de llamar al RPC — este chequeo en el RPC es defensa en profundidad
--              (ej. si algún otro caller invoca el RPC directo, o la sesión quedó desactualizada
--              sobre el estado real de la quincena).

BEGIN;

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

    -- Bugfix (auditoría, hallazgo menor #3, 6ª pasada): antes faltaba este chequeo — sobre una
    -- quincena aprobada_cerrada el RPC corría igual y devolvía "0 ajustados" en silencio, sin
    -- avisar que la quincena está bloqueada. Mismo guard que ya usa calcular_planilla_empleado.
    IF v_quincena.estado != 'en_proceso' THEN
        RAISE EXCEPTION 'No se puede recalcular la Renta semestral: la quincena % no está en_proceso (estado actual: %)', p_quincena_id, v_quincena.estado;
    END IF;

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
