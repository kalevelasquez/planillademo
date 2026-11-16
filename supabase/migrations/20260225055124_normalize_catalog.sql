-- 1. Crear tabla de categorías con aislamiento Multi-Tenant
CREATE TABLE IF NOT EXISTS product_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, name) -- Evita categorías duplicadas por inquilino
);

ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "categories_tenant_isolation" ON product_categories
    FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid()))
    WITH CHECK (tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid()));

-- 2. Modificar la Tabla Products
-- Agregamos sku y cambiamos category de TEXT a UUID como Llave Foránea
ALTER TABLE products ADD COLUMN sku TEXT;

-- Llenar temporalmente los SKUs de productos existentes (si los hay) con un hash
UPDATE products SET sku = id::text WHERE sku IS NULL;

-- Ahora aseguramos el constraint
ALTER TABLE products ALTER COLUMN sku SET NOT NULL;
ALTER TABLE products ADD CONSTRAINT products_tenant_sku_key UNIQUE (tenant_id, sku);

-- Migrar la columna category (TEXT -> FK UUID)
-- Para no perder datos, primero creamos la columna nueva
ALTER TABLE products ADD COLUMN category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL;

-- (Opcional) Si hubiese datos, aquí iría un bloque DO para migrar las categorías de texto a la tabla y asignar el UUID. Como asumimos que estamos en etapas tempranas, podemos dropear la columna vieja.
ALTER TABLE products DROP COLUMN category;
