-- 1. Eliminar la columna SKU y su restricción
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_tenant_sku_key;
ALTER TABLE products DROP COLUMN IF EXISTS sku;

-- 2. Asegurar que las columnas existan y limpiar valores NULL en la llave
-- Para poder crear un UNIQUE constraint estricto sin problemas de NULLs en PostgreSQL,
-- asignamos un valor de fallback temporal a filas existentes.
UPDATE products SET caliber = 'S/C' WHERE caliber IS NULL;
UPDATE products SET brand = 'S/M' WHERE brand IS NULL;
UPDATE products SET quality = 'S/Q' WHERE quality IS NULL;

ALTER TABLE products ALTER COLUMN caliber SET NOT NULL;
ALTER TABLE products ALTER COLUMN brand SET NOT NULL;
ALTER TABLE products ALTER COLUMN quality SET NOT NULL;

-- 3. Añadir nuevas columnas (Batch Tracking)
ALTER TABLE products ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE products ADD COLUMN IF NOT EXISTS shipment_number TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS entry_date DATE;

-- 4. Modificar tipo de columna de inventario
ALTER TABLE products ALTER COLUMN available_quantity TYPE DECIMAL(12,2);

-- 5. Saneamiento previo
UPDATE products SET shipment_number = 'S/I' WHERE shipment_number IS NULL;
ALTER TABLE products ALTER COLUMN shipment_number SET NOT NULL;

-- 6. Crear la nueva llave única estricta (Batch Identity)
ALTER TABLE products ADD CONSTRAINT products_batch_identity_key UNIQUE (tenant_id, name, caliber, brand, quality, shipment_number);

-- 7. Crear la columna virtual
ALTER TABLE products ADD COLUMN sku_sintetico TEXT GENERATED ALWAYS AS (brand || '-' || caliber || '-' || shipment_number) STORED;
