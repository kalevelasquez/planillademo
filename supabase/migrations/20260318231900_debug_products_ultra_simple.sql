-- Migración: Diagnóstico Ultra-Simplificado de Productos
-- Autor: @operador — ImporFrut
-- Motivo: Eliminar cualquier complejidad de JOIN para verificar si el problema es la existencia de datos.

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
        -- Intento de lectura directa de la tabla maestra sin joins
        SELECT 
            id as product_id,
            name as product_name,
            COALESCE(category, 'Sin categoría') as category,
            0 as total_quantity,
            0 as total_revenue,
            0 as orders_count
        FROM public.products
        WHERE tenant_id = p_tenant_id
        LIMIT 100
    ) t;
    -- Si v_result sigue siendo NULL, v_result será '[]'::jsonb
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMIT;
