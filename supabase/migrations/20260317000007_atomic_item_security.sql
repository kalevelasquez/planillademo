-- ============================================================
-- Migración: Acceso Atómico Definidor (US-ORD-11 FIX)
-- Autor: @arquitecto / Antigravity
-- Fecha: 2026-03-17
-- Razón: Las subconsultas en RLS fallan para el rol vendedor.
--        Usamos una función SECURITY DEFINER para saltar la recursión.
-- ============================================================

BEGIN;

-- 1. Función de verificación atómica (Bypass RLS de orders)
CREATE OR REPLACE FUNCTION public.check_access_to_order_items(p_order_id UUID)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
    v_order_tenant_id UUID;
    v_order_seller_id UUID;
    v_auth_tenant_id UUID;
    v_auth_roles text[];
BEGIN
    -- Obtenemos datos del pedido directamente de la tabla (Bypass RLS)
    SELECT tenant_id, seller_id INTO v_order_tenant_id, v_order_seller_id
    FROM public.orders WHERE id = p_order_id;
    
    IF NOT FOUND THEN RETURN FALSE; END IF;

    -- Obtenemos datos del usuario (Usando las funciones blindadas del tenant)
    v_auth_tenant_id := public.get_auth_tenant_id();
    v_auth_roles := public.get_auth_roles();

    -- REGLA: Mismo tenant Y (Admin/Supervisor/Despacho O Dueño del pedido)
    RETURN (v_order_tenant_id = v_auth_tenant_id) AND (
        v_auth_roles && ARRAY['admin', 'supervisor', 'despachador']::text[]
        OR v_order_seller_id = auth.uid()
    );
END; $$;

-- 2. Limpieza y Aplicación a order_items
DROP POLICY IF EXISTS "order_items_parent_inheritance" ON public.order_items;
DROP POLICY IF EXISTS "order_items_universal_access" ON public.order_items;

CREATE POLICY "order_items_atomic_access" ON public.order_items
FOR ALL TO authenticated
USING ( public.check_access_to_order_items(order_id) )
WITH CHECK ( public.check_access_to_order_items(order_id) );

-- 3. Blindaje de Productos (Lectura Tenant Directa)
DROP POLICY IF EXISTS "products_tenant_read_v4" ON public.products;
CREATE POLICY "products_tenant_read_v5" ON public.products
FOR SELECT TO authenticated
USING ( tenant_id = public.get_auth_tenant_id() );

COMMIT;
