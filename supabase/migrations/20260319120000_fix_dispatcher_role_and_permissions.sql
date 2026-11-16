-- Migration: Fix Dispatcher Role and Permissions Matrix
-- Author: @arquitecto / Antigravity
-- Description: Asegura que el recurso 'despacho' y el rol 'despachador' existan en todos los tenants.

BEGIN;

-- ============================================================
-- 1. ACTUALIZAR FUNCIÓN DE SEMILLA (SEED)
-- ============================================================

CREATE OR REPLACE FUNCTION public.seed_default_permissions(p_tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    -- ADMIN: Acceso total a todo (Actualizado: Incluye despacho)
    INSERT INTO public.permission_matrix 
        (tenant_id, role_name, resource, can_view, can_create, can_edit, can_delete, can_export, can_approve, view_scope, edit_scope, delete_scope)
    VALUES 
        (p_tenant_id, 'admin', 'pedidos', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'admin', 'clientes', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'admin', 'inventario', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'admin', 'reportes', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'admin', 'usuarios', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'admin', 'roles', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'admin', 'config', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'admin', 'auditoria', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'admin', 'despacho', true, true, true, true, true, true, 'all', 'all', 'all')
    ON CONFLICT (tenant_id, role_name, resource) DO UPDATE SET
        can_view = EXCLUDED.can_view,
        can_edit = EXCLUDED.can_edit,
        view_scope = EXCLUDED.view_scope;

    -- SUPERVISOR: Acceso a despacho y pedidos (Simplificado)
    INSERT INTO public.permission_matrix 
        (tenant_id, role_name, resource, can_view, can_create, can_edit, can_delete, can_export, can_approve, view_scope, edit_scope, delete_scope)
    VALUES 
        (p_tenant_id, 'supervisor', 'despacho', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'supervisor', 'pedidos', true, true, true, true, true, true, 'all', 'all', 'all')
    ON CONFLICT (tenant_id, role_name, resource) DO NOTHING;

    -- DESPACHADOR: Operación Logística
    INSERT INTO public.permission_matrix 
        (tenant_id, role_name, resource, can_view, can_create, can_edit, can_delete, can_export, can_approve, view_scope, edit_scope, delete_scope)
    VALUES 
        (p_tenant_id, 'despachador', 'despacho', true, true, true, false, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'despachador', 'pedidos', true, false, false, false, false, false, 'all', 'own', 'own'),
        (p_tenant_id, 'despachador', 'inventario', true, false, false, false, false, false, 'all', 'own', 'own')
    ON CONFLICT (tenant_id, role_name, resource) DO NOTHING;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2. EJECUCIÓN RETROACTIVA (TODOS LOS TENANTS)
-- ============================================================

-- Asegurar rol en roles_definition
INSERT INTO public.roles_definition (tenant_id, name, description, is_system)
SELECT id, 'despachador', 'Gestión de logística y entregas', true
FROM public.tenants
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Ejecutar semilla en todos los tenants para rellenar vacíos en la matriz
DO $$
DECLARE
    t_record RECORD;
BEGIN
    FOR t_record IN SELECT id FROM public.tenants LOOP
        PERFORM public.seed_default_permissions(t_record.id);
    END LOOP;
END $$;

-- ============================================================
-- 3. AUTOMATIZACIÓN PARA FUTUROS TENANTS
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_on_tenant_created()
RETURNS TRIGGER AS $$
BEGIN
    -- Crear roles base
    INSERT INTO public.roles_definition (tenant_id, name, description, is_system)
    VALUES 
        (NEW.id, 'admin', 'Administrador total del sistema', true),
        (NEW.id, 'supervisor', 'Supervisor de operaciones y personal', true),
        (NEW.id, 'vendedor', 'Gestión de clientes y pedidos', true),
        (NEW.id, 'despachador', 'Gestión de logística y entregas', true)
    ON CONFLICT DO NOTHING;

    -- Sembrar matriz de permisos
    PERFORM public.seed_default_permissions(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_seed_new_tenant ON public.tenants;
CREATE TRIGGER tr_seed_new_tenant
    AFTER INSERT ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION public.fn_on_tenant_created();

COMMIT;
