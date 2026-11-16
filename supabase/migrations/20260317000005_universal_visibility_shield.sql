-- ============================================================
-- Migración: Blindaje Universal de Visibilidad (US-ORD-11)
-- Autor: @arquitecto / Antigravity
-- Fecha: 2026-03-16
-- Razón: Corrección definitiva de la desaparición de ítems.
--        Se unifica el uso de funciones SECURITY DEFINER para evitar
--        recursión RLS y inconsistencia entre roles.
-- ============================================================

BEGIN;

-- 1. Re-asegurar funciones base (Robustez extrema)
CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
    v_tid uuid;
BEGIN
    v_tid := (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid;
    IF v_tid IS NULL THEN
        SELECT tenant_id INTO v_tid FROM public.user_profiles WHERE id = auth.uid() LIMIT 1;
    END IF;
    RETURN v_tid;
END; $$;

CREATE OR REPLACE FUNCTION public.get_auth_roles()
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
    v_roles text[];
BEGIN
    v_roles := ARRAY(
        SELECT jsonb_array_elements_text(
            CASE 
                WHEN jsonb_typeof(auth.jwt() -> 'user_metadata' -> 'roles') = 'array' THEN auth.jwt() -> 'user_metadata' -> 'roles'
                WHEN jsonb_typeof(auth.jwt() -> 'user_metadata' -> 'role') = 'array' THEN auth.jwt() -> 'user_metadata' -> 'role'
                ELSE jsonb_build_array(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', 'vendedor'))
            END
        )
    );
    IF v_roles IS NULL OR array_length(v_roles, 1) IS NULL THEN
        SELECT role INTO v_roles FROM public.user_profiles WHERE id = auth.uid() LIMIT 1;
    END IF;
    RETURN COALESCE(v_roles, ARRAY['vendedor']);
END; $$;

-- 2. Función de acceso a ítems que incluye a DESPACHADORES y otros roles del tenant
CREATE OR REPLACE FUNCTION public.check_order_access_v3(p_order_id UUID)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
    v_order_tenant_id UUID;
    v_order_seller_id UUID;
    v_auth_tenant_id UUID;
    v_auth_roles text[];
BEGIN
    -- Info del pedido
    SELECT tenant_id, seller_id INTO v_order_tenant_id, v_order_seller_id
    FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN RETURN FALSE; END IF;

    -- Info del usuario
    v_auth_tenant_id := public.get_auth_tenant_id();
    v_auth_roles := public.get_auth_roles();

    -- Regla: Mismo tenant Y (admin/supervisor/despachador O dueño)
    RETURN (v_order_tenant_id = v_auth_tenant_id) AND (
        v_auth_roles && ARRAY['admin', 'supervisor', 'despachador']::text[]
        OR v_order_seller_id = auth.uid()
    );
END; $$;

-- 3. Aplicar a ORDER_ITEMS
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "order_items_access_policy" ON public.order_items;
DROP POLICY IF EXISTS "order_items_tenant_isolation" ON public.order_items;
DROP POLICY IF EXISTS "order_items_robust_access" ON public.order_items;

CREATE POLICY "order_items_universal_access" ON public.order_items
FOR ALL TO authenticated
USING ( public.check_order_access_v3(order_id) )
WITH CHECK ( public.check_order_access_v3(order_id) );

-- 4. Aplicar a PRODUCTS (Los productos DEBEN ser visibles para todo el tenant)
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products_tenant_isolation" ON public.products;
DROP POLICY IF EXISTS "products_tenant_read_policy" ON public.products;

CREATE POLICY "products_universal_read" ON public.products
FOR SELECT TO authenticated
USING ( tenant_id = public.get_auth_tenant_id() );

-- 5. Asegurar RLS de ORDERS coincida
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orders_select_by_role" ON public.orders;
CREATE POLICY "orders_select_by_role" ON public.orders
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND (
        public.get_auth_roles() && ARRAY['admin', 'supervisor', 'despachador']::text[]
        OR seller_id = auth.uid()
    )
);

COMMIT;
