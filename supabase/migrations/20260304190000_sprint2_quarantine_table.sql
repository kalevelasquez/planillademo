-- 1. Crear tabla espejo products_quarantine admitiendo nulos en todo excepto llaves
CREATE TABLE IF NOT EXISTS public.products_quarantine (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    import_id UUID REFERENCES public.inventory_imports(id) ON DELETE SET NULL,
    
    -- Campos espejo de products (totalmente anulables para guardar basura)
    name TEXT,
    category_name TEXT,
    brand TEXT,
    caliber TEXT,
    quality TEXT,
    shipment_number TEXT,
    entry_date DATE,
    available_quantity NUMERIC(10,2),
    price NUMERIC(15,2),
    
    -- Auditoria del Parsing
    excel_row_number INTEGER,
    validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
    raw_data JSONB,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Habilitar RLS estricto
ALTER TABLE public.products_quarantine ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quarantine_tenant_isolation" ON public.products_quarantine
FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1)
);

-- 3. Crear indice compuesto para busqueda
CREATE INDEX IF NOT EXISTS idx_products_quarantine_tenant_import ON public.products_quarantine(tenant_id, import_id);
