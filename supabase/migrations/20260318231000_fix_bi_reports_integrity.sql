-- Migración: Corrección de Reportes BI (Vendedores y Productos)
-- Autor: @arquitecto / @operador — ImporFrut
-- Motivo: Garantizar que se muestren filas incluso con 0 ventas y arreglar filtrado agresivo.

BEGIN;

-- 1. Reporte de Vendedores: Eliminamos restricciones de is_active para ver historial completo
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
        GROUP BY up.id, up.full_name
        ORDER BY total_sales DESC
    ) t;
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- 2. Reporte de Productos: Arreglamos sumatoria condicional (COALESCE/CASE)
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
            COALESCE(p.category, 'Sin categoría') as category,
            COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.quantity ELSE 0 END), 0) as total_quantity,
            COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.total_price ELSE 0 END), 0) as total_revenue,
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

COMMIT;
