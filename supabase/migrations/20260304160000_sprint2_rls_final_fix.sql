-- 1. Limpieza de políticas previas para evitar conflictos
DROP POLICY IF EXISTS "customers_tenant_isolation" ON public.customers;

-- 2. Creación de política ultra-robusta
-- Usamos una función auxiliar o subconsultas optimizadas
CREATE POLICY "customers_tenant_isolation" ON public.customers
FOR ALL USING (
    -- Regla 1: Aislamiento de Tenant (Obligatorio)
    tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1)
    AND (
        -- Regla 2: Acceso por Rol (Admin/Supervisor ve todo su tenant)
        EXISTS (
            SELECT 1 FROM public.user_profiles 
            WHERE id = auth.uid() 
            AND role IN ('admin', 'supervisor')
        )
        -- Regla 3: Acceso por Asignación (Vendedor ve los suyos o los sin asignar)
        OR assigned_seller_id = auth.uid()
        OR assigned_seller_id IS NULL
    )
);

-- 3. Verificación de integridad de la columna
-- Aseguramos que assigned_seller_id sea UUID para que coincida con auth.uid()
DO $$ 
BEGIN 
    IF (SELECT data_type FROM information_schema.columns 
        WHERE table_name = 'customers' AND column_name = 'assigned_seller_id') <> 'uuid' THEN
        ALTER TABLE public.customers 
        ALTER COLUMN assigned_seller_id TYPE uuid USING assigned_seller_id::uuid;
    END IF;
END $$;
