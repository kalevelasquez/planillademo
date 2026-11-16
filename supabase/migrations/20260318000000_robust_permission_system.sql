-- Migration: Sistema de Permisos Robusto (US-ROL-03)
-- Author: @arquitecto (Antigravity)
-- Description: Implementación de validación granular de permisos en RLS y funciones auxiliares.

BEGIN;

-- ============================================================
-- 1. FUNCIONES DE VALIDACIÓN DE PERMISOS
-- ============================================================

-- get_permission_scope: Obtiene el alcance máximo (all > team > own) para una acción
CREATE OR REPLACE FUNCTION public.get_permission_scope(
    p_resource TEXT,
    p_action TEXT -- 'view', 'edit', 'delete'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_scope TEXT;
    v_roles TEXT[];
    v_query TEXT;
BEGIN
    -- Validar acción permitida para evitar inyección (aunque %I protege identificadores)
    IF p_action NOT IN ('view', 'edit', 'delete') THEN
        RETURN NULL;
    END IF;

    SELECT get_auth_roles() INTO v_roles;
    
    -- Consulta dinámica para obtener el alcance con mayor jerarquía
    v_query := format(
        'SELECT scope FROM (
            SELECT %I_scope as scope,
                   CASE %I_scope 
                     WHEN ''all'' THEN 3 
                     WHEN ''team'' THEN 2 
                     WHEN ''own'' THEN 1 
                     ELSE 0 
                   END as rank
            FROM public.permission_matrix 
            WHERE tenant_id = get_auth_tenant_id()
            AND role_name = ANY($1)
            AND resource = $2
            AND can_%I = true
        ) s ORDER BY rank DESC LIMIT 1', p_action, p_action, p_action
    );

    EXECUTE v_query INTO v_scope USING v_roles, p_resource;

    RETURN v_scope;
END;
$$;

-- has_permission: Validación simple para acciones sin alcance (create, export, approve)
CREATE OR REPLACE FUNCTION public.has_permission(
    p_resource TEXT,
    p_action TEXT -- 'view', 'create', 'edit', 'delete', 'export', 'approve'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_has BOOLEAN;
    v_roles TEXT[];
    v_query TEXT;
BEGIN
    -- Validar campos de acción permitidos
    IF p_action NOT IN ('view', 'create', 'edit', 'delete', 'export', 'approve') THEN
        RETURN FALSE;
    END IF;

    SELECT get_auth_roles() INTO v_roles;
    
    v_query := format(
        'SELECT EXISTS (
            SELECT 1 FROM public.permission_matrix 
            WHERE tenant_id = get_auth_tenant_id()
            AND role_name = ANY($1)
            AND resource = $2
            AND can_%I = true
        )', p_action
    );

    EXECUTE v_query INTO v_has USING v_roles, p_resource;

    RETURN COALESCE(v_has, false);
END;
$$;

