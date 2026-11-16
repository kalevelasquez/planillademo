-- ============================================================
-- Migración: Blindaje Final de Pedidos (US-ORD-11 REINFORCED)
-- Autor: @arquitecto / Antigravity
-- Fecha: 2026-03-17
-- Razón: Los usuarios reportan violaciones de RLS al guardar pedidos.
--        Se unifican las políticas de INSERT/UPDATE/SELECT para usar 
--        funciones atómicas que previenen recursión y errores de tipos.
-- ============================================================

BEGIN;

-- 1. REPARACIÓN DE FUNCIONES BASE (Resiliencia ante datos corruptos)
-- Aseguramos que get_auth_roles devuelva siempre un array plano de texto
CREATE OR REPLACE FUNCTION public.get_auth_roles()
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
    v_roles_raw jsonb;
    v_roles_final text[];
BEGIN
    -- Intentar obtener desde el JWT
    v_roles_raw := auth.jwt() -> 'user_metadata' -> 'roles';
    IF v_roles_raw IS NULL THEN
        v_roles_raw := auth.jwt() -> 'user_metadata' -> 'role';
    END IF;

    -- Si está en el JWT, intentar aplanarlo si es array, sino envolverlo
    IF v_roles_raw IS NOT NULL THEN
        IF jsonb_typeof(v_roles_raw) = 'array' THEN
            SELECT ARRAY_AGG(DISTINCT val)::text[] INTO v_roles_final 
            FROM jsonb_array_elements_text(v_roles_raw) AS val;
        ELSE
            v_roles_final := ARRAY[v_roles_raw#>>'{}'];
        END IF;
    END IF;

    -- Si no se obtuvo nada o el array está vacío, ir a la tabla (fuente de verdad física)
    IF v_roles_final IS NULL OR array_length(v_roles_final, 1) IS NULL THEN
        SELECT role INTO v_roles_final FROM public.user_profiles WHERE id = auth.uid() LIMIT 1;
    END IF;

    -- Aplanado final por seguridad extrema (si venía corrupto de la tabla)
    RETURN COALESCE(
        ARRAY(SELECT DISTINCT unnest(v_roles_final) WHERE unnest IS NOT NULL),
        ARRAY['vendedor']
    );
END; $$;

-- 2. RECREACIÓN DE POLÍTICAS DE ORDERS (Unificar SELECT/INSERT/UPDATE)
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders_select_by_role" ON public.orders;
DROP POLICY IF EXISTS "orders_insert_policy" ON public.orders;
DROP POLICY IF EXISTS "orders_update_by_role" ON public.orders;
DROP POLICY IF EXISTS "orders_admin_delete" ON public.orders;

-- SELECT: Mismo tenant y (Admin/Supervisor/Despacho o Dueño)
CREATE POLICY "orders_select_v4" ON public.orders
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND (
        public.get_auth_roles() && ARRAY['admin', 'supervisor', 'despachador']::text[]
        OR seller_id = auth.uid()
    )
);

-- INSERT: Mismo tenant y (Admin/Supervisor o Dueño)
CREATE POLICY "orders_insert_v4" ON public.orders
FOR INSERT TO authenticated
WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND (
        public.get_auth_roles() && ARRAY['admin', 'supervisor']::text[]
        OR (seller_id = auth.uid() OR seller_id IS NULL) -- Permitir si es dueño o se asignará auto
    )
);

-- UPDATE: Mismo tenant y (Admin/Supervisor/Despacho o Dueño)
-- Nota: El despachador solo puede actualizar status, pero RLS es por fila.
CREATE POLICY "orders_update_v4" ON public.orders
FOR UPDATE TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND (
        public.get_auth_roles() && ARRAY['admin', 'supervisor', 'despachador']::text[]
        OR seller_id = auth.uid()
    )
)
WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND (
        public.get_auth_roles() && ARRAY['admin', 'supervisor', 'despachador']::text[]
        OR seller_id = auth.uid()
    )
);

-- DELETE: Solo Admin y pedidos no entregados
CREATE POLICY "orders_delete_v4" ON public.orders
FOR DELETE TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND 'admin' = ANY(public.get_auth_roles())
    AND status <> 'Delivered'
);

-- 3. ACTUALIZAR POLÍTICAS DE ORDER_ITEMS (Herencia Atómica)
-- Aseguramos que use la función SECURITY DEFINER para evitar recursión de select orders
DROP POLICY IF EXISTS "order_items_atomic_access" ON public.order_items;

CREATE POLICY "order_items_final_v4" ON public.order_items
FOR ALL TO authenticated
USING ( public.check_access_to_order_items(order_id) )
WITH CHECK ( public.check_access_to_order_items(order_id) );

COMMIT;
