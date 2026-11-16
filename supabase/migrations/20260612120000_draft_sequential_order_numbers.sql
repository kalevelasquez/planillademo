-- =============================================================================
-- MIGRACIÓN: draft_sequential_order_numbers
-- DESCRIPCIÓN: El número correlativo (PED-YYYYMMDD-NNNN) se asigna al crear
--              el borrador, no al confirmarlo. confirm_order_atomic ya no genera
--              un número nuevo — lo lee del draft y lo conserva.
--              El número del draft y del pedido confirmado son SIEMPRE el mismo.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.confirm_order_atomic(
    p_order_id        UUID,
    p_subtotal        DECIMAL,
    p_discount_type   TEXT,
    p_discount_amount DECIMAL,
    p_total_amount    DECIMAL,
    p_notes           TEXT,
    p_items           JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item         JSONB;
    v_order_number TEXT;
BEGIN
    -- Leer el número correlativo del draft (asignado al crearlo).
    -- Si el pedido no existe o ya no es Draft, v_order_number queda NULL.
    SELECT order_number INTO v_order_number
    FROM public.orders
    WHERE id = p_order_id AND status = 'Draft';

    IF v_order_number IS NULL THEN
        RAISE EXCEPTION 'El pedido ya no es un borrador o no existe.';
    END IF;

    -- Limpiar items previos
    DELETE FROM public.order_items WHERE order_id = p_order_id;

    -- Insertar items definitivos
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        INSERT INTO public.order_items (
            order_id, product_id, quantity, unit_price, total_price,
            notes, discount_type, discount_amount
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

    -- Promover a Approved conservando el order_number del draft
    UPDATE public.orders SET
        status          = 'Approved',
        subtotal        = p_subtotal,
        discount_type   = p_discount_type,
        discount_amount = p_discount_amount,
        total_amount    = p_total_amount,
        notes           = p_notes,
        created_at      = now()
    WHERE id = p_order_id;

    RETURN v_order_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_order_atomic(UUID, DECIMAL, TEXT, DECIMAL, DECIMAL, TEXT, JSONB) TO authenticated;
