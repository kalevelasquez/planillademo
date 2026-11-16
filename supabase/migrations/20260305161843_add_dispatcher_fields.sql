-- 1. Estructura de Auditoría de Despacho
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS handled_by UUID REFERENCES public.user_profiles(id);

-- 2. Máquina de Estados (Aceptación de 'In Preparation')
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check 
CHECK (status IN ('Draft', 'Pending', 'Approved', 'In Preparation', 'Delivered', 'Cancelled'));

-- 3. Refactor de RLS (Performance Boost)
DROP POLICY IF EXISTS "orders_tenant_isolation" ON public.orders;

CREATE POLICY "orders_tenant_isolation" ON public.orders
FOR ALL
USING (tenant_id = public.get_auth_tenant_id())
WITH CHECK (tenant_id = public.get_auth_tenant_id());
