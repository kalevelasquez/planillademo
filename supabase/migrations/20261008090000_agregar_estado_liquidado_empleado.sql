-- Migration: agregar estado 'liquidado' a planilla_empleados
-- Author: @alexis
-- Description: Confirmado por Imporfrut (2026-10-08): hace falta distinguir formalmente a un
--              empleado ya LIQUIDADO (indemnización pagada en su totalidad) de uno simplemente
--              INACTIVO (desactivado por otro motivo, sin liquidación de por medio). Antes el
--              sistema solo tenía 2 estados.
--
--              Es una marca MANUAL — no existe ningún evento persistido de "a este empleado se le
--              generó un Finiquito" (el módulo de Finiquito/Liquidación Laboral calcula el
--              documento al vuelo, `useFiniquitoReporte.ts`, sin guardar nada) del cual derivar
--              esto automáticamente.
--
--              Impacto en el resto del código: bajo. Todos los filtros existentes comparan por
--              IGUALDAD exacta contra 'activo' (ej. `getEmpleadosActivos`), nunca por "distinto de
--              inactivo" — así que un empleado 'liquidado' queda excluido de los listados de
--              activos automáticamente, igual que uno 'inactivo', sin tocar esas consultas.

BEGIN;

ALTER TABLE public.planilla_empleados
    DROP CONSTRAINT planilla_empleados_estado_check,
    ADD CONSTRAINT planilla_empleados_estado_check CHECK (estado IN ('activo', 'inactivo', 'liquidado'));

COMMIT;
