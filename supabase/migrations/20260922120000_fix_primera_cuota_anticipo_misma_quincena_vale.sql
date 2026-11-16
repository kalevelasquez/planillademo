-- Migration: Anticipos — la primera cuota debe caer en la MISMA quincena del vale (IMPL-173 CA2)
-- Author: @alexis
-- Description: Imporfrut confirmó (Rina, 2026-09) que la primera cuota de un anticipo SIEMPRE
--              va en la misma quincena en que se registró el vale, nunca en la siguiente. Tanto
--              `procesar_cuotas_anticipos_quincena` (20260908140000) como
--              `contar_anticipos_descuentos_pendientes` (20260908200000) comparaban
--              `a.fecha_vale <= v_quincena_fecha_inicio` — es decir, exigían que el vale se
--              hubiera registrado ANTES de que la quincena empezara. Un vale fechado a mitad de
--              la quincena (ej. 17/07 dentro de la 2da Quincena de Julio, que empieza el 16/07)
--              quedaba excluido de esa quincena y se procesaba recién en la siguiente — mismo
--              patrón exacto ya visto en IMPL-150.
--
--              El fix compara contra el FIN de la quincena, no el inicio: un anticipo aplica a
--              una quincena si su vale ya existe para cuando esa quincena termina
--              (`fecha_vale <= v_quincena_fecha_fin`), lo cual incluye tanto los vales de
--              quincenas anteriores como los registrados dentro de la quincena misma.

BEGIN;

CREATE OR REPLACE FUNCTION public.procesar_cuotas_anticipos_quincena(
    p_quincena_id UUID,
    p_user_id UUID
) RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_quincena_fecha_fin DATE;
    v_anticipo RECORD;
    v_monto NUMERIC;
    v_nuevo_monto_pagado NUMERIC;
    v_procesados INT := 0;
BEGIN
    SELECT fecha_fin INTO v_quincena_fecha_fin
    FROM public.quincenas
    WHERE id = p_quincena_id AND tenant_id = v_tenant_id;

    FOR v_anticipo IN
        SELECT a.* FROM public.planilla_anticipos a
        WHERE a.tenant_id = v_tenant_id
          AND a.estado = 'activo'
          AND a.fecha_vale <= v_quincena_fecha_fin
          AND NOT EXISTS (
              SELECT 1 FROM public.planilla_anticipo_pagos p
              WHERE p.anticipo_id = a.id AND p.quincena_id = p_quincena_id
          )
        FOR UPDATE
    LOOP
        v_monto := LEAST(v_anticipo.monto_cuota, v_anticipo.monto_total - v_anticipo.monto_pagado);

        INSERT INTO public.planilla_anticipo_pagos (tenant_id, anticipo_id, quincena_id, tipo, monto, registrado_por)
        VALUES (v_tenant_id, v_anticipo.id, p_quincena_id, 'pago', v_monto, p_user_id);

        v_nuevo_monto_pagado := v_anticipo.monto_pagado + v_monto;

        UPDATE public.planilla_anticipos
        SET monto_pagado = v_nuevo_monto_pagado,
            estado = CASE WHEN v_nuevo_monto_pagado >= v_anticipo.monto_total THEN 'saldado' ELSE 'activo' END,
            updated_at = now()
        WHERE id = v_anticipo.id;

        v_procesados := v_procesados + 1;
    END LOOP;

    RETURN v_procesados;
END;
$$;

CREATE OR REPLACE FUNCTION public.contar_anticipos_descuentos_pendientes(p_quincena_id UUID)
RETURNS TABLE(anticipos_pendientes INT, descuentos_pendientes INT)
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_quincena_fecha_fin DATE;
BEGIN
    SELECT fecha_fin INTO v_quincena_fecha_fin
    FROM public.quincenas
    WHERE id = p_quincena_id AND tenant_id = v_tenant_id;

    RETURN QUERY
    SELECT
        (
            SELECT COUNT(*)::INT
            FROM public.planilla_anticipos a
            WHERE a.tenant_id = v_tenant_id
              AND a.estado = 'activo'
              AND a.fecha_vale <= v_quincena_fecha_fin
              AND NOT EXISTS (
                  SELECT 1 FROM public.planilla_anticipo_pagos p
                  WHERE p.anticipo_id = a.id AND p.quincena_id = p_quincena_id
              )
        ),
        (
            SELECT COUNT(*)::INT
            FROM public.planilla_descuentos d
            JOIN public.planilla_descuento_categorias c ON c.id = d.categoria_id
            WHERE d.tenant_id = v_tenant_id
              AND d.estado = 'activo'
              AND d.monto_total IS NOT NULL
              AND NOT (c.tipo = 'fijo' AND d.validado_at IS NULL)
              AND NOT EXISTS (
                  SELECT 1 FROM public.planilla_descuento_eventos e
                  WHERE e.descuento_id = d.id AND e.quincena_id = p_quincena_id
              )
        );
END;
$$;

COMMIT;
