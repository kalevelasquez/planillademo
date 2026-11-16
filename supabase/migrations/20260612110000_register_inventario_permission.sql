-- Migración: Registro de Recurso de Inventario en Matriz de Permisos para Tenants Existentes
-- Autor: @arquitecto — ImporFrut
-- Descripción: Los permisos de 'inventario' en permission_matrix solo se seedeaban para tenants
--              nuevos via bootstrap_tenant/seed_default_permissions. Esta migración los aplica
--              retroactivamente a todos los tenants existentes.

BEGIN;

DO $$
DECLARE
    t_id UUID;
BEGIN
    FOR t_id IN SELECT id FROM public.tenants LOOP

        -- ADMIN: Acceso total al inventario
        INSERT INTO public.permission_matrix (
            tenant_id, role_name, resource,
            can_view, can_create, can_edit, can_delete, can_export, can_approve,
            view_scope, edit_scope, delete_scope
        ) VALUES (
            t_id, 'admin', 'inventario',
            true, true, true, true, true, true,
            'all', 'all', 'all'
        ) ON CONFLICT (tenant_id, role_name, resource) DO NOTHING;

        -- SUPERVISOR: Acceso total al inventario
        INSERT INTO public.permission_matrix (
            tenant_id, role_name, resource,
            can_view, can_create, can_edit, can_delete, can_export, can_approve,
            view_scope, edit_scope, delete_scope
        ) VALUES (
            t_id, 'supervisor', 'inventario',
            true, true, true, true, true, true,
            'all', 'all', 'all'
        ) ON CONFLICT (tenant_id, role_name, resource) DO NOTHING;

        -- VENDEDOR: Solo lectura del inventario
        INSERT INTO public.permission_matrix (
            tenant_id, role_name, resource,
            can_view, can_create, can_edit, can_delete, can_export, can_approve,
            view_scope, edit_scope, delete_scope
        ) VALUES (
            t_id, 'vendedor', 'inventario',
            true, false, false, false, false, false,
            'all', 'own', 'own'
        ) ON CONFLICT (tenant_id, role_name, resource) DO NOTHING;

    END LOOP;
END $$;

COMMIT;
