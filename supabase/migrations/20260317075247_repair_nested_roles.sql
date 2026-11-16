-- ============================================================
-- Migración: Reparación de Roles Corruptos (US-AUTH-07)
-- Autor: @operador — ImporFrut
-- Fecha: 2026-03-17
-- Descripción: Aplana cualquier rol que haya quedado anidado accidentalmente
--              como resultado de migraciones repetidas o errores de cliente.
-- ============================================================

BEGIN;

-- 1. Aplanar la columna role en user_profiles
-- unnest() sobre una matriz multidimensional devuelve un conjunto plano de elementos.
-- ARRAY() vuelve a agrupar esos elementos en un array unidimensional.
UPDATE public.user_profiles
SET role = ARRAY(
    SELECT DISTINCT unnest(role)
)
WHERE array_ndims(role) > 1;

-- 2. Asegurar que no haya nulos y limpiar espacios
UPDATE public.user_profiles
SET role = ARRAY(
    SELECT DISTINCT trim(x)
    FROM unnest(role) AS x
    WHERE x IS NOT NULL AND x != ''
);

COMMIT;
