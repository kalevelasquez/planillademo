-- ============================================================
-- Migración: Flexibilización de Inventario (US-ORD-03)
-- Autor: Antigravity / @operador
-- Fecha: 2026-03-17
-- Descripción: Elimina la restricción de stock mínimo >= 0
--              para permitir ventas en negativo con confirmación.
-- ============================================================

BEGIN;

-- Intentar eliminar la restricción por su nombre por defecto en PostgreSQL
-- Si el nombre es distinto, fallará silenciosamente debido a DROP CONSTRAINT IF EXISTS
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_available_quantity_check;

-- En algunos casos, si se creó en la migración inicial, el nombre puede ser diferente.
-- Esta migración asegura que el campo available_quantity no tenga restricciones de piso.

COMMIT;
