-- Migración Final: Corrección de Schema de Productos en Reportes BI
-- Autor: @operador — ImporFrut
-- Motivo: La columna 'category' fue reemplazada por 'category_id'. Se restaura el reporte real con filtros.

BEGIN;

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
            COALESCE(pc.name, 'Sin categoría') as category,
            COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.quantity ELSE 0 END), 0) as total_quantity,
            COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.total_price ELSE 0 END), 0) as total_revenue,
            COUNT(DISTINCT o.id) as orders_count
        FROM public.products p
        LEFT JOIN public.product_categories pc ON p.category_id = pc.id
        LEFT JOIN public.order_items oi ON p.id = oi.product_id
        LEFT JOIN public.orders o ON oi.order_id = o.id 
              AND o.created_at >= p_start_date 
              AND o.created_at <= p_end_date
              AND o.status NOT IN ('borrador', 'cancelado', 'Draft', 'Cancelled')
        WHERE p.tenant_id = p_tenant_id
        GROUP BY p.id, p.name, pc.name
        ORDER BY total_quantity DESC
    ) t;
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMIT;
