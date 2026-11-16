-- ============================================================
-- Migración: Registro de Permisos de Monitoreo (US-OBS-02)
-- Autor: @operador — ImporFrut
-- Fecha: 2026-03-20
-- Descripción: Registra el recurso 'monitoreo' en la matriz 
--              de permisos para el rol Admin.
-- ============================================================

BEGIN;

-- 1. REGISTRAR EL RECURSO 'MONITOREO' PARA LOS ADMINS DE CADA TENANT
DO $$ 
DECLARE
    t_id UUID;
BEGIN
    FOR t_id IN SELECT id FROM public.tenants
    LOOP
        -- Insertar permiso de visualización para el rol 'admin'
        INSERT INTO public.permission_matrix (
            tenant_id, 
            role_name, 
            resource, 
            can_view, 
            can_create, 
            can_edit, 
            can_delete, 
            can_export, 
            can_approve, 
            view_scope, 
            edit_scope, 
            delete_scope
        ) VALUES (
            t_id, 
            'admin', 
            'monitoreo', 
            true,   -- can_view
            false,  -- can_create
            false,  -- can_edit
            false,  -- can_delete
            true,   -- can_export (para bajar reportes de salud si fuera necesario)
            false,  -- can_approve
            'all',  -- view_scope
            'own',  -- edit_scope
            'own'   -- delete_scope
        )
        ON CONFLICT (tenant_id, role_name, resource) 
        DO UPDATE SET can_view = true;
    END LOOP;
END $$;

COMMIT;