-- check_access: Función principal para RLS con validación de alcance
CREATE OR REPLACE FUNCTION public.check_access(
    p_resource TEXT,
    p_action TEXT,
    p_owner_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_scope TEXT;
BEGIN
    v_scope := get_permission_scope(p_resource, p_action);
    
    IF v_scope IS NULL THEN RETURN false; END IF;
    IF v_scope = 'all' THEN RETURN true; END IF;
    
    -- Si no hay dueño proporcionado (ej. productos), el acceso solo puede ser TRUE si el scope es ALL
    IF p_owner_id IS NULL THEN RETURN false; END IF;

    IF v_scope = 'own' AND p_owner_id = auth.uid() THEN RETURN true; END IF;
    
    -- Alcance 'team': Por ahora se comporta como 'all' dentro del tenant si no hay equipos definidos,
    -- o como 'own' si queremos ser estrictos. Para ImporFrut, asumiremos que team = tenant_id (all).
    IF v_scope = 'team' THEN RETURN true; END IF;

    RETURN false;
END;
$$;

-- ============================================================
-- 2. ACTUALIZACIÓN DE POLÍTICAS RLS (BLINDADO - POR ACCIÓN)
-- ============================================================

-- ORDERS (Pedidos)
DROP POLICY IF EXISTS "orders_access_v3" ON public.orders;
CREATE POLICY "orders_select" ON public.orders FOR SELECT
    USING (tenant_id = get_auth_tenant_id() AND check_access('pedidos', 'view', seller_id));

CREATE POLICY "orders_insert" ON public.orders FOR INSERT
    WITH CHECK (tenant_id = get_auth_tenant_id() AND has_permission('pedidos', 'create'));

CREATE POLICY "orders_update" ON public.orders FOR UPDATE
    USING (tenant_id = get_auth_tenant_id() AND check_access('pedidos', 'edit', seller_id));

CREATE POLICY "orders_delete" ON public.orders FOR DELETE
    USING (tenant_id = get_auth_tenant_id() AND check_access('pedidos', 'delete', seller_id));


-- CUSTOMERS (Clientes)
DROP POLICY IF EXISTS "customers_access_v6" ON public.customers;
CREATE POLICY "customers_select" ON public.customers FOR SELECT
    USING (tenant_id = get_auth_tenant_id() AND check_access('clientes', 'view', assigned_seller_id));

CREATE POLICY "customers_insert" ON public.customers FOR INSERT
    WITH CHECK (tenant_id = get_auth_tenant_id() AND has_permission('clientes', 'create'));

CREATE POLICY "customers_update" ON public.customers FOR UPDATE
    USING (tenant_id = get_auth_tenant_id() AND check_access('clientes', 'edit', assigned_seller_id));

CREATE POLICY "customers_delete" ON public.customers FOR DELETE
    USING (tenant_id = get_auth_tenant_id() AND check_access('clientes', 'delete', assigned_seller_id));


-- PRODUCTS (Productos)
DROP POLICY IF EXISTS "products_access_v6" ON public.products;
CREATE POLICY "products_select" ON public.products FOR SELECT
    USING (tenant_id = get_auth_tenant_id() AND check_access('inventario', 'view'));

CREATE POLICY "products_insert" ON public.products FOR INSERT
    WITH CHECK (tenant_id = get_auth_tenant_id() AND has_permission('inventario', 'create'));

CREATE POLICY "products_update" ON public.products FOR UPDATE
    USING (tenant_id = get_auth_tenant_id() AND has_permission('inventario', 'edit'));

CREATE POLICY "products_delete" ON public.products FOR DELETE
    USING (tenant_id = get_auth_tenant_id() AND has_permission('inventario', 'delete'));


-- USER_PROFILES (Seguridad de Usuarios)
DROP POLICY IF EXISTS "user_profiles_admin_v6" ON public.user_profiles;
CREATE POLICY "user_profiles_select" ON public.user_profiles FOR SELECT
    USING (tenant_id = get_auth_tenant_id() AND (auth.uid() = id OR has_permission('usuarios', 'view')));

CREATE POLICY "user_profiles_insert" ON public.user_profiles FOR INSERT
    WITH CHECK (tenant_id = get_auth_tenant_id() AND has_permission('usuarios', 'create'));

CREATE POLICY "user_profiles_update" ON public.user_profiles FOR UPDATE
    USING (tenant_id = get_auth_tenant_id() AND (auth.uid() = id OR has_permission('usuarios', 'edit')));

CREATE POLICY "user_profiles_delete" ON public.user_profiles FOR DELETE
    USING (tenant_id = get_auth_tenant_id() AND has_permission('usuarios', 'delete'));


-- PERMISSION_MATRIX (Auto-protección)
DROP POLICY IF EXISTS "manage_permissions_v2" ON public.permission_matrix;
CREATE POLICY "permission_matrix_select" ON public.permission_matrix FOR SELECT
    USING (tenant_id = get_auth_tenant_id());

CREATE POLICY "permission_matrix_manage" ON public.permission_matrix FOR ALL
    USING (tenant_id = get_auth_tenant_id() AND has_permission('roles', 'edit'));

-- ============================================================
-- 3. DENIEGO POR DEFECTO: SI NO HAY REGISTRO EN LA MATRIZ
-- ============================================================

-- Asegurar que la función seed_default_permissions sea idempotente y completa
-- (Se asume que ya fue definida en migraciones anteriores)

-- Limpiar permisos inconsistentes o nulos que puedan estar causando bypass
DELETE FROM public.permission_matrix WHERE tenant_id IS NULL OR role_name IS NULL OR resource IS NULL;

COMMIT;
