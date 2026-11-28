-- =============================================================================
-- F2 / C1.2 - Origen de pedidos web (change: tienda-web-clientes)
--
-- QUE HACE
--   * orders.origin text NOT NULL DEFAULT 'interno' CHECK (origin IN ('interno','web')):
--     todos los pedidos existentes quedan 'interno' (el DEFAULT rellena las filas previas).
--   * orders.seller_id pasa a NULLABLE: un pedido web nace SIN vendedor (lo asigna la
--     aprobacion, D1). CHECK orders_seller_required_chk: seller_id solo puede ser NULL si el
--     pedido es web y esta Pending o Cancelled. Todo pedido interno (y todo pedido aprobado,
--     en preparacion o entregado) sigue exigiendo vendedor, igual que antes.
--   * orders.rejection_reason text (lo usa el rechazo, D1).
--   * indice parcial idx_orders_web_pending (tenant_id, created_at) WHERE origin='web' AND
--     status='Pending' (bandeja de aprobacion y limite de pendientes por cliente).
--
-- NO TOCA politicas RLS ni triggers: los pedidos web (seller_id NULL) los ven admin,
-- supervisor y despachador por la politica orders_select_v4 existente (rol); un vendedor
-- `own` no los ve hasta D1 (bandeja especifica). El trigger de stock solo descuenta con
-- Approved, asi que un Pending web no mueve inventario.
--
-- AUTOVERIFICACION (cualquier fallo => RAISE EXCEPTION => rollback total)
--   A. catalogo: columnas, nulabilidad, defaults, CHECKs, indice parcial
--   B. comportamiento (sub-bloque con centinela ZZ001; todo se deshace):
--      default 'interno', web Pending/Cancelled sin vendedor aceptado, web Approved sin
--      vendedor / interno sin vendedor / origin invalido rechazados, rejection_reason
--      escribible; ninguna fila previa quedo con origin distinto de 'interno'.
--
-- Rollback: supabase/rollback/20261208090000_pedidos_web_origen.down.sql
-- =============================================================================

BEGIN;

-- >>> IMPLEMENTACION

-- 1. origen del pedido (el DEFAULT rellena las filas previas con 'interno')
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'interno';

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_origin_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_origin_check CHECK (origin IN ('interno', 'web'));

-- 2. vendedor opcional SOLO para pedidos web Pending/Cancelled
ALTER TABLE public.orders ALTER COLUMN seller_id DROP NOT NULL;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_seller_required_chk;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_seller_required_chk
  CHECK (seller_id IS NOT NULL OR (origin = 'web' AND status IN ('Pending', 'Cancelled')));

-- 3. motivo de rechazo (lo escribe reject_web_order en D1)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 4. indice parcial de la bandeja / limite de pendientes
CREATE INDEX IF NOT EXISTS idx_orders_web_pending
  ON public.orders (tenant_id, created_at)
  WHERE origin = 'web' AND status = 'Pending';

-- >>> AUTOVERIFICACION

-- -----------------------------------------------------------------------------
-- AUTOVERIFICACION A: catalogo
-- -----------------------------------------------------------------------------
DO $verify_catalog$
DECLARE
  v_def text;
  v_n   int;
BEGIN
  -- origin
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'origin'
       AND data_type = 'text' AND is_nullable = 'NO' AND column_default ILIKE '%interno%'
  ) THEN
    RAISE EXCEPTION 'C1.2 VERIFY FAIL: orders.origin debe ser text NOT NULL DEFAULT ''interno''';
  END IF;

  -- seller_id nullable
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'seller_id'
       AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'C1.2 VERIFY FAIL: orders.seller_id debe ser NULLABLE';
  END IF;

  -- rejection_reason
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'rejection_reason'
       AND data_type = 'text'
  ) THEN
    RAISE EXCEPTION 'C1.2 VERIFY FAIL: falta orders.rejection_reason text';
  END IF;

  -- CHECKs
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.orders'::regclass AND c.conname = 'orders_origin_check' AND c.contype = 'c';
  IF v_def IS NULL OR v_def NOT ILIKE '%interno%' OR v_def NOT ILIKE '%web%' THEN
    RAISE EXCEPTION 'C1.2 VERIFY FAIL: orders_origin_check ausente o mal definido: %', coalesce(v_def, 'NULL');
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.orders'::regclass AND c.conname = 'orders_seller_required_chk' AND c.contype = 'c';
  IF v_def IS NULL OR v_def NOT ILIKE '%seller_id IS NOT NULL%' OR v_def NOT ILIKE '%web%'
     OR v_def NOT ILIKE '%Pending%' OR v_def NOT ILIKE '%Cancelled%' THEN
    RAISE EXCEPTION 'C1.2 VERIFY FAIL: orders_seller_required_chk ausente o mal definido: %', coalesce(v_def, 'NULL');
  END IF;

  -- indice parcial
  SELECT pg_get_indexdef(i.indexrelid) INTO v_def
    FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
   WHERE i.indrelid = 'public.orders'::regclass AND ic.relname = 'idx_orders_web_pending';
  IF v_def IS NULL OR v_def NOT ILIKE '%tenant_id%' OR v_def NOT ILIKE '%created_at%'
     OR v_def NOT ILIKE '%WHERE%' OR v_def NOT ILIKE '%origin%' OR v_def NOT ILIKE '%Pending%' THEN
    RAISE EXCEPTION 'C1.2 VERIFY FAIL: indice parcial idx_orders_web_pending ausente o mal definido: %', coalesce(v_def, 'NULL');
  END IF;

  -- ningun pedido previo cambio de origen
  SELECT count(*) INTO v_n FROM public.orders WHERE origin IS DISTINCT FROM 'interno';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'C1.2 VERIFY FAIL: % pedidos previos con origin distinto de interno', v_n;
  END IF;
