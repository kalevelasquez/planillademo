-- ============================================================
-- Migración: Restauración de Permisos de Escritura en Productos (US-INV-04 FIX)
-- Autor: @arquitecto / Antigravity
-- Fecha: 2026-03-17
-- Razón: La migración anterior limitó por error la tabla 'products' 
--        a solo SELECT, impidiendo actualizaciones de stock y precio.
-- ============================================================

BEGIN;

-- 1. Eliminar políticas restrictivas previas
DROP POLICY IF EXISTS "products_universal_read" ON public.products;
DROP POLICY IF EXISTS "products_tenant_isolation" ON public.products;
DROP POLICY IF EXISTS "products_select_v2" ON public.products;
DROP POLICY IF EXISTS "products_write_v2" ON public.products;

-- 2. Política de Lectura: Todos en el mismo tenant pueden ver productos
CREATE POLICY "products_select_v3" ON public.products
FOR SELECT TO authenticated
USING ( 
    tenant_id = public.get_auth_tenant_id() 
);

-- 3. Política de Escritura: Admins y Supervisores pueden gestionar el catálogo
-- El personal de despacho también puede necesitar actualizar stock si el flujo lo requiere.
CREATE POLICY "products_write_v3" ON public.products
FOR ALL TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND (
        public.get_auth_roles() && ARRAY['admin', 'supervisor', 'despachador']::text[]
    )
)
WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND (
        public.get_auth_roles() && ARRAY['admin', 'supervisor', 'despachador']::text[]
    )
);

COMMIT;
