-- ============================================================
-- Migración: Blindaje Universal por Herencia (US-ORD-11)
-- Autor: @arquitecto / Antigravity
-- Fecha: 2026-03-17
-- Descripción: Implementación de RLS basada en herencia estructural.
--              Si un usuario tiene acceso al Pedido (Padre), 
--              automáticamente hereda el acceso a sus Ítems (Hijos).
-- ============================================================

BEGIN;

-- 1. Limpieza exhaustiva de políticas previas en order_items
DROP POLICY IF EXISTS "order_items_access_policy" ON public.order_items;
DROP POLICY IF EXISTS "order_items_tenant_isolation" ON public.order_items;
DROP POLICY IF EXISTS "order_items_robust_access" ON public.order_items;
DROP POLICY IF EXISTS "order_items_universal_access" ON public.order_items;
DROP POLICY IF EXISTS "order_items_parent_inheritance" ON public.order_items;

-- 2. Aplicación de la Regla de Herencia
-- PostgREST ejecutará la subconsulta sobre public.orders. 
-- Como public.orders ya tiene RLS robusto que funciona bien, 
-- heredar su visibilidad es la solución más segura y eficiente.
CREATE POLICY "order_items_parent_inheritance" ON public.order_items
FOR ALL TO authenticated
USING ( 
    order_id IN (SELECT id FROM public.orders) 
)
WITH CHECK ( 
    order_id IN (SELECT id FROM public.orders) 
);

-- 3. Blindaje de visibilidad de Productos para el Tenant
-- Simplificación extrema: Si estás en el tenant del perfil, puedes leer el producto.
-- Esto evita que joins nulos por RLS oculten los datos en el resumen.
DROP POLICY IF EXISTS "products_tenant_isolation" ON public.products;
DROP POLICY IF EXISTS "products_tenant_read_policy" ON public.products;
DROP POLICY IF EXISTS "products_universal_read" ON public.products;
DROP POLICY IF EXISTS "products_tenant_read_v4" ON public.products;

CREATE POLICY "products_tenant_read_v4" ON public.products
FOR SELECT TO authenticated
USING ( 
    tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid()) 
);

COMMIT;
