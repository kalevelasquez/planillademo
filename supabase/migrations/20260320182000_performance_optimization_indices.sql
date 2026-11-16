-- Migration: Performance Optimization Indices (US-PER-01 CA4)
-- Author: @operador / Antigravity
-- Date: 2026-03-20
-- Hotfix: Reemplazar columna 'category' por tabla maestra 'product_categories' y añadir 'shipment_number'

BEGIN;

-- 1. Habilitar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- 2. Índices B-Tree para la tabla Orders
CREATE INDEX IF NOT EXISTS idx_orders_tenant_date 
ON public.orders (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_customer 
ON public.orders (tenant_id, customer_id);

-- 3. Índices GIN con Trigramas para la tabla Products
-- Nombre del Producto (Muy usado en búsqueda libre)
CREATE INDEX IF NOT EXISTS idx_products_search_name 
ON public.products USING gin (tenant_id, name gin_trgm_ops);

-- Marca (Brand) - Usado en Filtro y Búsqueda Libre
CREATE INDEX IF NOT EXISTS idx_products_search_brand 
ON public.products USING gin (tenant_id, brand gin_trgm_ops);

-- Número de Embarque (Shipment Number) - Clave para logística
CREATE INDEX IF NOT EXISTS idx_products_search_shipment 
ON public.products USING gin (tenant_id, shipment_number gin_trgm_ops);

-- SKU Sintético - Búsqueda técnica
CREATE INDEX IF NOT EXISTS idx_products_search_sku 
ON public.products USING gin (tenant_id, sku_sintetico gin_trgm_ops);

-- Calibre (Caliber)
CREATE INDEX IF NOT EXISTS idx_products_search_caliber 
ON public.products USING gin (tenant_id, caliber gin_trgm_ops);

-- 4. Índices para la Tabla Maestra de Categorías
-- Corregido: Se añade a product_categories.name en lugar de products.category
CREATE INDEX IF NOT EXISTS idx_categories_search_name 
ON public.product_categories USING gin (tenant_id, name gin_trgm_ops);

-- 5. Índices para Order Items y Relaciones
CREATE INDEX IF NOT EXISTS idx_order_items_order_id 
ON public.order_items (order_id);

COMMIT;
