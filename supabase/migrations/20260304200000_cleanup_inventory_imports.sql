-- Migración de Limpieza: Fase 1.9.1
-- Elimina la columna obsoleta quarantine_data ya que ahora usamos products_quarantine

ALTER TABLE public.inventory_imports 
DROP COLUMN IF EXISTS quarantine_data;
