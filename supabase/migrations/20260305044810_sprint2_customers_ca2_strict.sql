-- Estabilización de Propiedad y Visibilidad de Clientes (CA2)
-- Eliminando el acceso a registros "huérfanos" para los vendedores.

-- 1. POLÍTICA DE LECTURA ESTRICTA (SELECT)
DROP POLICY IF EXISTS "customer_select_policy" ON public.customers;
CREATE POLICY "customer_select_policy" ON public.customers
FOR SELECT
USING (
  tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1)
  AND (
    (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('admin', 'supervisor')))
    OR (assigned_seller_id = auth.uid())
  )
);

-- 2. POLÍTICA DE INSERCIÓN ESTRICTA (INSERT)
DROP POLICY IF EXISTS "customer_insert_policy" ON public.customers;
CREATE POLICY "customer_insert_policy" ON public.customers
FOR INSERT
WITH CHECK (
  tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1)
  AND (
    (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('admin', 'supervisor')))
    OR (assigned_seller_id = auth.uid())
  )
);

-- 3. POLÍTICA DE ACTUALIZACIÓN ESTRICTA (UPDATE)
DROP POLICY IF EXISTS "customer_update_policy" ON public.customers;
CREATE POLICY "customer_update_policy" ON public.customers
FOR UPDATE
USING (
  tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1)
  AND (
    (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('admin', 'supervisor')))
    OR (assigned_seller_id = auth.uid())
  )
)
WITH CHECK (
  tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1)
);

-- 4. AUTOMATIZACIÓN DE PROPIEDAD (TRIGGER BEFORE INSERT)
CREATE OR REPLACE FUNCTION auto_assign_seller()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'vendedor') THEN
    NEW.assigned_seller_id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_assign_seller ON public.customers;
CREATE TRIGGER trg_auto_assign_seller
BEFORE INSERT ON public.customers
FOR EACH ROW
EXECUTE FUNCTION auto_assign_seller();

-- 5. RESTRICCIÓN DE EDICIÓN PARA VENDEDORES (TRIGGER BEFORE UPDATE)
CREATE OR REPLACE FUNCTION protect_customer_reassignment()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'vendedor') THEN
    IF OLD.assigned_seller_id IS DISTINCT FROM NEW.assigned_seller_id THEN
       NEW.assigned_seller_id = OLD.assigned_seller_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_customer_reassignment ON public.customers;
CREATE TRIGGER trg_protect_customer_reassignment
BEFORE UPDATE ON public.customers
FOR EACH ROW
EXECUTE FUNCTION protect_customer_reassignment();
