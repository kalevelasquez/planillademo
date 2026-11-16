-- Migración: Agrupamiento de Tendencias de Venta (US-REP-02)
-- Autor: @arquitecto — ImporFrut

BEGIN;

CREATE OR REPLACE FUNCTION public.get_sales_trend(
    p_tenant_id UUID,
    p_user_id UUID,
    p_roles TEXT[],
    p_days INT -- Generalmente 7, 30 o 90
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_admin BOOLEAN := ('admin' = ANY(p_roles)) OR ('supervisor' = ANY(p_roles));
    v_timezone TEXT := '-06:00'; -- Zona horaria de El Salvador/Centroamérica
    v_result JSONB;
BEGIN
    WITH RECURSIVE day_series AS (
        -- Generamos la serie de fechas para el periodo actual
        SELECT (CURRENT_DATE AT TIME ZONE v_timezone)::date - (p_days - 1) as day_date, 0 as idx
        UNION ALL
        SELECT (day_date + 1)::date, idx + 1
        FROM day_series
        WHERE idx < (p_days - 1)
    ),
    orders_data AS (
        -- Obtenemos pedidos de ambos periodos (Actual y Espejo) de una sola vez
        SELECT 
            (created_at AT TIME ZONE 'UTC' AT TIME ZONE v_timezone)::date as order_date,
            total_amount
        FROM public.orders
        WHERE tenant_id = p_tenant_id
          AND status NOT IN ('Draft', 'Cancelled')
          AND created_at >= (CURRENT_DATE AT TIME ZONE 'UTC' AT TIME ZONE v_timezone)::date - (2 * p_days - 1)
          AND (v_is_admin OR seller_id = p_user_id)
    ),
    current_agg AS (
        SELECT order_date, SUM(total_amount) as total
        FROM orders_data
        WHERE order_date >= (CURRENT_DATE AT TIME ZONE 'UTC' AT TIME ZONE v_timezone)::date - (p_days - 1)
        GROUP BY 1
    ),
    previous_agg AS (
        SELECT (order_date + p_days)::date as matching_date, SUM(total_amount) as total
        FROM orders_data
        WHERE order_date < (CURRENT_DATE AT TIME ZONE 'UTC' AT TIME ZONE v_timezone)::date - (p_days - 1)
        GROUP BY 1
    )
    SELECT jsonb_agg(jsonb_build_object(
        'fullDate', ds.day_date::text,
        'label', to_char(ds.day_date, 'DD Mon'), -- Formato ej: "18 Mar"
        'current', COALESCE(ca.total, 0),
        'previous', COALESCE(pa.total, 0)
    )) INTO v_result
    FROM day_series ds
    LEFT JOIN current_agg ca ON ds.day_date = ca.order_date
    LEFT JOIN previous_agg pa ON ds.day_date = pa.matching_date;

    RETURN v_result;
END;
$$;

COMMIT;
