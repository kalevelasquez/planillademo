-- =============================================================================
-- ROLLBACK de 20261128100000_rpcs_catalogo_tienda.sql (F1 / B1.3)
--
-- Se aplica como MIGRACION HACIA ADELANTE (copiar a supabase/migrations con un timestamp nuevo).
-- Quita las RPCs del catalogo publico. NO elimina tenants.store_enabled ni su indice unico:
-- son compartidos con la migracion 0b (handle_new_user ramificado) y no hacen dano.
-- Autoverificable: si queda alguna funcion del catalogo, RAISE EXCEPTION y se revierte todo.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.store_get_product(uuid, text);
DROP FUNCTION IF EXISTS public.store_list_products(uuid, text, int, int);
DROP FUNCTION IF EXISTS public.store_catalog_groups(uuid);

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('store_list_products', 'store_get_product', 'store_catalog_groups')) THEN
    RAISE EXCEPTION 'B1.3 DOWN VERIFY FAIL: quedan funciones del catalogo de tienda';
  END IF;
END
$verify$;

COMMIT;
