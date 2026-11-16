-- Corrección de Recursión Infinita en RLS
-- Autor: @arquitecto
-- Fecha: 2026-02-21

-- 1. Eliminar políticas con error de recursión
DROP POLICY IF EXISTS "user_profiles_tenant_isolation" ON user_profiles;
DROP POLICY IF EXISTS "customers_tenant_isolation" ON customers;
DROP POLICY IF EXISTS "products_tenant_isolation" ON products;
DROP POLICY IF EXISTS "orders_tenant_isolation" ON orders;
DROP POLICY IF EXISTS "order_items_tenant_isolation" ON order_items;

-- 2. Función Helper con SECURITY DEFINER para romper la recursión
-- Esta función lee el tenant_id del usuario saltándose el RLS de la tabla user_profiles
CREATE OR REPLACE FUNCTION public.get_user_tenant()
RETURNS UUID AS $$
BEGIN
  RETURN (
    SELECT tenant_id 
    FROM public.user_profiles 
    WHERE id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Recreación de Políticas RLS usando la función blindada

-- PERFILES
CREATE POLICY "user_profiles_tenant_isolation" ON user_profiles
    FOR ALL USING (
        id = auth.uid() 
        OR tenant_id = public.get_user_tenant()
    )
    WITH CHECK (
        id = auth.uid() 
        OR tenant_id = public.get_user_tenant()
    );

-- CLIENTES
CREATE POLICY "customers_tenant_isolation" ON customers
    FOR ALL USING (
        tenant_id = public.get_user_tenant()
    )
    WITH CHECK (
        tenant_id = public.get_user_tenant()
    );

-- PRODUCTOS
CREATE POLICY "products_tenant_isolation" ON products
    FOR ALL USING (
        tenant_id = public.get_user_tenant()
    )
    WITH CHECK (
        tenant_id = public.get_user_tenant()
    );

-- PEDIDOS
CREATE POLICY "orders_tenant_isolation" ON orders
    FOR ALL USING (
        tenant_id = public.get_user_tenant()
    )
    WITH CHECK (
        tenant_id = public.get_user_tenant()
    );

-- DETALLE DE PEDIDOS
CREATE POLICY "order_items_tenant_isolation" ON order_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = order_items.order_id 
            AND orders.tenant_id = public.get_user_tenant()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = order_items.order_id 
            AND orders.tenant_id = public.get_user_tenant()
        )
    );
