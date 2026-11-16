-- Migration: agregar campo Pasaporte al registro de empleado
-- Author: @alexis
-- Description: Observación de Imporfrut (2026-10-15) — hoy el sistema asume DUI siempre (ver
--              comentario histórico de TIPO_DOCUMENTO_DUI en planillaUnicaUtils.ts) sin ningún
--              campo para empleados extranjeros. Se agrega `pasaporte` como alternativa al DUI.
--
--              Decisión de negocio confirmada con el usuario: el DUI deja de ser obligatorio en
--              solitario — se exige DUI O Pasaporte (al menos uno de los dos), para poder
--              registrar empleados extranjeros sin DUI salvadoreño. El cambio de validación vive
--              en el frontend (useEmpleadoManagement.ts); acá solo se agrega la columna, sin
--              UNIQUE ni CHECK — mismo criterio minimalista que dui/nit/nup (TEXT simple,
--              nullable).

BEGIN;

ALTER TABLE public.planilla_empleados
    ADD COLUMN IF NOT EXISTS pasaporte TEXT;

COMMENT ON COLUMN public.planilla_empleados.pasaporte IS
    'Número de pasaporte, para empleados extranjeros sin DUI salvadoreño. Alternativa al DUI — el formulario exige al menos uno de los dos. NULL = no aplica/no capturado.';

COMMIT;
