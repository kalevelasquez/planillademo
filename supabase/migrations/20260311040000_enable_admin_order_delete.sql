-- ============================================================
-- Migración: Habilitar eliminación de pedidos para administradores
-- Autor: Antigravity — ImporFrut
-- Fecha: 2026-03-11
-- Propósito: 
--   1. Permitir que los administradores eliminen pedidos (hard delete).
--   2. Garantizar que al eliminar un pedido se recupere el stock.
--   3. Restringir la eliminación de pedidos con estado 'Delivered'.
-- ============================================================

-- 1. Actualizar RLS para permitir DELETE a Administradores
DROP POLICY IF EXISTS "orders_no_delete" ON public.orders;

CREATE POLICY "orders_admin_delete" ON public.orders
  FOR DELETE USING (
    tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.user_profiles WHERE id = auth.uid()) = 'admin'
    AND status <> 'Delivered'
  );

-- 2. Función para recuperar el inventario antes de un DELETE
CREATE OR REPLACE FUNCTION public.recover_inventory_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Solo recuperar stock si el estado actual es uno que ya descontó inventario
    -- (Approved, In Preparation, Delivered)
    IF OLD.status IN ('Approved', 'In Preparation', 'Delivered', 'Cancelled') THEN
        -- Nota: Si el pedido ya estaba 'Cancelled', el stock ya se recuperó por el trigger UPDATE.
        -- Si ya estaba recover_inventory_on_cancellation() no queremos duplicar.
        -- Pero si el Admin borra un APPROVED directamente, necesitamos recuperarlo aquí.
        
        -- Para evitar doble recuperación (si se borra un Cancelled), 
        -- podríamos verificar si el stock ya fue revertido, pero es más simple 
        -- asegurar que el trigger de UPDATE maneja la transición y el de DELETE 
        -- maneja la eliminación física.
        
        -- Si el estado era 'Cancelled', el stock ya regresó. No hacemos nada.
        IF OLD.status <> 'Cancelled' THEN
            UPDATE public.products p
            SET available_quantity = p.available_quantity + oi.quantity
            FROM public.order_items oi
            WHERE oi.order_id = OLD.id
              AND p.id = oi.product_id;
        END IF;
    END IF;

    RETURN OLD;
END;
$$;

-- 3. Crear el trigger BEFORE DELETE en la tabla orders
DROP TRIGGER IF EXISTS on_order_deleted ON public.orders;
CREATE TRIGGER on_order_deleted
    BEFORE DELETE ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.recover_inventory_before_delete();
