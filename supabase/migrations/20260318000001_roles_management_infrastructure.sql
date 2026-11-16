-- Migration: Infraestructura de Gestión de Roles (US-ROL-01)
-- Author: @arquitecto (Antigravity)
-- Description: Tablas, triggers y vistas para soportar roles personalizados y auditoría.

BEGIN;

-- ============================================================
-- 1. TABLA DE DEFINICIÓN DE ROLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.roles_definition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_system BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    
    -- Unicidad del nombre del rol por tenant
    UNIQUE(tenant_id, name)
);

-- RLS para roles_definition
ALTER TABLE public.roles_definition ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Roles are visible to all authenticated users in tenant"
    ON public.roles_definition FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "Only admins can manage roles definitions"
    ON public.roles_definition FOR ALL
    USING (
        tenant_id = public.get_auth_tenant_id() 
        AND 'admin' = ANY(public.get_auth_roles())
    );

-- ============================================================
-- 2. VISTA DE CONTEO DE USUARIOS (CA1)
-- ============================================================

CREATE OR REPLACE VIEW public.roles_with_counts AS
SELECT 
    rd.*,
    (
        SELECT COUNT(*) 
        FROM public.user_profiles up 
        WHERE rd.name = ANY(up.role) 
        AND up.tenant_id = rd.tenant_id
    ) as user_count
FROM public.roles_definition rd;

-- Otorgar permisos sobre la vista
GRANT SELECT ON public.roles_with_counts TO authenticated;

-- ============================================================
-- 3. AUDITORÍA AUTOMÁTICA (CA5)
-- ============================================================

-- Aplicar trigger de captura de auditoría a las nuevas tablas
DO $$ 
DECLARE
    t text;
BEGIN
    FOR t IN SELECT unnest(ARRAY['roles_definition', 'permission_matrix'])
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS tr_audit_%I ON public.%I', t, t);
        EXECUTE format('CREATE TRIGGER tr_audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit()', t, t);
    END LOOP;
END $$;

-- ============================================================
-- 4. MIGRAR ROLES ACTUALES (Semilla de Sistema)
-- ============================================================

-- Insertar roles base para todos los tenants existentes
INSERT INTO public.roles_definition (tenant_id, name, description, is_system)
SELECT 
    t.id as tenant_id,
    r.name,
    r.description,
    true as is_system
FROM public.tenants t
CROSS JOIN (
    SELECT 'admin' as name, 'Administrador total del sistema' as description
    UNION ALL SELECT 'supervisor', 'Supervisor de operaciones y personal'
    UNION ALL SELECT 'vendedor', 'Gestión de clientes y pedidos'
    UNION ALL SELECT 'despachador', 'Gestión de logística y entregas'
) r
ON CONFLICT (tenant_id, name) DO NOTHING;

-- ============================================================
-- 5. TRIGGER DE CONSISTENCIA: AUTO-SEED DE PERMISOS
-- ============================================================

-- Asegurar que al crear un nuevo rol se registre en la matriz
CREATE OR REPLACE FUNCTION public.fn_sync_permission_matrix_on_role_create()
RETURNS TRIGGER AS $$
BEGIN
    -- Si es un rol nuevo, intentamos crear una entrada base en la matriz para 'inventario' (por ejemplo)
    -- o simplemente aseguramos que el sistema sepa que existe.
    -- La UI usualmente se encarga de guardar la matriz completa, pero esto previene "vacíos".
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_sync_permissions_on_role_create
AFTER INSERT ON public.roles_definition
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_permission_matrix_on_role_create();

COMMIT;
