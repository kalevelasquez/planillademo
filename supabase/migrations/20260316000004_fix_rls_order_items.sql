-- ============================================================
-- Migración: Corrección de RLS para Confimación de Pedidos
-- Autor: @arquitecto — ImporFrut
-- Fecha: 2026-03-16
-- Razón: El 403 en order_items se debe a que la subconsulta EXISTS
--        está sujeta a la RLS de 'orders' y la sincronización del JWT
--        con user_metadata puede fallar. Cambiamos a funciones
--        SECURITY DEFINER que consultan directamente la tabla.
-- ============================================================

BEGIN;

-- 1. Actualizar get_auth_roles para ser la fuente de verdad definitiva (Tabla, no JWT)
CREATE OR REPLACE FUNCTION public.get_auth_roles()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER -- Bypass RLS de user_profiles
SET search_path = public
STABLE
AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$;

-- 2. Actualizar get_auth_role para consistencia
CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role[1] FROM public.user_profiles WHERE id = auth.uid();
$$;

-- 3. Optimizar RLS de order_items para evitar dependencia de SELECT en orders
--    Usamos una función SECURITY DEFINER para validar el parentesco sin RLS overhead.
CREATE OR REPLACE FUNCTION public.check_order_item_access(p_order_id UUID)
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
    -- Obtener datos del pedido
    SELECT tenant_id, seller_id INTO v_order_tenant_id, v_order_seller_id
    FROM public.orders WHERE id = p_order_id;

    IF NOT FOUND THEN RETURN FALSE; END IF;

    -- Obtener datos del usuario actual
    v_auth_tenant_id := public.get_auth_tenant_id();
    v_auth_roles := public.get_auth_roles();

    -- Regla de acceso: Mismo tenant Y (admin/supervisor O dueño del pedido)
    RETURN (v_order_tenant_id = v_auth_tenant_id) AND (
        'admin' = ANY(v_auth_roles) OR 
        'supervisor' = ANY(v_auth_roles) OR 
        v_order_seller_id = auth.uid()
    );
END;
$$;

-- 4. Aplicar nueva política a order_items
DROP POLICY IF EXISTS "order_items_tenant_isolation" ON public.order_items;

CREATE POLICY "order_items_access_policy" ON public.order_items
FOR ALL TO authenticated
USING ( public.check_order_item_access(order_id) )
WITH CHECK ( public.check_order_item_access(order_id) );

COMMIT;
