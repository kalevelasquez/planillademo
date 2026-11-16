-- Migration: Exportaciones Contables — Número de Afiliación AFP (IMPL-97 / US-EXP-01, IMPL-99)
-- Author: @alexis
-- Description: CA1 de US-EXP-01 pide "No. de afiliación" en los archivos CSV de AFP — hoy
--              `planilla_empleados` solo tiene `tipo_afiliacion` (a qué AFP pertenece), sin un
--              número de afiliación real. Gap de datos objetivo (no ambigüedad de negocio),
--              mismo criterio que `fecha_baja` en IMPL-85/86: columna aditiva, nullable, sin
--              migrar nada existente.

BEGIN;

ALTER TABLE public.planilla_empleados ADD COLUMN IF NOT EXISTS numero_afiliacion_afp TEXT;

COMMIT;
