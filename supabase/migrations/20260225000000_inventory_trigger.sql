-- Migración: Trigger de Deducción de Inventario
-- Autor: @arquitecto
-- Fecha: 2026-02-25
-- Descripción: Descuenta automáticamente la cantidad comprada del inventario del producto al confirmar un pedido de forma atómica a nivel de Postgres.

-- 1. Crear la función del Trigger
CREATE OR REPLACE FUNCTION public.deduct_inventory_on_order()
RETURNS TRIGGER AS $$
BEGIN
    -- Se actualiza atómicamente la cantidad disponible del producto
    UPDATE public.products
    SET available_quantity = available_quantity - NEW.quantity
    WHERE id = NEW.product_id;

    -- Nota de Arquitectura: La tabla 'products' ya cuenta con la restricción
    -- 'CHECK (available_quantity >= 0)' definida en la migración inicial.
    -- Si esta resta genera un número negativo (inventario insuficiente), 
    -- PostgreSQL arrojará un error de restricción y hará un ROLLBACK 
    -- automático de toda la transacción (fallará la creación del pedido).

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Asignar el Trigger a la tabla order_items
-- Se dispara DESPUÉS de que el insert del pedido se confirme exitosamente
DROP TRIGGER IF EXISTS on_order_item_created ON public.order_items;

CREATE TRIGGER on_order_item_created
    AFTER INSERT ON public.order_items
    FOR EACH ROW
    EXECUTE FUNCTION public.deduct_inventory_on_order();
