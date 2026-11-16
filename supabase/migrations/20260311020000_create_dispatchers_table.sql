-- ============================================================
-- Migración: Creación de tabla dispatchers (Despachadores/Contactos de Bodega)
-- Autor: Antigravity — ImporFrut
-- Fecha: 2026-03-11
-- Propósito: Almacenar la lista de despachadores (nombre y teléfono) 
--            para el envío de pedidos por WhatsApp.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dispatchers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ -- Soft delete
);

-- Habilitar RLS
ALTER TABLE public.dispatchers ENABLE ROW LEVEL SECURITY;

-- Política de aislamiento por Tenant
DROP POLICY IF EXISTS "dispatchers_tenant_isolation" ON public.dispatchers;
CREATE POLICY "dispatchers_tenant_isolation" ON public.dispatchers
    FOR ALL USING (
        tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    )
    WITH CHECK (
        tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    );

-- Índice por tenant para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_dispatchers_tenant_id ON public.dispatchers(tenant_id);
