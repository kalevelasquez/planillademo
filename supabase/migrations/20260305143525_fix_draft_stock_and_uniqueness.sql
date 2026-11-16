-- =============================================================================
-- MIGRACIÓN: fix_draft_stock_and_uniqueness
-- =============================================================================
-- PROBLEMA 1: El trigger on_order_item_created descontaba inventario en
--             CUALQUIER INSERT sobre order_items, incluyendo borradores (Draft).
--             Solo debe descontar cuando el pedido raíz esté en 'Approved'.
--
-- PROBLEMA 2: Un vendedor podía acumular múltiples Drafts para el mismo cliente.
--             Restricción única: un solo Draft activo por (seller_id, customer_id).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 1: RESTAURAR STOCK DE BORRADORES EXISTENTES
-- Devuelve al inventario las cantidades que fueron descontadas por items de
-- pedidos que aún están en estado Draft.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.products p
SET available_quantity = p.available_quantity + sub.locked_qty
FROM (
    SELECT oi.product_id, SUM(oi.quantity) AS locked_qty
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.status = 'Draft'
    GROUP BY oi.product_id
) sub
WHERE p.id = sub.product_id;


-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 2: CORREGIR FUNCIÓN DE DESCUENTO DE INVENTARIO
-- La nueva versión consulta el status del pedido padre antes de descontar.
-- Solo actúa si el pedido está en 'Approved'. Para Drafts, no hace nada.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deduct_inventory_on_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_status TEXT;
BEGIN
    -- Leer el estado del pedido padre
    SELECT status INTO v_order_status
    FROM public.orders
    WHERE id = NEW.order_id;

    -- Solo descontar inventario si el pedido está Aprobado
    IF v_order_status = 'Approved' THEN
        UPDATE public.products
        SET available_quantity = available_quantity - NEW.quantity
        WHERE id = NEW.product_id;
        -- El CHECK (available_quantity >= 0) en la tabla products
        -- actuará como guardia contra stock negativo.
    END IF;

    RETURN NEW;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 3: TAMBIÉN DESCONTAR CUANDO UN DRAFT SE PROMUEVE A APPROVED
-- Cuando el status de orders cambia de 'Draft' → 'Approved', se deben
-- descontar los items ya insertados (que no fueron descontados antes).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deduct_inventory_on_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Solo actuar cuando el status cambia de Draft a Approved
    IF OLD.status = 'Draft' AND NEW.status = 'Approved' THEN
        UPDATE public.products p
        SET available_quantity = p.available_quantity - oi.quantity
        FROM public.order_items oi
        WHERE oi.order_id = NEW.id
          AND p.id = oi.product_id;
    END IF;

    RETURN NEW;
END;
$$;

-- Crear el trigger de promoción si no existe
DROP TRIGGER IF EXISTS on_order_approved ON public.orders;
CREATE TRIGGER on_order_approved
    AFTER UPDATE OF status ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.deduct_inventory_on_approval();


-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 4: ÍNDICE ÚNICO — UN SOLO DRAFT POR VENDEDOR + CLIENTE
-- Evita acumulación de múltiples borradores para la misma gestión.
-- Es un índice parcial (WHERE status = 'Draft'), no afecta pedidos confirmados.
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_orders_unique_draft_per_seller_customer;
CREATE UNIQUE INDEX idx_orders_unique_draft_per_seller_customer
    ON public.orders (seller_id, customer_id)
    WHERE status = 'Draft';
