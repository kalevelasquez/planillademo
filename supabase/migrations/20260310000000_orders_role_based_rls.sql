-- ============================================================
-- Migración: RLS diferenciado por rol en tabla orders
-- Autor: @arquitecto — ImporFrut / Teknergy Inc.
-- Fecha: 2026-03-10
-- US: US-HIS-01 — Lista de Pedidos con Filtros (CA5)
-- ============================================================
-- Propósito:
--   La política anterior "orders_tenant_isolation" (FOR ALL) solo aislaba
--   por tenant_id. Ahora se necesita que:
--     - vendedor   → solo puede VER sus propios pedidos (seller_id = auth.uid())
--     - supervisor → puede VER todos los pedidos de su tenant
--     - admin      → acceso completo a todos los pedidos del tenant
--   El DELETE físico queda prohibido para todos los roles.
-- ============================================================

-- 1. Eliminar políticas anteriores (si existen)
DROP POLICY IF EXISTS "orders_tenant_isolation" ON orders;
DROP POLICY IF EXISTS "orders_select_by_role" ON orders;
DROP POLICY IF EXISTS "orders_insert_own_tenant" ON orders;
DROP POLICY IF EXISTS "orders_update_by_role" ON orders;
DROP POLICY IF EXISTS "orders_no_delete" ON orders;

-- 2. SELECT diferenciado por rol
CREATE POLICY "orders_select_by_role" ON orders
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    AND (
      (SELECT role FROM public.user_profiles WHERE id = auth.uid()) <> 'vendedor'
      OR seller_id = auth.uid()
    )
  );

-- 3. INSERT: cualquier usuario autenticado puede crear pedidos de su propio tenant
CREATE POLICY "orders_insert_own_tenant" ON orders
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
  );

-- 4. UPDATE diferenciado por rol
CREATE POLICY "orders_update_by_role" ON orders
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    AND (
      (SELECT role FROM public.user_profiles WHERE id = auth.uid()) <> 'vendedor'
      OR seller_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
  );

-- 5. DELETE: Prohibido para todos
CREATE POLICY "orders_no_delete" ON orders
  FOR DELETE USING (false);
