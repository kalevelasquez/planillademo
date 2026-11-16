-- Migration: Matriz de Permisos Visual (US-ROL-02)
-- Author: Antigravity
-- Description: Estructura para manejo dinámico de permisos por rol y recurso.

BEGIN;

-- 1. Crear tabla de Permisos por Rol
CREATE TABLE IF NOT EXISTS public.permission_matrix (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    role_name TEXT NOT NULL, -- admin, supervisor, vendedor, despachador
    resource TEXT NOT NULL,  -- pedidos, clientes, inventario, reportes, usuarios, roles, config, auditoria
    
    -- Acciones (Booleanos)
    can_view BOOLEAN DEFAULT FALSE,
    can_create BOOLEAN DEFAULT FALSE,
    can_edit BOOLEAN DEFAULT FALSE,
    can_delete BOOLEAN DEFAULT FALSE,
    can_export BOOLEAN DEFAULT FALSE,
    can_approve BOOLEAN DEFAULT FALSE,
    
    -- Alcance (own, team, all)
    view_scope TEXT DEFAULT 'own' CHECK (view_scope IN ('own', 'team', 'all')),
    edit_scope TEXT DEFAULT 'own' CHECK (edit_scope IN ('own', 'team', 'all')),
    delete_scope TEXT DEFAULT 'own' CHECK (delete_scope IN ('own', 'team', 'all')),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unicidad por Tenant + Rol + Recurso
    UNIQUE(tenant_id, role_name, resource)
);

-- 2. Habilitar RLS
ALTER TABLE public.permission_matrix ENABLE ROW LEVEL SECURITY;

-- 3. Políticas RLS
CREATE POLICY "Permissions are visible to all authenticated users in tenant"
    ON public.permission_matrix FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "Only admins can manage permissions"
    ON public.permission_matrix FOR ALL
    USING (
        tenant_id = public.get_auth_tenant_id() 
        AND 'admin' = ANY(public.get_auth_roles())
    );

-- 4. Función para actualizar el timestamp de updated_at
CREATE OR REPLACE FUNCTION public.handle_permissions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_permission_matrix_updated_at
    BEFORE UPDATE ON public.permission_matrix
    FOR EACH ROW EXECUTE FUNCTION public.handle_permissions_updated_at();

-- 5. Semilla inicial de permisos (Defaults para roles estándar)
-- Esta función se puede llamar al crear un nuevo tenant o para migrar los actuales.
CREATE OR REPLACE FUNCTION public.seed_default_permissions(p_tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    -- ADMIN: Acceso total a todo
    INSERT INTO public.permission_matrix (tenant_id, role_name, resource, can_view, can_create, can_edit, can_delete, can_export, can_approve, view_scope, edit_scope, delete_scope)
    VALUES 
        (p_tenant_id, 'admin', 'pedidos', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'admin', 'clientes', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'admin', 'inventario', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'admin', 'reportes', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'admin', 'usuarios', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'admin', 'roles', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'admin', 'config', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'admin', 'auditoria', true, true, true, true, true, true, 'all', 'all', 'all')
    ON CONFLICT DO NOTHING;

    -- VENDEDOR: Acceso limitado
    INSERT INTO public.permission_matrix (tenant_id, role_name, resource, can_view, can_create, can_edit, can_delete, can_export, can_approve, view_scope, edit_scope, delete_scope)
    VALUES 
        (p_tenant_id, 'vendedor', 'pedidos', true, true, true, false, true, false, 'own', 'own', 'own'),
        (p_tenant_id, 'vendedor', 'clientes', true, true, true, false, true, false, 'own', 'own', 'own'),
        (p_tenant_id, 'vendedor', 'inventario', true, false, false, false, false, false, 'all', 'own', 'own'),
        (p_tenant_id, 'vendedor', 'reportes', true, false, false, false, true, false, 'own', 'own', 'own')
    ON CONFLICT DO NOTHING;

    -- SUPERVISOR: Acceso intermedio
    INSERT INTO public.permission_matrix (tenant_id, role_name, resource, can_view, can_create, can_edit, can_delete, can_export, can_approve, view_scope, edit_scope, delete_scope)
    VALUES 
        (p_tenant_id, 'supervisor', 'pedidos', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'supervisor', 'clientes', true, true, true, true, true, false, 'all', 'all', 'all'),
        (p_tenant_id, 'supervisor', 'inventario', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'supervisor', 'reportes', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'supervisor', 'usuarios', true, true, true, false, true, false, 'all', 'all', 'all')
    ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

COMMIT;
