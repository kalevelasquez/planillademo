-- Migración: Debug - Máxima Visibilidad en Reportes BI
-- Autor: @operador / @arquitecto — ImporFrut
-- Motivo: Diagnosticar por qué Productos y Vendedores no aparecen.
-- Eliminamos filtros de fecha, estatus y roles para forzar visibilidad del base set.

BEGIN;

-- 1. Reporte de Vendedores (Versión Debug)
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
            0 as avg_ticket 
        FROM public.user_profiles up
        LEFT JOIN public.orders o ON up.id = o.seller_id 
        WHERE up.tenant_id = p_tenant_id 
        -- ELIMINADOS FILTROS DE ROL, ESTATUS Y FECHA PARA DEBUG --
        GROUP BY up.id, up.full_name
        ORDER BY total_sales DESC
    ) t;
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- 2. Reporte de Productos (Versión Debug)
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
            COALESCE(SUM(oi.quantity), 0) as total_quantity,
            COALESCE(SUM(oi.total_price), 0) as total_revenue,
            COUNT(DISTINCT o.id) as orders_count
        FROM public.products p
        LEFT JOIN public.order_items oi ON p.id = oi.product_id
        LEFT JOIN public.orders o ON oi.order_id = o.id
        WHERE p.tenant_id = p_tenant_id
        -- ELIMINADOS FILTROS DE FECHA Y ESTATUS PARA DEBUG --
        GROUP BY p.id, p.name, p.category
        ORDER BY total_quantity DESC
    ) t;
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMIT;
