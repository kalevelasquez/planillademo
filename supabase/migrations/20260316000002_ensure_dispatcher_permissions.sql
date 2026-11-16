-- Migration: Ensure Dispatcher Permissions
-- Author: Antigravity
-- Fecha: 2026-03-16
-- Descripción: Asegura que el rol 'despachador' tenga acceso de lectura a clientes, productos y detalles de pedido.

BEGIN;

-- Permisos para Clientes (Necesario para ver dirección/teléfono en despacho)
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customers_select_dispatch" ON public.customers;
CREATE POLICY "customers_select_dispatch" ON public.customers
    FOR SELECT USING (
        tenant_id = public.get_auth_tenant_id() AND
        ('admin' = ANY(public.get_auth_roles()) OR 
         'supervisor' = ANY(public.get_auth_roles()) OR 
         'despachador' = ANY(public.get_auth_roles()) OR
         assigned_seller_id = auth.uid())
    );

-- Permisos para Productos (Necesario para ver qué mercadería se despacha)
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products_select_dispatch" ON public.products;
CREATE POLICY "products_select_dispatch" ON public.products
    FOR SELECT USING (
        tenant_id = public.get_auth_tenant_id()
    );

-- Permisos para Detalles de Pedido (Order Items)
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "order_items_select_dispatch" ON public.order_items;
CREATE POLICY "order_items_select_dispatch" ON public.order_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.orders 
            WHERE orders.id = order_items.order_id 
            AND orders.tenant_id = public.get_auth_tenant_id()
        )
    );

COMMIT;
