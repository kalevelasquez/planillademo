-- Migración: Dashboard de KPIs Comparativos (US-REP-01 CA4)
-- Autor: @arquitecto — ImporFrut

BEGIN;

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(
    p_tenant_id UUID,
    p_user_id UUID,
    p_roles TEXT[],
    p_start_today TIMESTAMPTZ,
    p_end_today TIMESTAMPTZ,
    p_start_yesterday TIMESTAMPTZ,
    p_end_yesterday TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_admin BOOLEAN := ('admin' = ANY(p_roles)) OR ('supervisor' = ANY(p_roles));
    v_t_sales NUMERIC := 0; v_t_count INT := 0;
    v_y_sales NUMERIC := 0; v_y_count INT := 0;
    v_pending INT := 0;
    v_top_prod JSONB; v_top_cust JSONB;
BEGIN
    -- 1. Métricas de Hoy
    SELECT COALESCE(SUM(total_amount), 0), COUNT(id)
    INTO v_t_sales, v_t_count
    FROM public.orders
    WHERE tenant_id = p_tenant_id AND created_at BETWEEN p_start_today AND p_end_today
      AND status != 'Draft' AND (v_is_admin OR seller_id = p_user_id);

    -- 2. Métricas de Ayer (Comparativa)
    SELECT COALESCE(SUM(total_amount), 0), COUNT(id)
    INTO v_y_sales, v_y_count
    FROM public.orders
    WHERE tenant_id = p_tenant_id AND created_at BETWEEN p_start_yesterday AND p_end_yesterday
      AND status != 'Draft' AND (v_is_admin OR seller_id = p_user_id);

    -- 3. Pedidos Pendientes (Snapshot actual)
    SELECT COUNT(id) INTO v_pending FROM public.orders
    WHERE tenant_id = p_tenant_id AND status IN ('Approved', 'In Preparation')
      AND (v_is_admin OR seller_id = p_user_id);

    -- 4. Top 5 Productos Hoy
    SELECT jsonb_agg(t) INTO v_top_prod FROM (
        SELECT p.name, SUM(oi.quantity) as quantity, SUM(oi.total_price) as total
        FROM public.order_items oi
        JOIN public.products p ON oi.product_id = p.id
        JOIN public.orders o ON oi.order_id = o.id
        WHERE o.tenant_id = p_tenant_id AND o.created_at BETWEEN p_start_today AND p_end_today
          AND o.status != 'Draft' AND (v_is_admin OR o.seller_id = p_user_id)
        GROUP BY p.name ORDER BY total DESC LIMIT 5
    ) t;

    -- 5. Top 5 Clientes Hoy
    SELECT jsonb_agg(t) INTO v_top_cust FROM (
        SELECT c.business_name as name, SUM(o.total_amount) as total, COUNT(o.id) as orders_count
        FROM public.orders o
        JOIN public.customers c ON o.customer_id = c.id
        WHERE o.tenant_id = p_tenant_id AND o.created_at BETWEEN p_start_today AND p_end_today
          AND o.status != 'Draft' AND (v_is_admin OR o.seller_id = p_user_id)
        GROUP BY c.business_name ORDER BY total DESC LIMIT 5
    ) t;

    -- 6. Construcción del resultado con cálculo de tendencia normalizado
    -- Si el periodo anterior es 0 y hoy hay datos, marcamos 100% como "crecimiento infinito/inicial"
    RETURN jsonb_build_object(
        'today', jsonb_build_object(
            'total_sales', v_t_sales, 
            'orders_count', v_t_count, 
            'pending_orders', v_pending
        ),
        'comparison', jsonb_build_object(
            'previous_sales', v_y_sales,
            'previous_orders', v_y_count,
            'sales_trend', CASE 
                WHEN v_y_sales = 0 THEN (CASE WHEN v_t_sales > 0 THEN 100 ELSE 0 END) 
                ELSE ((v_t_sales - v_y_sales) / v_y_sales) * 100 
            END,
            'orders_trend', CASE 
                WHEN v_y_count = 0 THEN (CASE WHEN v_t_count > 0 THEN 100 ELSE 0 END) 
                ELSE ((v_t_count - v_y_count)::numeric / v_y_count) * 100 
            END
        ),
        'top_products', COALESCE(v_top_prod, '[]'::jsonb),
        'top_customers', COALESCE(v_top_cust, '[]'::jsonb)
    );
END;
$$;

COMMIT;
