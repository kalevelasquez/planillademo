-- Migration: Permitir adjuntos en Anticipos (IMPL-130, Observación General UAT)
-- Author: @alexis
-- Description: Anticipos no tenía mecanismo de adjuntos (ni modal ni lista). Se decidió
--              extender el alcance de IMPL-130/131 para incluirlo, igualando al resto de
--              módulos que manejan comprobantes (Viáticos, Incapacidades). Reutiliza el mismo
--              mecanismo de `planilla_viatico_documentos` (US-VIA-08) — mismo patrón que la
--              extensión hecha para 'incapacidad' en IMPL-44: solo se extiende el CHECK de
--              `tipo_registro` para aceptar 'anticipo'.

BEGIN;

ALTER TABLE public.planilla_viatico_documentos
    DROP CONSTRAINT IF EXISTS planilla_viatico_documentos_tipo_registro_check;
ALTER TABLE public.planilla_viatico_documentos
    ADD CONSTRAINT planilla_viatico_documentos_tipo_registro_check
    CHECK (tipo_registro IN ('por_ruta', 'fijos_variables', 'kilometraje', 'incapacidad', 'anticipo'));

COMMIT;
