-- Migración de Emergencia (Versión Idempotente v3)
-- Incluye corrección para products_quarantine
BEGIN;

-- 1. Asegurar Privilegios
GRANT ALL ON TABLE public.product_categories TO authenticated;
GRANT ALL ON TABLE public.inventory_imports TO authenticated;
GRANT ALL ON TABLE public.products TO authenticated;
GRANT ALL ON TABLE public.inventory_versions TO authenticated;
GRANT ALL ON TABLE public.products_quarantine TO authenticated;

-- 2. Categorías
DROP POLICY IF EXISTS "categories_tenant_isolation" ON public.product_categories;
DROP POLICY IF EXISTS "categories_tenant_isolation_v2" ON public.product_categories;
CREATE POLICY "categories_tenant_isolation_v2" ON public.product_categories
    FOR ALL TO authenticated
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

-- 3. Importaciones
DROP POLICY IF EXISTS "inventory_imports_tenant_isolation" ON public.inventory_imports;
DROP POLICY IF EXISTS "inventory_imports_tenant_isolation_v2" ON public.inventory_imports;
CREATE POLICY "inventory_imports_tenant_isolation_v2" ON public.inventory_imports
    FOR ALL TO authenticated
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

-- 4. Cuarentena (CORRECCIÓN CRÍTICA DE VISIBILIDAD)
DROP POLICY IF EXISTS "quarantine_tenant_isolation" ON public.products_quarantine;
DROP POLICY IF EXISTS "quarantine_tenant_isolation_v2" ON public.products_quarantine;
CREATE POLICY "quarantine_tenant_isolation_v2" ON public.products_quarantine
    FOR ALL TO authenticated
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

-- 5. Versiones e inventario
DROP POLICY IF EXISTS "inventory_versions_tenant_isolation" ON public.inventory_versions;
DROP POLICY IF EXISTS "inventory_versions_tenant_isolation_v2" ON public.inventory_versions;
CREATE POLICY "inventory_versions_tenant_isolation_v2" ON public.inventory_versions
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.products 
            WHERE products.id = inventory_versions.product_id 
            AND products.tenant_id = public.get_auth_tenant_id()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.products 
            WHERE products.id = inventory_versions.product_id 
            AND products.tenant_id = public.get_auth_tenant_id()
        )
    );

-- 6. Storage
DROP POLICY IF EXISTS "Tenant users can access their inventory documents" ON storage.objects;
DROP POLICY IF EXISTS "inventory_documents_storage_shield" ON storage.objects;
CREATE POLICY "inventory_documents_storage_shield"
    ON storage.objects FOR ALL TO authenticated
    USING (
      bucket_id = 'inventory_documents'
      AND (public.get_auth_tenant_id() IS NOT NULL)
    )
    WITH CHECK (
      bucket_id = 'inventory_documents'
      AND (public.get_auth_tenant_id() IS NOT NULL)
    );

COMMIT;
