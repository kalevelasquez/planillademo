-- Migration: Inventory Replace Logic
-- Author: @arquitecto / Prepped by @operador
-- Date: 2026-03-31
-- Description: Implementación de lógica de limpieza de inventario para "Replace Catalog"

BEGIN;

-- 1. Alteración de Tabla Products
-- Agregamos last_import_id para rastrear qué productos fueron actualizados en la sesión actual
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS last_import_id UUID REFERENCES public.inventory_imports(id);

-- 2. Índice para optimización de limpieza
-- Para que el barrido de productos antiguos sea eficiente en catálogos grandes
CREATE INDEX IF NOT EXISTS idx_products_last_import_id ON public.products(last_import_id);

-- 3. RPC: sync_inventory_catalog
-- Función atómica para limpiar o desactivar productos obsoletos por tenant
CREATE OR REPLACE FUNCTION public.sync_inventory_catalog(
    p_tenant_id UUID, 
    p_import_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Ejecuta con privilegios administrativos para permitir DELETE donde RLS sea restrictivo
AS $$
DECLARE
    v_deleted_count INTEGER := 0;
    v_deactivated_count INTEGER := 0;
BEGIN
    -- Validar integridad: El import debe pertenecer al tenant solicitado
    IF NOT EXISTS (SELECT 1 FROM inventory_imports WHERE id = p_import_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Operación no autorizada: ID de importación inválido para este Tenant.';
    END IF;

    -- A. DELETE: Borrado físico de productos sin historial (Evita basura en la DB)
    -- Solo borra si no existe en order_items para proteger integridad referencial
    DELETE FROM public.products
    WHERE tenant_id = p_tenant_id
      AND status = 'active'
      AND (last_import_id IS NULL OR last_import_id != p_import_id)
      AND id NOT IN (SELECT DISTINCT product_id FROM public.order_items);
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    -- B. SOFT DELETE: Marcado como 'unavailable' para productos con historial
    -- Así los pedidos viejos mantienen su relación, pero el producto sale del catálogo activo
    UPDATE public.products
    SET status = 'unavailable'
    WHERE tenant_id = p_tenant_id
      AND status = 'active'
      AND (last_import_id IS NULL OR last_import_id != p_import_id);

    GET DIAGNOSTICS v_deactivated_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_count', v_deleted_count,
        'deactivated_count', v_deactivated_count,
        'timestamp', now()
    );
END;
$$;

-- 4. Permisos de ejecución
-- Permitir que el rol autenticado (App) invoque la limpieza tras la carga del Excel
GRANT EXECUTE ON FUNCTION public.sync_inventory_catalog TO authenticated;

COMMIT;
