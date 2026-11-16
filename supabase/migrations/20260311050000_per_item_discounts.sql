-- Migración: Descuentos por ítem en Pedidos
-- Autor: Antigravity
-- Fecha: 2026-03-11

-- 1. Agregar columnas de descuento a order_items (si no existen)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='order_items' AND column_name='discount_type') THEN
        ALTER TABLE public.order_items ADD COLUMN discount_type TEXT CHECK (discount_type IN ('fixed', 'percentage'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='order_items' AND column_name='discount_amount') THEN
        ALTER TABLE public.order_items ADD COLUMN discount_amount DECIMAL(12,2) DEFAULT 0;
    END IF;
END $$;

-- 2. Comentario informativo
COMMENT ON COLUMN public.order_items.discount_type IS 'Tipo de descuento aplicado al producto (fixed o percentage)';
COMMENT ON COLUMN public.order_items.discount_amount IS 'Monto del descuento calculado para esta línea';

-- 3. Actualizar la vista o triggers si fuera necesario (opcional)
-- Por ahora solo las columnas, la lógica de cálculo reside en el frontend (OrderSummaryView)
-- y se persiste mediante el orderService.
