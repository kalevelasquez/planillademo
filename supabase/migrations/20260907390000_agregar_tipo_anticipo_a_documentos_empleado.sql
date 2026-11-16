-- Migration: Agregar 'anticipo' como tipo válido de planilla_empleado_documentos (IMPL-6 CA2)
-- Author: @alexis
-- Description: CA2 de IMPL-6 (US-EMP-04) exige que el vale escaneado de cada anticipo se
--              adjunte automáticamente como documento del empleado — no estaba implementado
--              (hallazgo de UAT). El vale se sube hoy a `planilla_viatico_documentos`
--              (tipo_registro='anticipo'), una tabla separada que nunca alimentó el listado de
--              "Documentos Adjuntos" del perfil (`planilla_empleado_documentos`). El código ya
--              dejó reservado el valor 'anticipo' en la columna `origen` de esa tabla (ver
--              comentario en 20260717100000_create_planilla_empleado_documentos.sql), pero
--              nunca se agregó a la columna `tipo`, que es la que realmente le falta este valor
--              para poder insertar el documento copiado. El CHECK original es inline/sin
--              nombre — se busca el nombre real vía pg_constraint, mismo criterio que
--              20260903090000_agregar_ipsfa_tipo_afiliacion.sql.

BEGIN;

DO $$
DECLARE
    v_constraint_name TEXT;
BEGIN
    SELECT con.conname INTO v_constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'planilla_empleado_documentos'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%tipo%dui%';

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.planilla_empleado_documentos DROP CONSTRAINT %I', v_constraint_name);
    END IF;

    ALTER TABLE public.planilla_empleado_documentos
        ADD CONSTRAINT planilla_empleado_documentos_tipo_check
        CHECK (tipo IN ('dui', 'afp', 'isss', 'incapacidad', 'amonestacion', 'constancia', 'liquidacion', 'anticipo'));
END $$;

COMMIT;
