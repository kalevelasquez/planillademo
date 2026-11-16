-- Migration: Auditoría y rate-limit del Asistente de IA (IMPL-115 / US-IA-03)
-- Author: @alexis
-- Description: US-IA-03 CA1 — se agrega 'CONSULTA_IA' al enum audit_action (mismo patrón
--              usado 3 veces ya en el proyecto). CA2 — se reutiliza planilla_ia_invocaciones
--              (de la épica de Anticipos/Viáticos, extendida en IMPL-107 con columnas de
--              resultado) en vez de crear una tabla de rate-limit paralela: se agrega
--              'asistente_ia' a su CHECK de `modulo`. El nombre de la constraint es el que
--              Postgres genera por default para un CHECK de una sola columna agregado con
--              ALTER TABLE ADD COLUMN (`<tabla>_<columna>_check`) — se verificó contra
--              pg_constraint en vez de asumirlo a ciegas.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.audit_action'::regtype AND enumlabel = 'CONSULTA_IA') THEN
        ALTER TYPE public.audit_action ADD VALUE 'CONSULTA_IA';
    END IF;
END $$;

DO $$
DECLARE
    v_constraint_name TEXT;
BEGIN
    SELECT con.conname INTO v_constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'planilla_ia_invocaciones'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%modulo%';

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.planilla_ia_invocaciones DROP CONSTRAINT %I', v_constraint_name);
    END IF;

    ALTER TABLE public.planilla_ia_invocaciones
        ADD CONSTRAINT planilla_ia_invocaciones_modulo_check
        CHECK (modulo IN ('anticipo', 'viatico', 'asistente_ia'));
END $$;

COMMIT;
