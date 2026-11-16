-- =============================================================================
-- MIGRACIÓN: permit_negative_stock_on_overpass
-- =============================================================================
-- DESCRIPCIÓN: US-ORD-03 requiere que el sistema permita confirmar pedidos
--              incluso con stock insuficiente si el vendedor autoriza el sobrepaso.
--              Por lo tanto, la restricción de 'stock positivo' debe ser removida
--              para permitir que el balance sea negativo (back-ordering) y se
--              regularice con futuras entradas de inventario.
-- =============================================================================

DO $$ 
DECLARE
    r RECORD;
BEGIN
    -- Eliminar la restricción nombrada si existe
    IF EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'check_stock_positive' 
          AND conrelid = 'public.products'::regclass
    ) THEN
        ALTER TABLE public.products DROP CONSTRAINT check_stock_positive;
    END IF;

    -- También eliminamos la restricción inline que pudo quedar de la migración inicial
    -- (Buscando cualquier constraint de tipo 'c' que valide available_quantity >= 0)
    FOR r IN 
        SELECT conname 
        FROM pg_constraint 
        WHERE conrelid = 'public.products'::regclass 
          AND contype = 'c' 
          AND pg_get_constraintdef(oid) LIKE '%available_quantity >= 0%'
    LOOP
        EXECUTE 'ALTER TABLE public.products DROP CONSTRAINT ' || r.conname;
    END LOOP;
END $$;
