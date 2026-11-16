-- ============================================================
-- Migración: Reversión de inventario al cancelar pedidos
-- Autor: @arquitecto — ImporFrut
-- Fecha: 2026-03-11
-- Propósito: Garantizar que al cancelar un pedido que ya había 
--            descontado stock, las unidades regresen al inventario.
-- ============================================================

-- 1. Función para recuperar el inventario
CREATE OR REPLACE FUNCTION public.recover_inventory_on_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Solo actuar cuando el status cambia a 'Cancelled'
    -- Y el estado anterior era uno que ya había descontado stock 
    -- (Approved, In Preparation, Delivered)
    IF NEW.status = 'Cancelled' AND 
       OLD.status IN ('Approved', 'In Preparation', 'Delivered') 
    THEN
        -- Devolver las cantidades de todos los items del pedido al piso
        UPDATE public.products p
        SET available_quantity = p.available_quantity + oi.quantity
        FROM public.order_items oi
        WHERE oi.order_id = NEW.id
          AND p.id = oi.product_id;
          
        -- Opcional: Registrar en el log de auditoría (si existiera)
    END IF;

    RETURN NEW;
END;
$$;

-- 2. Crear el trigger en la tabla orders
-- Se dispara después de una actualización del campo status
DROP TRIGGER IF EXISTS on_order_cancelled ON public.orders;
CREATE TRIGGER on_order_cancelled
    AFTER UPDATE OF status ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.recover_inventory_on_cancellation();


-- 3. Nota de Seguridad (RLS)
-- Los permisos de Admin ya permiten realizar este UPDATE. 
-- El trigger corre como SECURITY DEFINER para tener permisos sobre la tabla products.
