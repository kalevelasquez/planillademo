-- Migration: Agregar 'fijos_variables_lote' y 'kilometraje_lote' al CHECK de modulo de
--            planilla_ia_invocaciones
-- Author: @alexis
-- Description: Nuevas Edge Functions extraer-fijos-variables-lote-ia y
--              extraer-kilometraje-lote-ia (importación por lote a pedido explícito del
--              usuario, replicando el mecanismo ya existente en Anticipos y Viáticos por Ruta
--              para las otras dos pestañas de Viáticos). Cada una con su propio valor de
--              `modulo` para que las métricas de éxito/fallo/duración no se mezclen entre
--              módulos, aunque comparten el mismo rate limit diario por usuario. Mismo criterio
--              de 20260908100000/20260908120000: se busca el nombre real del CHECK vía
--              pg_constraint, nunca se adivina.

BEGIN;

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
        CHECK (modulo IN ('anticipo', 'viatico', 'asistente_ia', 'anticipo_lote', 'viatico_lote', 'fijos_variables_lote', 'kilometraje_lote'));
END $$;

COMMIT;
