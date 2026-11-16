-- Migration: Agregar 'anticipo_lote' al CHECK de modulo de planilla_ia_invocaciones
-- Author: @alexis
-- Description: Nueva Edge Function extraer-anticipos-lote-ia (importación por lote de vales de
--              anticipo — Imporfrut confirmó que en la práctica reciben un solo documento con
--              varios vales/filas, no uno por persona). Se registra bajo su propio valor de
--              `modulo` ('anticipo_lote', distinto de 'anticipo') para que las métricas de
--              éxito/fallo/duración no se mezclen entre el flujo individual y el de lote,
--              aunque ambos comparten el mismo rate limit diario por usuario. Mismo criterio de
--              20260831090000: se busca el nombre real del CHECK vía pg_constraint.

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
        CHECK (modulo IN ('anticipo', 'viatico', 'asistente_ia', 'anticipo_lote'));
END $$;

COMMIT;
