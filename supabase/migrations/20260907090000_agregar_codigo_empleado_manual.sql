-- Migration: Agregar código de empleado de captura manual (IMPL-3/IMPL-120, hallazgo UAT agosto 2026)
-- Author: @alexis
-- Description: CA1/CA3/CA5 de US-EMP-01 se actualizaron tras UAT para exigir un "código de
--              empleado" obligatorio y único, capturado manualmente (numeración histórica real
--              de Imporfrut, no correlativa) — distinto de `codigo` (auto-generado EMP-YYYY-NNN
--              vía RPC generar_codigo_empleado) y de `codigo_reloj_marcador` (matching con el
--              reloj checador de Horas Extras). DRN v4.0 Sección 13 ítem #39: mientras Imporfrut
--              no confirme si la asignación es manual o autogenerada, se implementa como captura
--              manual. Columna nullable a nivel de BD (empleados ya existentes no tienen valor
--              todavía) — la obligatoriedad para altas/ediciones nuevas se exige en el formulario.

BEGIN;

ALTER TABLE public.planilla_empleados
    ADD COLUMN codigo_empleado_manual TEXT;

ALTER TABLE public.planilla_empleados
    ADD CONSTRAINT planilla_empleados_codigo_empleado_manual_unique UNIQUE (tenant_id, codigo_empleado_manual);

COMMIT;
