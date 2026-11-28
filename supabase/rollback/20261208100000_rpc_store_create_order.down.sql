-- =============================================================================
-- ROLLBACK de 20261208100000_rpc_store_create_order.sql (F2 / C1.3)
--
-- Se aplica como MIGRACION HACIA ADELANTE (copiar a supabase/migrations con un timestamp nuevo).
-- Quita las RPCs de pedidos web y cuenta del cliente. NO borra pedidos ya creados (orders /
-- order_items): los pedidos web existentes quedan intactos; el front de la tienda deja de poder
-- crear nuevos. Va ANTES que el down de 20261208090000 (origen de pedidos web).
-- Idempotente y autoverificable: si queda alguna funcion, RAISE EXCEPTION y se revierte todo.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.store_create_order(jsonb, text);
DROP FUNCTION IF EXISTS public.store_get_my_account();
DROP FUNCTION IF EXISTS public.store_list_my_orders();

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('store_create_order', 'store_get_my_account', 'store_list_my_orders')) THEN
    RAISE EXCEPTION 'C1.3 DOWN VERIFY FAIL: quedan funciones de pedidos web / cuenta de tienda';
  END IF;
  -- el catalogo publico (B1.3) no se toca
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname IN ('store_list_products')) THEN
    RAISE NOTICE 'C1.3 DOWN: store_list_products no existe (el catalogo no estaba instalado)';
  END IF;
END
$verify$;

COMMIT;
