-- Migración: Registro de Recurso de Reportes en Matriz de Permisos
-- Autor: @arquitecto — ImporFrut

BEGIN;

-- 1. Asegurar que el recurso 'reportes' exista con permisos de lectura para Admin y Supervisor
-- Buscamos todos los tenants existentes para aplicarles el permiso base
DO $$
DECLARE
    t_id UUID;
BEGIN
    FOR t_id IN SELECT id FROM tenants LOOP
        
        -- Permiso para ADMIN (Todo habilitado)
        INSERT INTO public.permission_matrix (
            tenant_id, role_name, resource, 
            can_view, can_create, can_edit, can_delete, can_export, can_approve,
            view_scope, edit_scope, delete_scope
        ) VALUES (
            t_id, 'admin', 'reportes',
            true, true, true, true, true, true,
            'all', 'all', 'all'
        ) ON CONFLICT (tenant_id, role_name, resource) DO UPDATE SET can_view = true;

        -- Permiso para SUPERVISOR (Solo ver y exportar)
        INSERT INTO public.permission_matrix (
            tenant_id, role_name, resource, 
            can_view, can_create, can_edit, can_delete, can_export, can_approve,
            view_scope, edit_scope, delete_scope
        ) VALUES (
            t_id, 'supervisor', 'reportes',
            true, false, false, false, true, false,
            'all', 'all', 'all'
        ) ON CONFLICT (tenant_id, role_name, resource) DO UPDATE SET can_view = true;

    END LOOP;
END $$;

COMMIT;
