-- ============================================================
-- Migración: Simplificación de precios (Precio Único)
-- Fecha: 2026-03-02
-- Observación HO: 27 feb 2026
-- Objetivo: Eliminar la columna price_list de la tabla customers
--           por redundancia. El modelo de negocio ahora maneja
--           un precio único por producto para todos los clientes.
-- ============================================================

-- Nota: Antes de aplicar, verifica que no existan Policies (RLS)
-- ni Triggers activos que hagan referencia a esta columna.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name  = 'customers'
          AND column_name = 'price_list'
    ) THEN
        ALTER TABLE public.customers DROP COLUMN price_list;
        RAISE NOTICE 'Columna price_list eliminada de la tabla customers.';
    ELSE
        RAISE NOTICE 'La columna price_list no existe en customers. Migración omitida.';
    END IF;
END $$;
