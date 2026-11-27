-- =============================================================================
-- PLANTILLA de rollback  (convencion nueva del change tienda-web-clientes)
--
-- CONVENCION
--   * Un archivo por migracion hacia adelante, en esta carpeta, con el MISMO prefijo:
--       supabase/migrations/20261127090000_endurecer_claims_app_metadata.sql
--       supabase/rollback/20261127090000_endurecer_claims_app_metadata.down.sql
--   * NO viven en supabase/migrations: el CLI de Supabase aplicaria todo .sql de esa
--     carpeta como migracion hacia adelante. Los .down se aplican A MANO en el SQL Editor.
--   * Texto original de objetos pre-existentes: supabase/rollback/_originals_f0.sql
--     (copia literal de las migraciones previas). Un down copia de ahi, no reescribe.
--   * Orden de reversa: inverso al de aplicacion (0d -> 0c -> 0b -> 0a).
--   * Un down debe ser idempotente (IF EXISTS) y correr dentro de una transaccion.
--   * Si el down NO es totalmente reversible, documentarlo arriba (ej. app_metadata
--     backfilleado queda; es inocuo).
--
-- USO
--   1. Staging primero. 2. Pegar el .down.sql en el SQL Editor. 3. Verificar con la
--   query de comprobacion de abajo. 4. Recien despues, produccion.
-- =============================================================================

BEGIN;

-- 1. Restaurar definiciones previas (copiar de _originals_f0.sql)
-- CREATE OR REPLACE FUNCTION public.<nombre>(...) ... ;

-- 2. Quitar objetos nuevos (orden inverso a la creacion)
-- DROP TRIGGER IF EXISTS <trg> ON <tabla>;
-- DROP FUNCTION IF EXISTS public.<fn>(<args>);
-- DROP TABLE IF EXISTS public.<tabla>;

-- 3. Query de comprobacion (debe devolver el estado ANTERIOR a la migracion)
-- SELECT ...;

COMMIT;
