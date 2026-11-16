-- Migration: Sprint 2 Infrastructure
-- Author: @operador
-- Description: Implementa soporte para versionado de lotes, asignación de clientes, estados de pedidos avanzados y registro de historial.

-- 1. Tabla: inventory_versions (Versionado de lotes y auditoría real-time)
CREATE TABLE IF NOT EXISTS inventory_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    previous_quantity INTEGER NOT NULL,
    new_quantity INTEGER NOT NULL,
    updated_by UUID REFERENCES user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS en inventory_versions
ALTER TABLE inventory_versions ENABLE ROW LEVEL SECURITY;

-- Política RLS para inventory_versions (Basado en el tenant_id del producto)
CREATE POLICY "inventory_versions_tenant_isolation" ON inventory_versions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM products 
            WHERE products.id = inventory_versions.product_id 
            AND products.tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM products 
            WHERE products.id = inventory_versions.product_id 
            AND products.tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
        )
    );

-- Trigger para automatizar versionado de inventario
CREATE OR REPLACE FUNCTION public.handle_product_stock_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.available_quantity IS DISTINCT FROM NEW.available_quantity THEN
    INSERT INTO public.inventory_versions (product_id, previous_quantity, new_quantity, updated_by)
    VALUES (NEW.id, OLD.available_quantity, NEW.available_quantity, auth.uid());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Modificaciones a `products` (Constraint Stock Positivo)
ALTER TABLE products ADD CONSTRAINT check_stock_positive CHECK (available_quantity >= 0);

-- Eliminamos si existía previamente (para idempotencia)
DROP TRIGGER IF EXISTS on_product_stock_update ON products;
CREATE TRIGGER on_product_stock_update
  AFTER UPDATE OF available_quantity ON products
  FOR EACH ROW EXECUTE FUNCTION public.handle_product_stock_update();

-- 3. Modificaciones a `customers` (Columna y RLS de Asignación)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS assigned_seller_id UUID REFERENCES public.user_profiles(id);

-- Reemplazamos la política existente para asegurar que el Vendedor solo vea sus asignados, mientras Admin/Supervisor ven todo.
DROP POLICY IF EXISTS "customers_tenant_isolation" ON customers;

CREATE POLICY "customers_tenant_isolation" ON customers
    FOR ALL USING (
        tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid()) 
        AND (
            (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('admin', 'supervisor')
            OR assigned_seller_id = auth.uid()
            OR assigned_seller_id IS NULL
        )
    )
    WITH CHECK (
        tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid()) 
        AND (
            (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('admin', 'supervisor')
            OR assigned_seller_id = auth.uid()
            OR assigned_seller_id IS NULL
        )
    );

-- 4. Modificaciones a `orders`

-- PASO 1 CRÍTICO: Eliminar el constraint VIEJO antes de tocar los datos.
-- Si no hacemos esto, el update fallará porque 'Approved' no es válido en el constraint antiguo.
DO $$ 
DECLARE
    r record;
BEGIN
    -- Buscamos y eliminamos CUALQUIER constraint check relacionado con 'status' en la tabla orders
    FOR r IN 
        SELECT conname 
        FROM pg_constraint 
        WHERE conrelid = 'orders'::regclass 
          AND contype = 'c' 
          AND pg_get_constraintdef(oid) LIKE '%status%'
    LOOP
        EXECUTE 'ALTER TABLE orders DROP CONSTRAINT ' || r.conname;
    END LOOP;
END $$;

-- PASO 2: Ahora que no hay reglas, normalizamos los datos (Data Migration)
UPDATE orders SET status = 'Draft' WHERE status ILIKE 'borrador';
UPDATE orders SET status = 'Pending' WHERE status ILIKE 'pendiente';
UPDATE orders SET status = 'Approved' WHERE status ILIKE 'aprobado';
UPDATE orders SET status = 'Delivered' WHERE status ILIKE 'entregado';
UPDATE orders SET status = 'Cancelled' WHERE status ILIKE 'cancelado';

-- Red de Seguridad (Catch-All) para datos sucios o NULLs
UPDATE orders 
SET status = 'Draft' 
WHERE status NOT IN ('Draft', 'Pending', 'Approved', 'Delivered', 'Cancelled')
   OR status IS NULL;

-- PASO 3: Aplicar la NUEVA regla estricta
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('Draft', 'Pending', 'Approved', 'Delivered', 'Cancelled'));

-- 5. Tabla: inventory_imports (Auditoría Carga Masiva)
CREATE TABLE IF NOT EXISTS inventory_imports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    file_name TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    created_by UUID REFERENCES user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE inventory_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_imports_tenant_isolation" ON inventory_imports
    FOR ALL USING (
        tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    )
    WITH CHECK (
        tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    );

-- 6. Storage Bucket (inventory_documents)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('inventory_documents', 'inventory_documents', false)
ON CONFLICT (id) DO NOTHING;

-- RLS para Storage de Inventario: Los usuarios de tenant pueden ver y subir sus documentos.
DROP POLICY IF EXISTS "Tenant users can access their inventory documents" ON storage.objects;

CREATE POLICY "Tenant users can access their inventory documents"
ON storage.objects FOR ALL
USING (
  bucket_id = 'inventory_documents'
  AND (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid()) IS NOT NULL
)
WITH CHECK (
  bucket_id = 'inventory_documents'
  AND (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid()) IS NOT NULL
);
