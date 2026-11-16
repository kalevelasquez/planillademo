-- Migración: Actualización de esquema de Clientes (US-CLI-01)
-- Agrega campos: dirección, zona, notas, estado y tipo de precio.

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS zone TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'activo' CHECK (status IN ('activo', 'inactivo'));
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS price_type TEXT DEFAULT 'cliente' CHECK (price_type IN ('empleado', 'cliente', 'mayoreo'));

-- Comentario para auditoría
COMMENT ON COLUMN public.customers.address IS 'Dirección física del cliente (US-CLI-01 CA3)';
COMMENT ON COLUMN public.customers.zone IS 'Zona comercial/geográfica (US-CLI-01 CA2)';
COMMENT ON COLUMN public.customers.notes IS 'Observaciones generales del cliente (US-CLI-01 CA3)';
COMMENT ON COLUMN public.customers.status IS 'Estado administrativo del cliente: activo/inactivo (US-CLI-01 CA1)';
COMMENT ON COLUMN public.customers.price_type IS 'Categoría de precios asignada (US-CLI-01 CA1)';
