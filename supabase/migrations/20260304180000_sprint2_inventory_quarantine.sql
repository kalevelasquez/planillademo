-- Migration: Sprint 2 Inventory Quarantine Data
-- Author: @operador
-- Description: Agrega la columna quarantine_data a inventory_imports para guardar los logs fallidos del motor de Zod al importar Excel de forma asíncrona.

-- 1. Agregamos la columna JSONB flexible que aceptará los registros estructurados de Error reportados por React
ALTER TABLE public.inventory_imports 
ADD COLUMN IF NOT EXISTS quarantine_data JSONB;

-- Comment sobre el uso
COMMENT ON COLUMN public.inventory_imports.quarantine_data IS 'Almacena un array de objetos con los registros que no pasaron la validación: { row_number: number, data: any, errors: string[] }';
