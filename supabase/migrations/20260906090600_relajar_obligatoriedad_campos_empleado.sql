-- Migration: Relajar obligatoriedad de teléfono en Empleados (IMPL-3/IMPL-123, hallazgo UAT agosto 2026)
-- Author: @alexis
-- Description: CA3 de US-EMP-01 se corrigió tras UAT: la obligatoriedad se evalúa campo por
--              campo, no por fila del DRN. La lista final de obligatorios es nombre, DUI, fecha
--              de nacimiento, ubicación, fecha de ingreso y sueldo mensual — NIT, NUP, sexo,
--              tipo de afiliación, banco, número de cuenta y tipo de contrato ya eran NULLABLE
--              a nivel de BD desde la migración original (20260716120000), así que no requieren
--              cambio de esquema. `telefono` es el único caso real: quedó NOT NULL en esa misma
--              migración porque en ese momento SÍ era obligatorio — ahora se relaja para que la
--              base de datos no rechace un guardado que el formulario ya permite.

BEGIN;

ALTER TABLE public.planilla_empleados
    ALTER COLUMN telefono DROP NOT NULL;

COMMIT;
