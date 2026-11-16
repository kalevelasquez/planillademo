-- Migración: Reportes BI Avanzados (US-REP-03)
-- Autor: @arquitecto — ImporFrut

BEGIN;

-- 1. Reporte de Vendedores (CA1, CA4)
CREATE OR REPLACE FUNCTION public.get_report_sellers(
    p_tenant_id UUID,
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(t) INTO v_result
    FROM (
        SELECT 
            up.id as seller_id,
            up.full_name as seller_name,
            COUNT(o.id) as orders_count,
            COALESCE(SUM(o.total_amount), 0) as total_sales,
            CASE 
                WHEN COUNT(o.id) > 0 THEN ROUND(SUM(o.total_amount) / COUNT(o.id), 2)
                ELSE 0 
            END as avg_ticket
        FROM public.user_profiles up
        LEFT JOIN public.orders o ON up.id = o.seller_id 
              AND o.created_at >= p_start_date 
              AND o.created_at <= p_end_date
              AND o.status NOT IN ('borrador', 'cancelado', 'Draft', 'Cancelled')
        WHERE up.tenant_id = p_tenant_id 
          AND up.role IN ('admin', 'supervisor', 'vendedor')
          AND up.is_active = true
        GROUP BY up.id, up.full_name
        ORDER BY total_sales DESC
    ) t;
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- 2. Reporte de Productos (CA2, CA4)
CREATE OR REPLACE FUNCTION public.get_report_products(
    p_tenant_id UUID,
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(t) INTO v_result
    FROM (
        SELECT 
            p.id as product_id,
            p.name as product_name,
            p.category,
            COALESCE(SUM(oi.quantity), 0) as total_quantity,
            COALESCE(SUM(oi.total_price), 0) as total_revenue,
            COUNT(DISTINCT o.id) as orders_count
        FROM public.products p
        LEFT JOIN public.order_items oi ON p.id = oi.product_id
        LEFT JOIN public.orders o ON oi.order_id = o.id 
              AND o.created_at >= p_start_date 
              AND o.created_at <= p_end_date
              AND o.status NOT IN ('borrador', 'cancelado', 'Draft', 'Cancelled')
        WHERE p.tenant_id = p_tenant_id
        GROUP BY p.id, p.name, p.category
        ORDER BY total_quantity DESC
    ) t;
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- 3. Reporte de Clientes (CA3, CA4)
CREATE OR REPLACE FUNCTION public.get_report_customers(
    p_tenant_id UUID,
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(t) INTO v_result
    FROM (
        SELECT 
            c.id as customer_id,
            c.business_name,
            COUNT(o.id) as total_orders,
            COALESCE(SUM(o.total_amount), 0) as accumulated_amount,
            MAX(o.created_at) as last_order_at,
            CASE 
                WHEN MAX(o.created_at) < (NOW() - INTERVAL '30 days') THEN true 
                WHEN MAX(o.created_at) IS NULL THEN true
                ELSE false 
            END as is_inactive,
            ROUND(COUNT(o.id)::numeric / NULLIF(EXTRACT(EPOCH FROM (p_end_date - p_start_date)) / 2592000, 0)::numeric, 2) as monthly_frequency
        FROM public.customers c
        LEFT JOIN public.orders o ON c.id = o.customer_id 
              AND o.created_at >= p_start_date 
              AND o.created_at <= p_end_date
              AND o.status NOT IN ('borrador', 'cancelado', 'Draft', 'Cancelled')
        WHERE c.tenant_id = p_tenant_id AND c.deleted_at IS NULL
        GROUP BY c.id, c.business_name
        ORDER BY accumulated_amount DESC
    ) t;
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMIT;
