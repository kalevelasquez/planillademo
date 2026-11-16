-- Migración: Extensión de esquema de Clientes (US-CLI-02)
-- Agrega campos: código interno, número de identificación, municipio y renombra zona a departamento.

-- 1. Renombrar zona a department si existe
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'zone') THEN
        ALTER TABLE public.customers RENAME COLUMN zone TO department;
    END IF;
END $$;

-- 2. Agregar nuevos campos
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS municipality TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS identification_number TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS internal_code TEXT;

-- 3. Comentarios para auditoría/documentación
COMMENT ON COLUMN public.customers.department IS 'Departamento geográfico del cliente (Ex-Zona)';
COMMENT ON COLUMN public.customers.municipality IS 'Municipio del cliente';
COMMENT ON COLUMN public.customers.identification_number IS 'NIT, DUI o número de registro fiscal';
COMMENT ON COLUMN public.customers.internal_code IS 'Código correlativo de uso interno ImporFrut';
