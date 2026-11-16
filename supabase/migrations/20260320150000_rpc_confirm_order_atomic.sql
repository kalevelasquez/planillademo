-- =============================================================================
-- MIGRACIÓN: rpc_confirm_order_atomic (US-ORD-12)
-- AUTOR: @programador — Antigravity/ImporFrut
-- FECHA: 2026-03-20
-- DESCRIPCIÓN: Implementa una confirmación atómica en una única transacción de DB.
--              Garantiza que la limpieza de items, inserción de items finales
--              y cambio de status ocurran 'todo o nada'.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.confirm_order_atomic(
    p_order_id UUID,
    p_order_number TEXT,
    p_subtotal DECIMAL,
    p_discount_type TEXT,
    p_discount_amount DECIMAL,
    p_total_amount DECIMAL,
    p_notes TEXT,
    p_items JSONB -- Array de objetos con product_id, quantity, unit_price, etc.
)
RETURNS VOID AS $$
DECLARE
    v_item JSONB;
BEGIN
    -- 1. Validar que el pedido aún sea un Borrador (Draft)
    -- Esto previene doble confirmación o race conditions con el autoguardado.
    IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND status = 'Draft') THEN
        RAISE EXCEPTION 'El pedido ya no es un borrador o no existe.';
    END IF;

    -- 2. Limpiar items previos (Asegura borrón y cuenta nueva para el pedido confirmado)
    DELETE FROM public.order_items WHERE order_id = p_order_id;

    -- 3. Insertar nuevos items definitivos (Evita inconsistencias por cortes de red)
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        INSERT INTO public.order_items (
            order_id, 
            product_id, 
            quantity, 
            unit_price, 
            total_price, 
            notes, 
            discount_type, 
            discount_amount
        ) VALUES (
            p_order_id,
            (v_item->>'product_id')::UUID,
            (v_item->>'quantity')::INTEGER,
            (v_item->>'unit_price')::DECIMAL,
            (v_item->>'total_price')::DECIMAL,
            v_item->>'notes',
            v_item->>'discount_type',
            (v_item->>'discount_amount')::DECIMAL
        );
    END LOOP;

    -- 4. Promover a Approved (esto disparará los triggers de stock en una sola pasada)
    UPDATE public.orders SET
        status = 'Approved',
        order_number = p_order_number,
        subtotal = p_subtotal,
        discount_type = p_discount_type,
        discount_amount = p_discount_amount,
        total_amount = p_total_amount,
        notes = p_notes,
        created_at = now() -- El folio PED- ahora coincide con el timestamp de confirmación
    WHERE id = p_order_id;

    -- Registrar evento en auditoría (Opcional, los triggers de auditoría ya capturarán el UPDATE)
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
