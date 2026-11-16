-- Migration: Add metadata to inventory_imports for version summary
-- Author: @arquitecto
-- Description: Agrega la columna metadata JSONB a inventory_imports para guardar el resumen de cambios (nuevos vs actualizados).

ALTER TABLE public.inventory_imports 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{"new_count": 0, "updated_count": 0}'::jsonb;
