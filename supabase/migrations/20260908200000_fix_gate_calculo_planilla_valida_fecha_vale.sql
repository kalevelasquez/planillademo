-- Migration: Gate de "Calcular Planilla" — validar fecha_vale (fix defecto UAT, 2026-09-03)
-- Author: @alexis
-- Description: `contar_anticipos_descuentos_pendientes` (creada en 20260907270000 para
--              bloquear "Calcular Planilla" si hay Anticipos/Descuentos sin "Procesar Cuotas")
--              se documentó como "mismo criterio EXACTO que procesar_cuotas_anticipos_quincena"
--              — pero ese RPC se corrigió después (20260908140000, fix de IMPL-150) para dejar
--              de procesar anticipos cuya fecha_vale todavía no aplica a esta quincena, y el
--              gate nunca se actualizó junto con él. Resultado: un anticipo activo cuya primera
--              cuota corresponde a una quincena FUTURA (todavía no creada, o posterior a la que
--              se está calculando) queda marcado como "pendiente" para SIEMPRE en esta
--              quincena — Procesar Cuotas lo salta correctamente (no le toca todavía), pero el
--              gate lo sigue contando, y "Calcular Planilla" queda bloqueada sin salida posible.
--
--              El fix es el mismo criterio que ya se aplicó al RPC real: excluir del conteo los
--              anticipos cuya fecha_vale sea posterior al inicio de la quincena que se está
--              calculando.

BEGIN;

CREATE OR REPLACE FUNCTION public.contar_anticipos_descuentos_pendientes(p_quincena_id UUID)
RETURNS TABLE(anticipos_pendientes INT, descuentos_pendientes INT)
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_quincena_fecha_inicio DATE;
BEGIN
    SELECT fecha_inicio INTO v_quincena_fecha_inicio
    FROM public.quincenas
    WHERE id = p_quincena_id AND tenant_id = v_tenant_id;

    RETURN QUERY
    SELECT
        (
            SELECT COUNT(*)::INT
            FROM public.planilla_anticipos a
            WHERE a.tenant_id = v_tenant_id
              AND a.estado = 'activo'
              AND a.fecha_vale <= v_quincena_fecha_inicio
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
