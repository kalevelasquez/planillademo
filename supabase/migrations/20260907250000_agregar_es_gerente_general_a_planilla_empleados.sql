-- Migration: planilla_empleados.es_gerente_general
-- Author: @alexis
-- Description: Auditoría crítica módulo por módulo (2026-08-13), hallazgo MENOR #5 de la 7ª
--              pasada sobre Empleados: EmpleadoDetailView.tsx decidía si mostrar la advertencia
--              de "retención especial" (DRN §9.3, hoy solo aplica a Gerente General) con
--              `!/gerente/i.test(formData.cargo)` — un regex contra `cargo`, que es texto libre
--              (InputField sin catálogo). Variantes de escritura razonables ("Gerente General",
--              "Gte. General", "GERENTE GRAL.") disparaban la advertencia de forma inconsistente
--              porque ninguna estructura real respalda la comparación.
--
--              `retencion_especial_viatico` (20260716120000) ya es el flag explícito que decide
--              si la retención se APLICA en el motor de cálculo — no se toca. Este campo nuevo
--              es un flag explícito independiente para la clasificación "¿este puesto es
--              Gerente General?", que reemplaza al regex sobre `cargo` únicamente para decidir
--              si corresponde mostrar la advertencia de confirmación en el formulario.

BEGIN;

ALTER TABLE public.planilla_empleados
    ADD COLUMN IF NOT EXISTS es_gerente_general BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.planilla_empleados.es_gerente_general IS
    'Flag explícito (no inferido de `cargo`) usado por la UI para advertir si la retención especial (DRN §9.3) se está activando para un puesto que no es Gerente General.';

COMMIT;
