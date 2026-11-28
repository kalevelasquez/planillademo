-- =============================================================================
-- ROLLBACK de 20261208090000_pedidos_web_origen.sql (F2 / C1.2)
--
-- Se aplica como MIGRACION HACIA ADELANTE (copiar a supabase/migrations con un timestamp nuevo),
-- DESPUES del down de 20261208100000 (RPCs) y de cualquier migracion posterior que use origin
-- (D1: aprobacion de pedidos web).
--
-- NO DESTRUYE DATOS: si existe algun pedido web (origin='web') o algun pedido sin vendedor, la
-- migracion ABORTA con instrucciones (cancelar/borrar esos pedidos o asignarles vendedor) y no
-- cambia nada. Con solo pedidos internos: quita indice, CHECKs y columnas y vuelve seller_id a
-- NOT NULL (el estado previo a C1.2).
-- Idempotente y autoverificable.
-- =============================================================================

BEGIN;

DO $guard$
DECLARE
  v_web int := 0;
  v_noseller int := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'origin') THEN
    EXECUTE 'SELECT count(*) FROM public.orders WHERE origin = ''web''' INTO v_web;
  END IF;
  SELECT count(*) INTO v_noseller FROM public.orders WHERE seller_id IS NULL;

  IF v_web > 0 OR v_noseller > 0 THEN
    RAISE EXCEPTION 'C1.2 DOWN ABORTADO: hay % pedidos web y % pedidos sin vendedor. Cancelalos o borralos (o asignales vendedor) antes de revertir; no se cambio nada.', v_web, v_noseller;
  END IF;
END
$guard$;

DROP INDEX IF EXISTS public.idx_orders_web_pending;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_seller_required_chk;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_origin_check;
ALTER TABLE public.orders ALTER COLUMN seller_id SET NOT NULL;
ALTER TABLE public.orders DROP COLUMN IF EXISTS rejection_reason;
ALTER TABLE public.orders DROP COLUMN IF EXISTS origin;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'orders'
                AND column_name IN ('origin', 'rejection_reason')) THEN
    RAISE EXCEPTION 'C1.2 DOWN VERIFY FAIL: quedan columnas origin / rejection_reason';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'orders'
                AND column_name = 'seller_id' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'C1.2 DOWN VERIFY FAIL: seller_id sigue siendo nullable';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.orders'::regclass
                AND conname IN ('orders_origin_check', 'orders_seller_required_chk')) THEN
    RAISE EXCEPTION 'C1.2 DOWN VERIFY FAIL: quedan CHECKs de origen';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_orders_web_pending') THEN
    RAISE EXCEPTION 'C1.2 DOWN VERIFY FAIL: queda idx_orders_web_pending';
  END IF;
END
$verify$;

COMMIT;
