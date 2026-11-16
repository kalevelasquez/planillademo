-- =============================================================================
-- MIGRACIÓN: confirm_order_for_update_lock
-- DESCRIPCIÓN: Agrega FOR UPDATE al SELECT de confirm_order_atomic para que
--              dos transacciones concurrentes no puedan ambas leer el draft
--              antes de que alguna haga COMMIT.
--              Sin FOR UPDATE, con READ COMMITTED dos llamadas simultáneas
--              pueden pasar el check WHERE status='Draft' y ambas insertar
--              sus items, resultando en duplicación.
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
    v_draft_number TEXT;
    v_order_number TEXT;
BEGIN
    -- FOR UPDATE bloquea el row: si dos transacciones llegan al mismo tiempo,
    -- la segunda espera hasta que la primera haga COMMIT. Al liberarse el lock,
    -- la segunda lee status='Approved' y falla limpiamente.
    SELECT order_number INTO v_draft_number
    FROM public.orders
    WHERE id = p_order_id AND status = 'Draft'
    FOR UPDATE;

    IF v_draft_number IS NULL THEN
        RAISE EXCEPTION 'El pedido ya no es un borrador o no existe.';
    END IF;

    -- Convertir prefijo: DRAFT-YYYYMMDD-NNNN → PED-YYYYMMDD-NNNN
    v_order_number := replace(v_draft_number, 'DRAFT-', 'PED-');

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

    -- Promover a Approved actualizando el prefijo en order_number
    UPDATE public.orders SET
        status          = 'Approved',
        order_number    = v_order_number,
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
