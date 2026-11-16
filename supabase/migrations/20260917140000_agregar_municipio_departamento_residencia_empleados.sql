-- Migration: Agregar Municipio/Departamento de residencia del empleado (IMPL-162 CA5)
-- Author: @alexis
-- Description: El Finiquito exige Municipio y Departamento geográficos del empleado, que hoy
--              no existen como datos estructurados (solo `direccion` como texto libre). Se
--              nombran "_residencia" para no chocar con la columna `departamento` ya existente
--              (esa es organizacional — unidad de costos/área — no el departamento geográfico
--              de El Salvador; ver `departamentosService.ts`). Ambos son TEXT libres (sin FK a
--              catálogo).
--
-- DEPRECADO (2026-09-19): CA1/CA3 de IMPL-162 fueron reescritos — el formato real vigente
--              (ejemplos Melvin/Dora) no pide domicilio del empleado en ningún lado del
--              documento. Se eliminó el catálogo y el formulario que usaban estas columnas
--              (`src/data/geografiaElSalvador.ts`, selects en `EmpleadoDetailView.tsx`). Esta
--              migración YA SE APLICÓ contra UAT, así que las columnas quedan en pie, sin uso,
--              en vez de dropearlas retroactivamente (mismo criterio que IMPL-121).

BEGIN;

ALTER TABLE public.planilla_empleados
    ADD COLUMN IF NOT EXISTS departamento_residencia TEXT,
    ADD COLUMN IF NOT EXISTS municipio_residencia TEXT;

COMMIT;
