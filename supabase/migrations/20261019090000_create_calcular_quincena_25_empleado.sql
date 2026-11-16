-- Migration: Cálculo de Planilla — Quincena 25 (IMPL-14 / US-CALC-10 bis)
-- Author: @alexis
-- Description: Beneficio del gobierno de El Salvador (pagado en enero, distinto del Aguinaldo
--              de diciembre) — fórmula CONFIRMADA por Imporfrut contra un Excel real de 170
--              empleados, 6 casos verificados exacto (ver docs/product/planilla-contexto.md,
--              sección "Respuestas de Imporfrut al correo de consultas", Pregunta 4):
--
--                  quincena_25 = ROUND(0.5 × sueldo_mensual × MIN(días, 365) / 365, 2)
--
--              donde `días` es la diferencia de calendario SIMPLE (sin +1) entre la fecha de
--              ingreso del empleado y el 14 de enero del año de la quincena. Elegibilidad: el
--              "$1,500" NO es un tope sobre el monto ni un excedente gravable (a diferencia del
--              Aguinaldo) — es un GATE DE ELEGIBILIDAD sobre `sueldo_mensual`: si supera $1,500
--              (inclusive, hasta $1,500 cobra completo) el empleado no cobra NADA. Sin ISSS/AFP/
--              Renta en ningún caso, ni siquiera sobre el excedente — a diferencia del Aguinaldo,
--              que sí paga Renta sobre lo que excede $1,500.
--
--              Mismo patrón arquitectónico que Aguinaldo (20260821090000_...sql): función
--              dedicada + trigger AFTER INSERT en quincenas cuando tipo='quincena_25', reutiliza
--              planilla_calculo_empleado, sin motor en `calcular_planilla_empleado` (que sigue
--              rechazando cualquier tipo != 'normal') ni mirror en TypeScript — mismo criterio
--              que Aguinaldo, que tampoco tiene mirror (ver calculoPlanillaUtils.ts).
--
--              Confirmado con Imporfrut (2026-10-19): el beneficio no era obligatorio para el
--              período del Excel de referencia, pero a partir de enero de 2027 SÍ es obligatorio.
--
--              Un empleado que ya no está `activo` al momento de procesar la quincena (despedido,
--              renuncia, mutuo acuerdo) queda EXCLUIDO de este cálculo, igual que en Aguinaldo —
--              su monto proporcional correspondiente se integra en su Liquidación Laboral en vez
--              de pagarse acá (ver liquidacionLaboralUtils.ts, calcularQuincena25Proporcional).
--              Confirmado por Imporfrut: para DESPIDO, el prorrateo (misma fórmula, pero con
--              fecha de corte = fecha de despido en vez del 14 de enero) se paga como parte de la
--              indemnización. Alcance pendiente de confirmar con Imporfrut: si esa misma regla
--              aplica también a renuncia/mutuo acuerdo, o solo a despido — no implementado para
--              esos 2 casos hasta tener esa confirmación (ver nota en liquidacionLaboralUtils.ts).

BEGIN;

CREATE OR REPLACE FUNCTION public.calcular_quincena_25_empleado(
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
    v_anio INT;
    v_fecha_corte DATE;
    v_dias NUMERIC;
    v_monto NUMERIC;
    v_motivo TEXT;
    v_result public.planilla_calculo_empleado;
BEGIN
    SELECT * INTO v_empleado FROM public.planilla_empleados WHERE id = p_empleado_id;
    SELECT * INTO v_quincena FROM public.quincenas WHERE id = p_quincena_id;
    v_tenant_id := v_quincena.tenant_id;

    IF v_quincena.tipo != 'quincena_25' THEN
        RAISE EXCEPTION 'calcular_quincena_25_empleado solo aplica a quincenas tipo quincena_25 (quincena %)', p_quincena_id;
    END IF;

    SELECT * INTO v_config
    FROM public.planilla_config_fiscal
    WHERE tenant_id = v_tenant_id AND vigente_desde <= v_quincena.fecha_fin
      AND (vigente_hasta IS NULL OR vigente_hasta >= v_quincena.fecha_fin)
    ORDER BY vigente_desde DESC LIMIT 1;

    -- Quincena 25 nunca calcula Renta, pero la columna es NOT NULL — mismo lookup que Aguinaldo
    -- solo para dejar un valor real de referencia, no porque se vaya a usar en el cálculo.
    SELECT vigente_desde INTO v_tramos_vigente_desde
    FROM public.planilla_renta_tramos
    WHERE tenant_id = v_tenant_id AND vigente_desde <= v_quincena.fecha_fin
    ORDER BY vigente_desde DESC LIMIT 1;

    v_anio := EXTRACT(YEAR FROM v_quincena.fecha_inicio);
    v_fecha_corte := MAKE_DATE(v_anio, 1, 14);
    -- GREATEST(0, ...) por si el empleado ingresó DESPUÉS del 14 de enero de ese año (no
    -- cubierto por los 6 casos reales verificados, pero matemáticamente posible) — sin esto,
    -- `fecha_corte - fecha_ingreso` da un número negativo y el monto saldría negativo.
    v_dias := LEAST(365, GREATEST(0, v_fecha_corte - v_empleado.fecha_ingreso));

    IF v_empleado.sueldo_mensual > 1500 THEN
        v_monto := 0;
        v_motivo := 'Quincena 25: no elegible (sueldo mensual supera $1,500)';
    ELSE
        v_monto := ROUND(0.5 * v_empleado.sueldo_mensual * v_dias / 365, 2);
        v_motivo := format('Quincena 25: %s días (ingreso %s, corte %s)', v_dias, v_empleado.fecha_ingreso, v_fecha_corte);
    END IF;

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
        0, v_motivo, 0, 0,
        0, v_monto,
        0, 0, 0,
        v_config.id, v_tramos_vigente_desde, v_quincena.tipo, p_user_id
    )
    ON CONFLICT (quincena_id, empleado_id) DO UPDATE SET
        dias_laborados = EXCLUDED.dias_laborados,
        sueldo_proporcional = EXCLUDED.sueldo_proporcional,
        deduccion_fija_motivo = EXCLUDED.deduccion_fija_motivo,
        neto_a_pagar = EXCLUDED.neto_a_pagar,
        calculado_por = p_user_id,
        calculado_at = now(),
        updated_at = now()
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_disparar_calculo_quincena_25()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_empleado RECORD;
BEGIN
    IF NEW.tipo = 'quincena_25' THEN
        FOR v_empleado IN
            SELECT id FROM public.planilla_empleados
            WHERE tenant_id = NEW.tenant_id AND estado = 'activo' AND deleted_at IS NULL
        LOOP
            PERFORM public.calcular_quincena_25_empleado(NEW.id, v_empleado.id, NEW.created_by);
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_calcular_quincena_25_automatico ON public.quincenas;
CREATE TRIGGER tr_calcular_quincena_25_automatico
    AFTER INSERT ON public.quincenas
    FOR EACH ROW EXECUTE FUNCTION public.fn_disparar_calculo_quincena_25();

COMMIT;
