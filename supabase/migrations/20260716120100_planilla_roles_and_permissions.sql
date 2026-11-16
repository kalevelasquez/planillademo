-- Migration: Roles y permisos del módulo de Planilla (IMPL-1 — segregación de funciones DRN/Blueprint §13.2)
-- Author: @alexis
-- Description: Registra los roles "preparador_planilla" y "aprobador_planilla" en roles_definition
--              (para que aparezcan en Gestión de Roles y sean asignables a usuarios) y sus permisos
--              base en permission_matrix para el recurso 'planilla_empleados'. A diferencia de
--              20260612110000_register_inventario_permission.sql (que solo hizo el backfill y dejó
--              seed_default_permissions/fn_on_tenant_created desactualizadas para 'inventario'),
--              acá también extendemos esas dos funciones para que los tenants NUEVOS reciban
--              los roles y permisos de Planilla automáticamente, sin depender de otra migración.

BEGIN;

-- ============================================================
-- 1. EXTENDER SEMILLA PARA TENANTS NUEVOS
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
        (p_tenant_id, 'admin', 'despacho', true, true, true, true, true, true, 'all', 'all', 'all'),
        (p_tenant_id, 'admin', 'planilla_empleados', true, true, true, true, true, true, 'all', 'all', 'all')
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

    -- PREPARADOR_PLANILLA: ve, crea y edita Empleados; no elimina (Blueprint §13.2)
    INSERT INTO public.permission_matrix
        (tenant_id, role_name, resource, can_view, can_create, can_edit, can_delete, can_export, can_approve, view_scope, edit_scope, delete_scope)
    VALUES
        (p_tenant_id, 'preparador_planilla', 'planilla_empleados', true, true, true, false, true, false, 'all', 'all', 'all')
    ON CONFLICT (tenant_id, role_name, resource) DO NOTHING;

    -- APROBADOR_PLANILLA: solo lectura (Blueprint §13.2 — no edita datos)
    INSERT INTO public.permission_matrix
        (tenant_id, role_name, resource, can_view, can_create, can_edit, can_delete, can_export, can_approve, view_scope, edit_scope, delete_scope)
    VALUES
        (p_tenant_id, 'aprobador_planilla', 'planilla_empleados', true, false, false, false, true, true, 'all', 'all', 'all')
    ON CONFLICT (tenant_id, role_name, resource) DO NOTHING;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fn_on_tenant_created()
RETURNS TRIGGER AS $$
BEGIN
    -- Crear roles base
    INSERT INTO public.roles_definition (tenant_id, name, description, is_system)
    VALUES
        (NEW.id, 'admin', 'Administrador total del sistema', true),
        (NEW.id, 'supervisor', 'Supervisor de operaciones y personal', true),
        (NEW.id, 'vendedor', 'Gestión de clientes y pedidos', true),
        (NEW.id, 'despachador', 'Gestión de logística y entregas', true),
        (NEW.id, 'preparador_planilla', 'Registra y edita los datos de planilla, calcula y envía a aprobación', false),
        (NEW.id, 'aprobador_planilla', 'Revisa y aprueba/rechaza quincenas de planilla; no edita datos', false)
    ON CONFLICT DO NOTHING;

    -- Sembrar matriz de permisos
    PERFORM public.seed_default_permissions(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- El trigger ya existe (creado en 20260319120000) y apunta a esta misma función por nombre,
-- no hace falta recrearlo — CREATE OR REPLACE FUNCTION alcanza.

-- ============================================================
-- 2. BACKFILL RETROACTIVO PARA TENANTS EXISTENTES
-- ============================================================

DO $$
DECLARE
    t_id UUID;
BEGIN
    FOR t_id IN SELECT id FROM public.tenants LOOP

        -- Definición de roles nuevos (no son roles de sistema: un admin podría desactivarlos
        -- vía la UI de Gestión de Roles si el negocio cambia — ver gap en planilla-contexto.md)
        INSERT INTO public.roles_definition (tenant_id, name, description, is_system)
        VALUES
            (t_id, 'preparador_planilla', 'Registra y edita los datos de planilla, calcula y envía a aprobación', false),
            (t_id, 'aprobador_planilla', 'Revisa y aprueba/rechaza quincenas de planilla; no edita datos', false)
        ON CONFLICT (tenant_id, name) DO NOTHING;

        -- ADMIN: acceso total a Empleados
        INSERT INTO public.permission_matrix (
            tenant_id, role_name, resource,
            can_view, can_create, can_edit, can_delete, can_export, can_approve,
            view_scope, edit_scope, delete_scope
        ) VALUES (
            t_id, 'admin', 'planilla_empleados',
            true, true, true, true, true, true,
            'all', 'all', 'all'
        ) ON CONFLICT (tenant_id, role_name, resource) DO NOTHING;

        -- PREPARADOR: ve, crea y edita; no elimina (Blueprint §13.2)
        INSERT INTO public.permission_matrix (
            tenant_id, role_name, resource,
            can_view, can_create, can_edit, can_delete, can_export, can_approve,
            view_scope, edit_scope, delete_scope
        ) VALUES (
            t_id, 'preparador_planilla', 'planilla_empleados',
            true, true, true, false, true, false,
            'all', 'all', 'all'
        ) ON CONFLICT (tenant_id, role_name, resource) DO NOTHING;

        -- APROBADOR: solo lectura (Blueprint §13.2 — no edita datos)
        INSERT INTO public.permission_matrix (
            tenant_id, role_name, resource,
            can_view, can_create, can_edit, can_delete, can_export, can_approve,
            view_scope, edit_scope, delete_scope
        ) VALUES (
            t_id, 'aprobador_planilla', 'planilla_empleados',
            true, false, false, false, true, true,
            'all', 'all', 'all'
        ) ON CONFLICT (tenant_id, role_name, resource) DO NOTHING;

    END LOOP;
END $$;

COMMIT;
