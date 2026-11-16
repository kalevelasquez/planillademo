-- ============================================================
-- Migración: Blindaje Final de Visibilidad para Order Items (US-ORD-10)
-- Autor: @arquitecto / Antigravity
-- Fecha: 2026-03-16
-- Razón: Se han reportado visualizaciones vacías en el visor de pedidos.
--        Esto suele ocurrir por fallos en las funciones de RLS que 
--        dependen de joins anidados o consultas recursivas al perfil.
-- ============================================================

BEGIN;

-- 1. Función de comprobación ultra-robusta (Security Definer para saltar RLS de orders)
CREATE OR REPLACE FUNCTION public.check_order_item_access_v2(p_order_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    v_order_tenant_id UUID;
    v_order_seller_id UUID;
    v_auth_tenant_id UUID;
    v_auth_roles text[];
BEGIN
    -- 1. Obtener datos del pedido directamente de la tabla (Bypass RLS)
    SELECT tenant_id, seller_id INTO v_order_tenant_id, v_order_seller_id
    FROM public.orders WHERE id = p_order_id;
    
    IF NOT FOUND THEN RETURN FALSE; END IF;

    -- 2. Obtener datos del usuario (Bypass RLS de profiles)
    SELECT tenant_id, role INTO v_auth_tenant_id, v_auth_roles 
    FROM public.user_profiles WHERE id = auth.uid();

    -- 3. Si no hay perfil, denegar
    IF v_auth_tenant_id IS NULL THEN RETURN FALSE; END IF;

    -- 4. REGLA DE ORO: 
    --    - Mismo tenant
    --    - Y (Es Admin o Supervisor O es el Vendedor dueño del pedido)
    RETURN (v_order_tenant_id = v_auth_tenant_id) AND (
        v_auth_roles && ARRAY['admin', 'supervisor']::text[]
        OR v_order_seller_id = auth.uid()
    );
END;
$$;

-- 2. Aplicar la nueva función a la política
DROP POLICY IF EXISTS "order_items_access_policy" ON public.order_items;
DROP POLICY IF EXISTS "order_items_tenant_isolation" ON public.order_items;

CREATE POLICY "order_items_robust_access" ON public.order_items
FOR ALL TO authenticated
USING ( public.check_order_item_access_v2(order_id) )
WITH CHECK ( public.check_order_item_access_v2(order_id) );

-- 3. Reparar RLS de products para asegurar que siempre sean legibles dentro del tenant
--    independientemente de roles complejos, ya que son datos maestros.
DROP POLICY IF EXISTS "products_tenant_isolation" ON public.products;
CREATE POLICY "products_tenant_read_policy" ON public.products
FOR SELECT TO authenticated
USING ( 
    tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
);

COMMIT;