END
$verify_catalog$;

-- -----------------------------------------------------------------------------
-- AUTOVERIFICACION B: comportamiento (sub-bloque con centinela, todo se deshace)
-- -----------------------------------------------------------------------------
DO $verify_behavior$
DECLARE
  v_fail   text := '';
  v_tenant uuid;
  v_cust   uuid;
  v_seller uuid;
  v_o      uuid;
  v_origin text;
  v_reason text;
  v_stamp  text := 'ZZ-C12-' || substr(gen_random_uuid()::text, 1, 8);
  v_state  text;
BEGIN
  SELECT p.id INTO v_seller FROM public.user_profiles p ORDER BY p.created_at NULLS LAST LIMIT 1;

  BEGIN  -- sub-bloque revertible
    INSERT INTO public.tenants (name) VALUES (v_stamp) RETURNING id INTO v_tenant;
    INSERT INTO public.customers (tenant_id, business_name, status) VALUES (v_tenant, v_stamp, 'activo') RETURNING id INTO v_cust;

    -- B1. un pedido que no declara origen es 'interno' (los inserts del front no cambian)
    IF v_seller IS NOT NULL THEN
      INSERT INTO public.orders (tenant_id, order_number, customer_id, seller_id, status, subtotal, total_amount)
      VALUES (v_tenant, v_stamp || '-1', v_cust, v_seller, 'Pending', 10, 10)
      RETURNING origin INTO v_origin;
      IF v_origin IS DISTINCT FROM 'interno' THEN
        v_fail := v_fail || format(E'\n - B1 origin por defecto = %s (esperado interno)', v_origin);
      END IF;
    ELSE
      RAISE NOTICE 'C1.2 VERIFY: no hay user_profiles; se omite B1 (pedido interno con vendedor)';
    END IF;

    -- B2. web Pending sin vendedor: aceptado, con rejection_reason escribible
    BEGIN
      INSERT INTO public.orders (tenant_id, order_number, customer_id, seller_id, status, origin, subtotal, total_amount)
      VALUES (v_tenant, v_stamp || '-2', v_cust, NULL, 'Pending', 'web', 10, 10)
      RETURNING id INTO v_o;
      UPDATE public.orders SET rejection_reason = 'motivo de prueba' WHERE id = v_o;
      SELECT rejection_reason INTO v_reason FROM public.orders WHERE id = v_o;
      IF v_reason IS DISTINCT FROM 'motivo de prueba' THEN
        v_fail := v_fail || E'\n - B2b rejection_reason no se pudo escribir';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || format(E'\n - B2 web Pending sin vendedor rechazado: %s', SQLERRM);
    END;

    -- B3. web Cancelled sin vendedor: aceptado (rechazo de un pedido web)
    BEGIN
      INSERT INTO public.orders (tenant_id, order_number, customer_id, seller_id, status, origin, subtotal, total_amount)
      VALUES (v_tenant, v_stamp || '-3', v_cust, NULL, 'Cancelled', 'web', 10, 10);
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || format(E'\n - B3 web Cancelled sin vendedor rechazado: %s', SQLERRM);
    END;

    -- B4. web Approved sin vendedor: rechazado (la aprobacion asigna vendedor)
    BEGIN
      INSERT INTO public.orders (tenant_id, order_number, customer_id, seller_id, status, origin, subtotal, total_amount)
      VALUES (v_tenant, v_stamp || '-4', v_cust, NULL, 'Approved', 'web', 10, 10);
      v_fail := v_fail || E'\n - B4 web Approved sin vendedor fue aceptado';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- B5. interno sin vendedor: rechazado (comportamiento previo intacto)
    BEGIN
      INSERT INTO public.orders (tenant_id, order_number, customer_id, seller_id, status, subtotal, total_amount)
      VALUES (v_tenant, v_stamp || '-5', v_cust, NULL, 'Pending', 10, 10);
      v_fail := v_fail || E'\n - B5 pedido interno sin vendedor fue aceptado';
    EXCEPTION WHEN check_violation OR not_null_violation THEN NULL;
    END;

    -- B6. origin invalido: rechazado
    BEGIN
      INSERT INTO public.orders (tenant_id, order_number, customer_id, seller_id, status, origin, subtotal, total_amount)
      VALUES (v_tenant, v_stamp || '-6', v_cust, NULL, 'Pending', 'otro', 10, 10);
      v_fail := v_fail || E'\n - B6 origin ''otro'' fue aceptado';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- B7. interno Cancelled sin vendedor: rechazado (la excepcion es solo para web)
    BEGIN
      INSERT INTO public.orders (tenant_id, order_number, customer_id, seller_id, status, origin, subtotal, total_amount)
      VALUES (v_tenant, v_stamp || '-7', v_cust, NULL, 'Cancelled', 'interno', 10, 10);
      v_fail := v_fail || E'\n - B7 interno Cancelled sin vendedor fue aceptado';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    RAISE EXCEPTION 'c12_sentinel' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    NULL;  -- esperado: fixtures deshechos
  END;

  IF v_fail <> '' THEN
    RAISE EXCEPTION E'C1.2 VERIFY FAIL (comportamiento):%', v_fail;
  END IF;
END
$verify_behavior$;

COMMIT;
