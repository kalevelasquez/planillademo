-- =============================================================================
-- MIGRACIÓN: sequential_order_numbers
-- DESCRIPCIÓN: Reemplaza el folio aleatorio (Math.random) por un correlativo
--              global atómico. El contador NUNCA se resetea entre días.
--              Formato: PED-YYYYMMDD-NNNN
--              Ejemplo: PED-20260612-0001, PED-20260613-0010 (continúa)
-- =============================================================================

-- 1. Secuencia global de pedidos (contador único, sin reset)
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    NO CYCLE;

GRANT USAGE ON SEQUENCE public.order_number_seq TO authenticated;

-- 2. Helper: obtiene y formatea el próximo número correlativo
CREATE OR REPLACE FUNCTION public.next_order_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_seq BIGINT;
BEGIN
    v_seq := nextval('public.order_number_seq');
    -- lpad garantiza mínimo 4 dígitos; si supera 9999 crece naturalmente (0001→9999→10000)
    RETURN 'PED-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' || lpad(v_seq::TEXT, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_order_number() TO authenticated;

-- 3. Reemplazar confirm_order_atomic
--    Cambios respecto a la versión anterior:
--      - Se elimina el parámetro p_order_number (el frontend ya no lo genera)
--      - RETURNS TEXT en lugar de VOID (devuelve el número generado)
--      - La generación del número es interna y atómica dentro de la transacción
DROP FUNCTION IF EXISTS public.confirm_order_atomic(UUID, TEXT, DECIMAL, TEXT, DECIMAL, DECIMAL, TEXT, JSONB);

CREATE FUNCTION public.confirm_order_atomic(
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
    -- Validar que el pedido sigue siendo un Draft (previene doble confirmación)
    IF NOT EXISTS (
        SELECT 1 FROM public.orders WHERE id = p_order_id AND status = 'Draft'
    ) THEN
        RAISE EXCEPTION 'El pedido ya no es un borrador o no existe.';
    END IF;

    -- Generar número correlativo atómico (dentro de la misma transacción)
    v_order_number := public.next_order_number();

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

    -- Promover a Approved con el número correlativo generado
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

-- 4. Nueva función para pedidos directos (sin draft previo)
--    Consolida en una sola transacción lo que antes era un INSERT de cabecera
--    + INSERT de items desde el frontend (dos round-trips separados).
CREATE OR REPLACE FUNCTION public.create_direct_order_atomic(
    p_tenant_id       UUID,
    p_customer_id     UUID,
    p_seller_id       UUID,
    p_subtotal        DECIMAL,
    p_discount_type   TEXT,
    p_discount_amount DECIMAL,
    p_total_amount    DECIMAL,
    p_notes           TEXT,
    p_items           JSONB
)
RETURNS TABLE(order_id UUID, order_number TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_id     UUID;
    v_order_number TEXT;
    v_item         JSONB;
BEGIN
    -- Limpiar borradores previos del mismo vendedor+cliente (evita duplicidad)
    DELETE FROM public.orders
    WHERE customer_id = p_customer_id
      AND seller_id   = p_seller_id
      AND status      = 'Draft';

    -- Generar número correlativo atómico
    v_order_number := public.next_order_number();

    -- Insertar cabecera del pedido
    INSERT INTO public.orders (
        tenant_id, order_number, customer_id, seller_id,
        status, subtotal, discount_type, discount_amount, total_amount, notes
    ) VALUES (
        p_tenant_id, v_order_number, p_customer_id, p_seller_id,
        'Approved', p_subtotal, p_discount_type, p_discount_amount, p_total_amount, p_notes
    )
    RETURNING id INTO v_order_id;

    -- Insertar items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        INSERT INTO public.order_items (
            order_id, product_id, quantity, unit_price, total_price,
            notes, discount_type, discount_amount
        ) VALUES (
            v_order_id,
            (v_item->>'product_id')::UUID,
            (v_item->>'quantity')::INTEGER,
            (v_item->>'unit_price')::DECIMAL,
            (v_item->>'total_price')::DECIMAL,
            v_item->>'notes',
            v_item->>'discount_type',
            (v_item->>'discount_amount')::DECIMAL
        );
    END LOOP;

    RETURN QUERY SELECT v_order_id, v_order_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_direct_order_atomic(UUID, UUID, UUID, DECIMAL, TEXT, DECIMAL, DECIMAL, TEXT, JSONB) TO authenticated;
