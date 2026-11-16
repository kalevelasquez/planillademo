-- Migration: Fix Orders RLS for Dispatchers
-- Author: Antigravity
-- Fecha: 2026-03-16
-- Descripción: Permite que los usuarios con rol 'despachador' puedan ver pedidos del tenant.
--              Anteriormente solo admin, supervisor y el vendedor del pedido podían verlos.

BEGIN;

-- 1. Actualizar la política de selección de pedidos
DROP POLICY IF EXISTS "orders_select_by_role" ON public.orders;

CREATE POLICY "orders_select_by_role" ON public.orders
  FOR SELECT USING (
    tenant_id = public.get_auth_tenant_id()
    AND (
      'admin' = ANY(public.get_auth_roles()) OR 
      'supervisor' = ANY(public.get_auth_roles()) OR 
      'despachador' = ANY(public.get_auth_roles()) OR
      seller_id = auth.uid()
    )
  );

-- 2. Asegurar que el despachador pueda actualizar pedidos (para cambiar a IN_PREPARATION y DELIVERED)
DROP POLICY IF EXISTS "orders_update_by_role" ON public.orders;

CREATE POLICY "orders_update_by_role" ON public.orders
  FOR UPDATE USING (
    tenant_id = public.get_auth_tenant_id()
    AND (
      'admin' = ANY(public.get_auth_roles()) OR 
      'supervisor' = ANY(public.get_auth_roles()) OR 
      'despachador' = ANY(public.get_auth_roles()) OR
      seller_id = auth.uid()
    )
  );

COMMIT;
