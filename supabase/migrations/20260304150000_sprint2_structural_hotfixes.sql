-- Migration: Sprint 2 Structural Hotfixes
-- Defect Fixes for Customers RLS, Inventory Triggers, and Storage Policies

-- 1. CORRECCIÓN RLS CLIENTES
-- El vendedor DEBE ver sus clientes asignados o los no asignados. 
-- El SELECT sobre tenant_id se optimiza con LIMIT para evitar cruces recursivos.
DROP POLICY IF EXISTS "customers_tenant_isolation" ON public.customers;

CREATE POLICY "customers_tenant_isolation" ON public.customers
    FOR ALL USING (
        tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1)
        AND (
            assigned_seller_id IS NULL 
            OR assigned_seller_id = auth.uid()
            OR (SELECT role FROM public.user_profiles WHERE id = auth.uid() LIMIT 1) IN ('admin', 'supervisor')
        )
    )
    WITH CHECK (
        tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1)
        AND (
            assigned_seller_id IS NULL 
            OR assigned_seller_id = auth.uid()
            OR (SELECT role FROM public.user_profiles WHERE id = auth.uid() LIMIT 1) IN ('admin', 'supervisor')
        )
    );

-- 2. AUDITORÍA Y ROBUSTEZ DEL TRIGGER inventory_versions
-- Aislamos posibles fallos debidos a Foreign Keys inválidas cuando auth.uid() es nulo o invocado en contextos sin sesión (Service Role)
CREATE OR REPLACE FUNCTION public.handle_product_stock_update()
RETURNS TRIGGER AS $$
DECLARE
  _uid UUID := auth.uid();
BEGIN
  IF OLD.available_quantity IS DISTINCT FROM NEW.available_quantity THEN
    
    -- Validar FK: Si existe session pero auth.uid() no está en profiles, setear en null para no romper transacciones
    IF _uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = _uid) THEN
        _uid := NULL;
    END IF;

    INSERT INTO public.inventory_versions (product_id, previous_quantity, new_quantity, updated_by)
    VALUES (NEW.id, OLD.available_quantity, NEW.available_quantity, _uid);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. POLÍTICAS DE STORAGE (inventory_documents)
-- Políticas explícitas para prevenir el "row-level security violation" en el SDK
DROP POLICY IF EXISTS "Tenant users can access their inventory documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can insert inventory documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can select inventory documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can update inventory documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete inventory documents" ON storage.objects;

CREATE POLICY "Users can insert inventory documents"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'inventory_documents'
  AND auth.role() = 'authenticated'
  AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND tenant_id IS NOT NULL)
);

CREATE POLICY "Users can select inventory documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'inventory_documents'
  AND auth.role() = 'authenticated'
  AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND tenant_id IS NOT NULL)
);

CREATE POLICY "Users can update inventory documents"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'inventory_documents'
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Users can delete inventory documents"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'inventory_documents'
  AND auth.role() = 'authenticated'
);
