-- ============================================================
-- Migración: Campos de Descuento y Subtotal en Tabla Orders
-- HO: 27-Feb-2026 | Blueprint: §Paso 2
-- ============================================================

-- 1. Añadir columnas (idempotente con IF NOT EXISTS)
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS subtotal        NUMERIC(12,2) DEFAULT 0 CHECK (subtotal >= 0),
    ADD COLUMN IF NOT EXISTS discount_type   TEXT          CHECK (discount_type IN ('percentage', 'fixed')),
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) DEFAULT 0 CHECK (discount_amount >= 0);

-- 2. Backfill: rellenar subtotal en pedidos existentes (RN-ORD-05)
--    Asumimos que pedidos sin descuento tienen subtotal == total_amount
UPDATE orders
    SET subtotal = total_amount
WHERE subtotal IS NULL OR subtotal = 0;

-- 3. Función de cálculo server-side (Regla de Oro RN-ORD-01)
--    El trigger SOBREESCRIBE total_amount en cada INSERT/UPDATE.
--    El cliente no necesita calcularlo; se acepta el valor retornado por la DB.
CREATE OR REPLACE FUNCTION orders_compute_total()
RETURNS TRIGGER AS $$
BEGIN
    -- RN-ORD-01: total_amount es siempre calculado por la base de datos
    NEW.total_amount := NEW.subtotal - COALESCE(NEW.discount_amount, 0);

    -- RN-ORD-02: el descuento no puede superar al subtotal
    IF NEW.total_amount < 0 THEN
        RAISE EXCEPTION
            'El descuento ($%) supera al subtotal ($%). El total no puede ser negativo.',
            NEW.discount_amount, NEW.subtotal
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Trigger: BEFORE INSERT OR UPDATE — garantiza integridad sin importar el origen del write
CREATE OR REPLACE TRIGGER trg_orders_compute_total
    BEFORE INSERT OR UPDATE OF subtotal, discount_amount ON orders
    FOR EACH ROW EXECUTE FUNCTION orders_compute_total();
