-- ============================================================
-- Migración: Sincronización robusta de inventario en edición
-- Autor: @arquitecto — ImporFrut
-- Fecha: 2026-03-16
-- Propósito: Garantizar que al editar o eliminar ítems de un 
--            pedido CONFIRMADO, el inventario se ajuste correctamente.
-- ============================================================

-- 1. Función para manejar cambios en order_items (DELETE y UPDATE)
CREATE OR REPLACE FUNCTION public.handle_order_item_inventory_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_status TEXT;
BEGIN
    -- Obtener el estado del pedido actual
    -- Usamos OLD porque tanto en UPDATE como en DELETE el registro previo existe
    SELECT status INTO v_order_status
    FROM public.orders
    WHERE id = OLD.order_id;

    -- Solo actuar si el pedido ya había descontado stock
    -- (Approved, In Preparation, Delivered)
    IF v_order_status IN ('Approved', 'In Preparation', 'Delivered') THEN
        
        IF (TG_OP = 'DELETE') THEN
            -- Al eliminar una línea, regresamos el stock al piso
            UPDATE public.products
            SET available_quantity = available_quantity + OLD.quantity
            WHERE id = OLD.product_id;
            
        ELSIF (TG_OP = 'UPDATE') THEN
            -- Al actualizar cantidad, ajustamos por la diferencia
            -- Si NEW > OLD: se resta más stock
            -- Si NEW < OLD: se devuelve stock
            IF OLD.quantity IS DISTINCT FROM NEW.quantity THEN
                UPDATE public.products
                SET available_quantity = available_quantity - (NEW.quantity - OLD.quantity)
                WHERE id = OLD.product_id;
            END IF;
        END IF;
        
    END IF;

    IF (TG_OP = 'DELETE') THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

-- 2. Asignar triggers a order_items
DROP TRIGGER IF EXISTS on_order_item_deleted ON public.order_items;
CREATE TRIGGER on_order_item_deleted
    BEFORE DELETE ON public.order_items
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_order_item_inventory_change();

DROP TRIGGER IF EXISTS on_order_item_updated ON public.order_items;
CREATE TRIGGER on_order_item_updated
    AFTER UPDATE OF quantity ON public.order_items
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_order_item_inventory_change();

-- 3. Nota: El trigger 'on_order_item_created' ya existe y maneja INSERTs 
--    solo si el status es 'Approved'. Esto se mantiene igual.
