-- =============================================================================
-- F2 / C1.3 - RPCs de pedidos web y cuenta del cliente (change: tienda-web-clientes)
--
-- QUE HACE
--   store_create_order(p_items jsonb, p_notes text DEFAULT NULL)
--       RETURNS TABLE(order_id uuid, order_number text, total numeric)
--   store_get_my_account()  RETURNS TABLE(contact_name, phone, address, department, municipality, email)
--   store_list_my_orders()  RETURNS TABLE(order_number, status, total_amount, created_at, items jsonb)
--
-- store_create_order (SECURITY DEFINER, search_path fijo, EXECUTE solo authenticated)
--   * Identidad: el llamador debe ser un CLIENTE DE TIENDA autenticado: customers.auth_user_id =
--     auth.uid() (lo crea handle_new_user, 0b), cliente activo y no borrado, de un tenant con
--     store_enabled e is_active, con email confirmado. El tenant y el cliente salen de esa fila,
--     NUNCA del payload ni de las claims del JWT (no lee app_metadata ni user_metadata).
--     Personal interno (con user_profiles) y anon quedan rechazados (42501).
--   * Sin pago en linea: crea un pedido 'Pending', origin 'web', seller_id NULL, con numeracion
--     PED- compartida (misma secuencia y formato que next_order_number; esa funcion exige personal
--     interno, asi que se llama a la secuencia directamente, y SOLO despues de validar todo: un
--     rechazo no consume numero).
--   * Precio: SIEMPRE products.price del servidor (cualquier price/unit_price/tenant_id/customer_id/
--     seller_id del payload se ignora). El total se calcula en el servidor.
--   * Reparto FIFO: cada cantidad pedida se reparte entre los lotes ACTIVOS del grupo
--     (md5(lower(name)|caliber|quality) = product_key) con stock >= 1 y precio > 0, del mas antiguo
--     (entry_date NULLS LAST, created_at, id) al siguiente; 1 order_items por lote, al precio de
--     ese lote. Stock total del grupo < cantidad => se RECHAZA TODO el pedido con un mensaje
--     generico (SQLSTATE SW001, sin cantidades disponibles ni en el mensaje ni en detalle/hint).
--   * NO descuenta stock (el descuento ocurre al aprobar, D2, con FOR UPDATE; el trigger de stock
--     solo actua con Approved). Un Pending web no mueve inventario.
--   * Limites: 1..30 items, cantidad entera 1..500 por item, sin productos repetidos, a lo sumo 3
--     pedidos Pending web por cliente (serializado con pg_advisory_xact_lock), notas <= 500.
--   * Codigos de error (SQLSTATE | mensaje): 42501|auth_required, 42501|forbidden, SW008|store_unavailable,
--     SW007|email_unconfirmed, SW006|too_many_pending, SW005|invalid_items, SW004|too_many_items,
--     SW003|invalid_quantity, SW002|product_unavailable, SW001|<mensaje generico con el producto>.
--
-- store_get_my_account / store_list_my_orders: SOLO lo propio (customers.auth_user_id = auth.uid()),
--   nunca p_customer_id. Los items del pedido se agrupan por producto (no se exponen lotes, ids,
--   tenant ni costos).
--
-- AUTOVERIFICACION (cualquier fallo => RAISE EXCEPTION => rollback total)
--   A. catalogo: firmas, DEFINER, search_path, privilegios (anon/PUBLIC sin EXECUTE), sin lectura de
--      user_metadata, sin sobrecargas
--   B. comportamiento con JWT simulados + SET LOCAL ROLE dentro de un sub-bloque con centinela ZZ001
--      (todo se deshace): reparto FIFO multi-lote, stock insuficiente generico, anon / personal /
--      cliente de otro tenant / tienda deshabilitada / sin confirmar / inactivo, precio manipulado,
--      validaciones, limite de Pending, sin descuento de stock, aislamiento de lo propio. La
--      secuencia de pedidos no se toca en los rechazos y se restaura al final.
--
-- Rollback: supabase/rollback/20261208100000_rpc_store_create_order.down.sql
-- =============================================================================

BEGIN;

-- >>> IMPLEMENTACION

-- -----------------------------------------------------------------------------
-- 1. store_create_order
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.store_create_order(p_items jsonb, p_notes text DEFAULT NULL)
RETURNS TABLE(order_id uuid, order_number text, total numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  c_max_items   CONSTANT int := 30;
  c_max_qty     CONSTANT int := 500;
  c_max_pending CONSTANT int := 3;
  c_max_notes   CONSTANT int := 500;

  v_uid       uuid := auth.uid();
  v_cust_id   uuid;
  v_tenant    uuid;
  v_confirmed boolean;
  v_pending   int;
  v_len       int;
  v_el        jsonb;
  v_key       text;
  v_qty_num   numeric;
  i           int;

  v_req_keys  text[] := ARRAY[]::text[];
  v_req_qtys  int[]  := ARRAY[]::int[];

  v_remaining bigint;
  v_lot       record;
  v_take      bigint;
  v_name      text;

  v_pids      uuid[]    := ARRAY[]::uuid[];
  v_qtys      int[]     := ARRAY[]::int[];
  v_prices    numeric[] := ARRAY[]::numeric[];
  v_subtotal  numeric   := 0;

  v_notes     text;
  v_order     uuid;
  v_number    text;
BEGIN
  -- 1. identidad: solo auth.uid(); el tenant y el cliente salen de la fila de customers
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  -- el personal interno no compra por la tienda
  IF EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT c.id, c.tenant_id INTO v_cust_id, v_tenant
    FROM public.customers c
    JOIN public.tenants t ON t.id = c.tenant_id
   WHERE c.auth_user_id = v_uid
     AND c.deleted_at IS NULL
     AND coalesce(c.status, 'activo') = 'activo'
     AND t.store_enabled
     AND coalesce(t.is_active, true);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'store_unavailable' USING ERRCODE = 'SW008';
  END IF;

  SELECT (u.email_confirmed_at IS NOT NULL) INTO v_confirmed FROM auth.users u WHERE u.id = v_uid;
  IF NOT coalesce(v_confirmed, false) THEN
    RAISE EXCEPTION 'email_unconfirmed' USING ERRCODE = 'SW007';
  END IF;

  -- 2. limite de pedidos Pending por cliente (serializado: dos envios simultaneos no lo saltan)
  PERFORM pg_advisory_xact_lock(hashtext('store_order:' || v_cust_id::text));
  SELECT count(*) INTO v_pending
    FROM public.orders o
   WHERE o.customer_id = v_cust_id AND o.origin = 'web' AND o.status = 'Pending';
  IF v_pending >= c_max_pending THEN
    RAISE EXCEPTION 'too_many_pending' USING ERRCODE = 'SW006';
  END IF;

  -- 3. estructura del payload (solo se leen product_key y quantity; el resto se ignora)
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = 'SW005';
  END IF;
  v_len := jsonb_array_length(p_items);
  IF v_len = 0 THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = 'SW005';
  END IF;
  IF v_len > c_max_items THEN
    RAISE EXCEPTION 'too_many_items' USING ERRCODE = 'SW004';
  END IF;

  FOR i IN 0 .. v_len - 1 LOOP
    v_el := p_items -> i;
    IF jsonb_typeof(v_el) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_el -> 'product_key') IS DISTINCT FROM 'string'
       OR btrim(v_el ->> 'product_key') = '' THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = 'SW005';
    END IF;
    v_key := lower(btrim(v_el ->> 'product_key'));
    IF v_key = ANY (v_req_keys) THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = 'SW005';
    END IF;

    IF jsonb_typeof(v_el -> 'quantity') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'SW003';
    END IF;
    v_qty_num := (v_el ->> 'quantity')::numeric;
    IF v_qty_num <> trunc(v_qty_num) OR v_qty_num < 1 OR v_qty_num > c_max_qty THEN
      RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'SW003';
    END IF;

    v_req_keys := v_req_keys || v_key;
    v_req_qtys := v_req_qtys || v_qty_num::int;
  END LOOP;

  -- 4. reparto FIFO por lotes y precio del servidor
  FOR i IN 1 .. cardinality(v_req_keys) LOOP
    v_remaining := v_req_qtys[i];

    FOR v_lot IN
      SELECT p.id, p.price, floor(p.available_quantity)::bigint AS avail
        FROM public.products p
       WHERE p.tenant_id = v_tenant
         AND p.status = 'active'
         AND p.price > 0
         AND p.available_quantity >= 1
         AND md5(lower(p.name) || '|' || coalesce(p.caliber, '') || '|' || coalesce(p.quality, '')) = v_req_keys[i]
       ORDER BY p.entry_date NULLS LAST, p.created_at, p.id
    LOOP
      v_take := least(v_remaining, v_lot.avail);
      v_pids   := v_pids   || v_lot.id;
      v_qtys   := v_qtys   || v_take::int;
      v_prices := v_prices || v_lot.price;
      v_subtotal := v_subtotal + v_take * v_lot.price;
      v_remaining := v_remaining - v_take;
      EXIT WHEN v_remaining = 0;
    END LOOP;

    IF v_remaining > 0 THEN
      SELECT p.name INTO v_name
        FROM public.products p
       WHERE p.tenant_id = v_tenant
         AND p.status = 'active'
         AND md5(lower(p.name) || '|' || coalesce(p.caliber, '') || '|' || coalesce(p.quality, '')) = v_req_keys[i]
       ORDER BY p.entry_date NULLS LAST, p.created_at, p.id
       LIMIT 1;

      IF v_name IS NULL THEN
        -- no existe (o esta inactivo / es de otro tenant) para este cliente
        RAISE EXCEPTION 'product_unavailable' USING ERRCODE = 'SW002';
      END IF;

      -- stock total del grupo menor al pedido: rechaza TODO el pedido sin revelar cantidades
      RAISE EXCEPTION 'No hay suficiente disponibilidad de %, probá con una cantidad menor', v_name
        USING ERRCODE = 'SW001', DETAIL = v_name;
    END IF;
  END LOOP;

  -- 5. todo validado: recien ahora se consume un numero de pedido (los rechazos no tocan la secuencia)
  v_number := 'PED-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD') || '-'
              || lpad(nextval('public.order_number_seq')::text, 4, '0');
  v_notes := nullif(left(btrim(coalesce(p_notes, '')), c_max_notes), '');

  INSERT INTO public.orders
    (tenant_id, customer_id, seller_id, status, origin, order_number, subtotal, discount_amount, total_amount, notes)
  VALUES
    (v_tenant, v_cust_id, NULL, 'Pending', 'web', v_number, v_subtotal, 0, v_subtotal, v_notes)
  RETURNING id INTO v_order;

  -- un order_items por lote; el trigger de stock NO descuenta (el pedido no esta Approved)
  INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, total_price)
  SELECT v_order, x.pid, x.q, x.pr, x.q * x.pr
    FROM unnest(v_pids, v_qtys, v_prices) AS x(pid, q, pr);

  RETURN QUERY SELECT v_order, v_number, v_subtotal;
END;
$$;

REVOKE ALL ON FUNCTION public.store_create_order(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.store_create_order(jsonb, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. store_get_my_account
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.store_get_my_account()
RETURNS TABLE(contact_name text, phone text, address text, department text, municipality text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT c.contact_name, c.phone, c.address, c.department, c.municipality, c.email
    FROM public.customers c
   WHERE c.auth_user_id = v_uid AND c.deleted_at IS NULL
   LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.store_get_my_account() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.store_get_my_account() TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. store_list_my_orders (items agrupados por producto: no se exponen lotes ni ids)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.store_list_my_orders()
RETURNS TABLE(order_number text, status text, total_amount numeric, created_at timestamptz, items jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_uid     uuid := auth.uid();
  v_cust_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = v_uid) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT c.id INTO v_cust_id
    FROM public.customers c
   WHERE c.auth_user_id = v_uid AND c.deleted_at IS NULL;
  IF v_cust_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT o.order_number, o.status, o.total_amount, o.created_at,
         coalesce((
           SELECT jsonb_agg(jsonb_build_object(
                    'name',        g.name,
                    'caliber',     g.caliber,
                    'quality',     g.quality,
                    'quantity',    g.qty,
                    'unit_price',  round(g.total / nullif(g.qty, 0), 2),
                    'total_price', g.total)
                  ORDER BY lower(g.name), g.caliber, g.quality)
             FROM (
               SELECT min(p.name) AS name, p.caliber, p.quality,
                      sum(oi.quantity)::int AS qty, sum(oi.total_price) AS total
                 FROM public.order_items oi
                 JOIN public.products p ON p.id = oi.product_id
                WHERE oi.order_id = o.id
                GROUP BY lower(p.name), p.caliber, p.quality
             ) g
         ), '[]'::jsonb)
    FROM public.orders o
   WHERE o.customer_id = v_cust_id AND o.origin = 'web'
   ORDER BY o.created_at DESC, o.order_number DESC
   LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.store_list_my_orders() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.store_list_my_orders() TO authenticated;

-- >>> AUTOVERIFICACION

-- -----------------------------------------------------------------------------
-- AUTOVERIFICACION A: catalogo
-- -----------------------------------------------------------------------------
DO $verify_catalog$
DECLARE
  r      record;
  v_n    int;
  v_args text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('store_create_order', 'p_items jsonb, p_notes text DEFAULT NULL::text',
       'TABLE(order_id uuid, order_number text, total numeric)'),
      ('store_get_my_account', '',
       'TABLE(contact_name text, phone text, address text, department text, municipality text, email text)'),
      ('store_list_my_orders', '',
       'TABLE(order_number text, status text, total_amount numeric, created_at timestamp with time zone, items jsonb)')
    ) AS t(fname, fargs, fret)
  LOOP
    SELECT count(*) INTO v_n
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = r.fname;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'C1.3 VERIFY FAIL: % debe existir exactamente una vez (hay %)', r.fname, v_n;
    END IF;

    SELECT pg_get_function_arguments(p.oid) INTO v_args
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = r.fname;
    IF v_args IS DISTINCT FROM r.fargs THEN
      RAISE EXCEPTION 'C1.3 VERIFY FAIL: % argumentos "%" (esperado "%")', r.fname, v_args, r.fargs;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'public' AND p.proname = r.fname
         AND pg_get_function_result(p.oid) = r.fret
         AND p.prosecdef
         AND p.proconfig IS NOT NULL
         AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c ILIKE 'search_path=%public%pg_temp%')
    ) THEN
      RAISE EXCEPTION 'C1.3 VERIFY FAIL: % no es SECURITY DEFINER con search_path fijo y el RETURNS esperado', r.fname;
    END IF;

    IF has_function_privilege('anon', ('public.' || r.fname || '(' ||
         CASE r.fname WHEN 'store_create_order' THEN 'jsonb, text' ELSE '' END || ')')::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'C1.3 VERIFY FAIL: anon tiene EXECUTE sobre %', r.fname;
    END IF;
    IF NOT has_function_privilege('authenticated', ('public.' || r.fname || '(' ||
         CASE r.fname WHEN 'store_create_order' THEN 'jsonb, text' ELSE '' END || ')')::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'C1.3 VERIFY FAIL: authenticated no tiene EXECUTE sobre %', r.fname;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace,
             LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       WHERE ns.nspname = 'public' AND p.proname = r.fname AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'C1.3 VERIFY FAIL: PUBLIC tiene EXECUTE sobre %', r.fname;
    END IF;

    -- nunca confia en metadata editable por el usuario
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'public' AND p.proname = r.fname
         AND (p.prosrc ILIKE '%user_metadata%' OR p.prosrc ILIKE '%app_metadata%')
    ) THEN
      RAISE EXCEPTION 'C1.3 VERIFY FAIL: % lee metadata del JWT; la identidad debe salir de auth.uid()', r.fname;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'public' AND p.proname = r.fname AND p.prosrc ILIKE '%auth.uid()%'
    ) THEN
      RAISE EXCEPTION 'C1.3 VERIFY FAIL: % no usa auth.uid()', r.fname;
    END IF;
  END LOOP;

  -- el cuerpo de store_create_order no descuenta stock ni confia en parametros de identidad
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'store_create_order'
       AND (p.prosrc ~* 'update\s+(public\.)?products' OR pg_get_function_arguments(p.oid) ~* 'tenant|customer|seller|price')
  ) THEN
    RAISE EXCEPTION 'C1.3 VERIFY FAIL: store_create_order no debe actualizar products ni recibir tenant/cliente/vendedor/precio';
  END IF;

  -- unica funcion store_* de pedidos/cuenta ejecutable por anon: ninguna
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('store_create_order', 'store_get_my_account', 'store_list_my_orders')
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'C1.3 VERIFY FAIL: % funciones de pedidos/cuenta ejecutables por anon', v_n;
  END IF;
END
$verify_catalog$;

-- -----------------------------------------------------------------------------
-- AUTOVERIFICACION B: comportamiento (JWT simulados + SET LOCAL ROLE; todo se deshace)
-- -----------------------------------------------------------------------------
DO $verify_behavior$
DECLARE
  c_call  CONSTANT text := 'SELECT order_id FROM public.store_create_order(%L::jsonb, %L)';
  c_msg1  CONSTANT text := 'No hay suficiente disponibilidad de ZZ Manzana, probá con una cantidad menor';
  v_fail  text := '';
  v_ready boolean := false;
  v_stamp text := 'zzc13-' || substr(gen_random_uuid()::text, 1, 8);
  tA uuid := gen_random_uuid();
  tB uuid := gen_random_uuid();
  uA uuid := gen_random_uuid();   -- cliente feliz (JWT con claims hostiles)
  uV uuid := gen_random_uuid();   -- cliente de validaciones
  uU uuid := gen_random_uuid();   -- email sin confirmar
  uB uuid := gen_random_uuid();   -- cliente del otro tenant
  uN uuid := gen_random_uuid();   -- autenticado sin fila customers
  uI uuid := gen_random_uuid();   -- cliente inactivo
  uD uuid := gen_random_uuid();   -- cliente borrado (soft delete)
  uS uuid;                        -- personal interno (user_profiles)
  cA uuid; cV uuid; cU uuid; cB uuid;
  kG1 text := md5(lower('ZZ Manzana') || '|C1|Q1');
  kG2 text := md5(lower('ZZ Pera') || '|C2|Q1');
  kG3 text := md5(lower('ZZ Agotado') || '|C3|Q1');
  kG4 text := md5(lower('ZZ Retirado') || '|C4|Q1');
  kG5 text := md5(lower('ZZ Gratis') || '|C5|Q1');
  kGB text := md5(lower('ZZ Otro') || '|C9|Q1');
  jA text; jV text; jU text; jB text; jN text; jI text; jD text; jS text;
  c_anon CONSTANT text := '{"role": "anon"}';
  c_nosub CONSTANT text := '{"role": "authenticated"}';
  v_case  record;
  v_oid   uuid;
  v_state text; v_msg text; v_det text; v_hint text;
  v_ok    boolean;
  v_stock numeric;
  v_seq_last bigint; v_seq_called boolean;
  v_seq_now  bigint; v_seq_now_called boolean;
  v_n     int;
  v_big   text;
BEGIN
  BEGIN  -- sub-bloque revertible
    -- ---------------------------------------------------------------- fixtures
    INSERT INTO public.tenants (id, name) VALUES (tA, v_stamp || ' A'), (tB, v_stamp || ' B');
    UPDATE public.tenants SET store_enabled = false WHERE store_enabled;
    UPDATE public.tenants SET store_enabled = true WHERE id = tA;

    -- G1: 5 lotes (vacio mas antiguo, 3 @10, 4 @12, 10 @8 sin entry_date, inactivo 100); total vendible 17
    INSERT INTO public.products (tenant_id, name, brand, caliber, quality, shipment_number, available_quantity, price, status, entry_date, created_at)
    VALUES
      (tA, 'ZZ Manzana',  'ZZ', 'C1', 'Q1', 'ZZ-S01',   0.00, 99.00, 'active',   DATE '2025-12-01', now() - interval '9 days'),
      (tA, 'ZZ Manzana',  'ZZ', 'C1', 'Q1', 'ZZ-S02',   3.00, 10.00, 'active',   DATE '2026-01-01', now() - interval '8 days'),
      (tA, 'ZZ MANZANA',  'ZZ', 'C1', 'Q1', 'ZZ-S03',   4.00, 12.00, 'active',   DATE '2026-02-01', now() - interval '7 days'),
      (tA, 'ZZ Manzana',  'ZZ', 'C1', 'Q1', 'ZZ-S04',  10.00,  8.00, 'active',   NULL,              now() - interval '6 days'),
      (tA, 'ZZ Manzana',  'ZZ', 'C1', 'Q1', 'ZZ-S05', 100.00,  1.00, 'inactive', DATE '2025-11-01', now() - interval '10 days'),
      (tA, 'ZZ Pera',     'ZZ', 'C2', 'Q1', 'ZZ-S06',   2.00,  5.00, 'active',   DATE '2026-01-01', now() - interval '5 days'),
      (tA, 'ZZ Agotado',  'ZZ', 'C3', 'Q1', 'ZZ-S07',   0.00,  4.00, 'active',   DATE '2026-01-01', now() - interval '5 days'),
      (tA, 'ZZ Retirado', 'ZZ', 'C4', 'Q1', 'ZZ-S08',   5.00,  6.00, 'inactive', DATE '2026-01-01', now() - interval '5 days'),
      (tA, 'ZZ Gratis',   'ZZ', 'C5', 'Q1', 'ZZ-S09',   5.00,  0.00, 'active',   DATE '2026-01-01', now() - interval '5 days'),
      (tB, 'ZZ Otro',     'ZZ', 'C9', 'Q1', 'ZZ-S10',  10.00,  7.00, 'active',   DATE '2026-01-01', now() - interval '5 days');

    -- usuarios (con la tienda deshabilitada: handle_new_user no crea customers; igual se limpian)
    UPDATE public.tenants SET store_enabled = false WHERE id = tA;
    BEGIN
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
      VALUES
        (uA, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_stamp || '-a@test.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now(), now()),
        (uV, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_stamp || '-v@test.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now(), now()),
        (uU, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_stamp || '-u@test.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now(), NULL),
        (uB, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_stamp || '-b@test.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now(), now()),
        (uN, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_stamp || '-n@test.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now(), now()),
        (uI, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_stamp || '-i@test.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now(), now()),
        (uD, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_stamp || '-d@test.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now(), now());
      v_ready := true;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'C1.3 VERIFY: no se pudieron crear fixtures de auth.users (%): se omite el bloque de comportamiento', SQLERRM;
    END;

    IF v_ready THEN
      DELETE FROM public.customers WHERE auth_user_id IN (uA, uV, uU, uB, uN, uI, uD);
      INSERT INTO public.customers (tenant_id, auth_user_id, email, business_name, contact_name, phone, address, department, municipality, status, deleted_at)
      VALUES
        (tA, uA, v_stamp || '-a@test.invalid', 'Cliente A', 'Cliente A', '70000001', 'Calle A 1', 'San Salvador', 'Soyapango', 'activo', NULL),
        (tA, uV, v_stamp || '-v@test.invalid', 'Cliente V', 'Cliente V', '70000002', 'Calle V', 'La Libertad', 'Santa Tecla', 'activo', NULL),
        (tA, uU, v_stamp || '-u@test.invalid', 'Cliente U', 'Cliente U', NULL, NULL, NULL, NULL, 'activo', NULL),
        (tB, uB, v_stamp || '-b@test.invalid', 'Cliente B', 'Cliente B', '70000003', 'Calle B', 'Santa Ana', 'Metapan', 'activo', NULL),
        (tA, uI, v_stamp || '-i@test.invalid', 'Cliente I', 'Cliente I', NULL, NULL, NULL, NULL, 'inactivo', NULL),
        (tA, uD, v_stamp || '-d@test.invalid', 'Cliente D', 'Cliente D', NULL, NULL, NULL, NULL, 'activo', now());
      SELECT id INTO cA FROM public.customers WHERE auth_user_id = uA;
      SELECT id INTO cV FROM public.customers WHERE auth_user_id = uV;
      SELECT id INTO cU FROM public.customers WHERE auth_user_id = uU;
      SELECT id INTO cB FROM public.customers WHERE auth_user_id = uB;

      -- personal interno: un perfil real; si no hay ninguno, se intenta crear uno de fixture
      SELECT p.id INTO uS FROM public.user_profiles p WHERE coalesce(p.is_active, true) ORDER BY p.created_at NULLS LAST LIMIT 1;
      IF uS IS NULL THEN
        BEGIN
          uS := gen_random_uuid();
          INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
          VALUES (uS, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_stamp || '-s@test.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now(), now());
          INSERT INTO public.user_profiles (id, tenant_id, role, full_name, email, is_active)
          VALUES (uS, tA, ARRAY['admin'], 'ZZ Staff', v_stamp || '-s@test.invalid', true);
        EXCEPTION WHEN OTHERS THEN
          uS := NULL;
          RAISE NOTICE 'C1.3 VERIFY: no hay perfiles internos y no se pudo crear uno de fixture (%): se omite el caso de personal', SQLERRM;
        END;
      END IF;

      UPDATE public.tenants SET store_enabled = true WHERE id = tA;

      -- JWT simulados. El cliente feliz lleva claims HOSTILES (tenant ajeno, rol admin, en app y user metadata)
      jA := jsonb_build_object('sub', uA, 'role', 'authenticated',
              'app_metadata',  jsonb_build_object('tenant_id', tB, 'roles', jsonb_build_array('admin')),
              'user_metadata', jsonb_build_object('tenant_id', tB, 'roles', jsonb_build_array('admin')))::text;
      jV := jsonb_build_object('sub', uV, 'role', 'authenticated')::text;
      jU := jsonb_build_object('sub', uU, 'role', 'authenticated')::text;
      jB := jsonb_build_object('sub', uB, 'role', 'authenticated')::text;
      jN := jsonb_build_object('sub', uN, 'role', 'authenticated')::text;
      jI := jsonb_build_object('sub', uI, 'role', 'authenticated')::text;
      jD := jsonb_build_object('sub', uD, 'role', 'authenticated')::text;
      jS := jsonb_build_object('sub', uS, 'role', 'authenticated',
              'app_metadata', jsonb_build_object('tenant_id', tA, 'roles', jsonb_build_array('admin')))::text;

      v_big := (SELECT jsonb_agg(jsonb_build_object('product_key', md5(i::text), 'quantity', 1))::text FROM generate_series(1, 31) i);

      CREATE TEMP TABLE zz_cases (
        ord serial, kind text, label text, claims text, role_ text, stmt text,
        expect text, like_ text, nodigits boolean DEFAULT false, detail_ text
      ) ON COMMIT DROP;

      -- kind: call (store_create_order, espera SQLSTATE o 'OK'), true (consulta bajo rol que debe dar true),
      --       exec (superusuario), assert (superusuario, debe dar true)
      INSERT INTO zz_cases (kind, label, claims, role_, stmt, expect, like_, nodigits, detail_) VALUES
        -- snapshot de secuencia y de stock antes de todo
        ('exec', 'snapshot secuencia', NULL, NULL,
         $q$SELECT set_config('c13.seq_last', last_value::text, true), set_config('c13.seq_called', is_called::text, true) FROM public.order_number_seq$q$, NULL, NULL, false, NULL),

        -- ================= identidad =================
        ('call', 'I1 anon', c_anon, 'anon',
         format(c_call, format('[{"product_key":"%s","quantity":1}]', kG2), NULL), '42501', NULL, false, NULL),
        ('call', 'I2 authenticated sin sub', c_nosub, 'authenticated',
         format(c_call, format('[{"product_key":"%s","quantity":1}]', kG2), NULL), '42501', 'auth_required', false, NULL),
        ('call', 'I4 autenticado sin fila customers', jN, 'authenticated',
         format(c_call, format('[{"product_key":"%s","quantity":1}]', kG2), NULL), 'SW008', 'store_unavailable', false, NULL),
        ('call', 'I5 cliente inactivo', jI, 'authenticated',
         format(c_call, format('[{"product_key":"%s","quantity":1}]', kG2), NULL), 'SW008', 'store_unavailable', false, NULL),
        ('call', 'I6 cliente borrado', jD, 'authenticated',
         format(c_call, format('[{"product_key":"%s","quantity":1}]', kG2), NULL), 'SW008', 'store_unavailable', false, NULL),
        ('call', 'I7 email sin confirmar', jU, 'authenticated',
         format(c_call, format('[{"product_key":"%s","quantity":1}]', kG2), NULL), 'SW007', 'email_unconfirmed', false, NULL),
        ('call', 'I8 cliente de tenant sin tienda (otro tenant)', jB, 'authenticated',
         format(c_call, format('[{"product_key":"%s","quantity":1}]', kG2), NULL), 'SW008', 'store_unavailable', false, NULL);

      IF uS IS NOT NULL THEN
        INSERT INTO zz_cases (kind, label, claims, role_, stmt, expect, like_, nodigits, detail_) VALUES
          ('call', 'I3 personal interno', jS, 'authenticated',
           format(c_call, format('[{"product_key":"%s","quantity":1}]', kG2), NULL), '42501', 'forbidden', false, NULL),
          ('call', 'I3b personal interno: mis pedidos', jS, 'authenticated',
           'SELECT count(*) FROM public.store_list_my_orders()', '42501', 'forbidden', false, NULL),
          ('call', 'I3c personal interno: mi cuenta', jS, 'authenticated',
           'SELECT count(*) FROM public.store_get_my_account()', '42501', 'forbidden', false, NULL);
      END IF;

      INSERT INTO zz_cases (kind, label, claims, role_, stmt, expect, like_, nodigits, detail_) VALUES
        ('call', 'I9 anon: mis pedidos', c_anon, 'anon', 'SELECT count(*) FROM public.store_list_my_orders()', '42501', NULL, false, NULL),
        ('call', 'I10 anon: mi cuenta', c_anon, 'anon', 'SELECT count(*) FROM public.store_get_my_account()', '42501', NULL, false, NULL),

        -- ================= validaciones (cliente de validaciones, no crean pedidos) =================
        ('call', 'V1 carrito vacio', jV, 'authenticated', format(c_call, '[]', NULL), 'SW005', 'invalid_items', false, NULL),
        ('call', 'V2 items no es arreglo', jV, 'authenticated', format(c_call, '{}', NULL), 'SW005', 'invalid_items', false, NULL),
        ('call', 'V3 items NULL', jV, 'authenticated', format(c_call, NULL, NULL), 'SW005', 'invalid_items', false, NULL),
        ('call', 'V4 demasiados items (31)', jV, 'authenticated', format(c_call, v_big, NULL), 'SW004', 'too_many_items', false, NULL),
        ('call', 'V5 cantidad 0', jV, 'authenticated', format(c_call, format('[{"product_key":"%s","quantity":0}]', kG2), NULL), 'SW003', 'invalid_quantity', false, NULL),
        ('call', 'V6 cantidad -1', jV, 'authenticated', format(c_call, format('[{"product_key":"%s","quantity":-1}]', kG2), NULL), 'SW003', 'invalid_quantity', false, NULL),
        ('call', 'V7 cantidad 1.5', jV, 'authenticated', format(c_call, format('[{"product_key":"%s","quantity":1.5}]', kG2), NULL), 'SW003', 'invalid_quantity', false, NULL),
        ('call', 'V8 cantidad como texto', jV, 'authenticated', format(c_call, format('[{"product_key":"%s","quantity":"1"}]', kG2), NULL), 'SW003', 'invalid_quantity', false, NULL),
        ('call', 'V9 cantidad null', jV, 'authenticated', format(c_call, format('[{"product_key":"%s","quantity":null}]', kG2), NULL), 'SW003', 'invalid_quantity', false, NULL),
        ('call', 'V10 sin cantidad', jV, 'authenticated', format(c_call, format('[{"product_key":"%s"}]', kG2), NULL), 'SW003', 'invalid_quantity', false, NULL),
        ('call', 'V11 cantidad sobre el maximo (501)', jV, 'authenticated', format(c_call, format('[{"product_key":"%s","quantity":501}]', kG1), NULL), 'SW003', 'invalid_quantity', false, NULL),
        ('call', 'V12 sin product_key', jV, 'authenticated', format(c_call, '[{"quantity":1}]', NULL), 'SW005', 'invalid_items', false, NULL),
        ('call', 'V13 product_key repetido', jV, 'authenticated', format(c_call, format('[{"product_key":"%1$s","quantity":1},{"product_key":"%1$s","quantity":1}]', kG2), NULL), 'SW005', 'invalid_items', false, NULL),
        ('call', 'V14 elemento que no es objeto', jV, 'authenticated', format(c_call, '[1]', NULL), 'SW005', 'invalid_items', false, NULL),
        ('call', 'V15 product_key inexistente', jV, 'authenticated', format(c_call, format('[{"product_key":"%s","quantity":1}]', md5('no existe')), NULL), 'SW002', 'product_unavailable', false, NULL),
        ('call', 'V16 product_key de otro tenant', jV, 'authenticated', format(c_call, format('[{"product_key":"%s","quantity":1}]', kGB), NULL), 'SW002', 'product_unavailable', false, NULL),
        ('call', 'V17 solo lotes inactivos', jV, 'authenticated', format(c_call, format('[{"product_key":"%s","quantity":1}]', kG4), NULL), 'SW002', 'product_unavailable', false, NULL),
        ('call', 'V18 agotado', jV, 'authenticated', format(c_call, format('[{"product_key":"%s","quantity":1}]', kG3), NULL), 'SW001', 'No hay suficiente disponibilidad de ZZ Agotado, probá con una cantidad menor', true, 'ZZ Agotado'),
        ('call', 'V19 solo lotes sin precio', jV, 'authenticated', format(c_call, format('[{"product_key":"%s","quantity":1}]', kG5), NULL), 'SW001', 'No hay suficiente disponibilidad de ZZ Gratis, probá con una cantidad menor', true, 'ZZ Gratis'),
        ('call', 'V20 stock insuficiente (18 de 17)', jV, 'authenticated', format(c_call, format('[{"product_key":"%s","quantity":18}]', kG1), NULL), 'SW001', c_msg1, true, 'ZZ Manzana'),
        ('call', 'V21 cantidad valida (500) pero sin stock', jV, 'authenticated', format(c_call, format('[{"product_key":"%s","quantity":500}]', kG1), NULL), 'SW001', c_msg1, true, 'ZZ Manzana'),
        ('call', 'V22 mezcla valido + insuficiente: rechaza TODO', jV, 'authenticated',
         format(c_call, format('[{"product_key":"%s","quantity":1},{"product_key":"%s","quantity":18}]', kG2, kG1), NULL), 'SW001', c_msg1, true, 'ZZ Manzana'),

        -- los rechazos no crearon pedidos ni consumieron numeros
        ('assert', 'V23 los rechazos no crearon pedidos', NULL, NULL,
         format($q$SELECT (SELECT count(*) FROM public.orders WHERE tenant_id = %L) = 0$q$, tA), NULL, NULL, false, NULL),
        ('assert', 'V24 los rechazos no consumieron la secuencia de pedidos', NULL, NULL,
         $q$SELECT (SELECT last_value FROM public.order_number_seq) = current_setting('c13.seq_last')::bigint
              AND (SELECT is_called FROM public.order_number_seq) = current_setting('c13.seq_called')::boolean$q$, NULL, NULL, false, NULL),

        -- ================= limite exacto de stock: 17 de 17 (cliente V) =================
        ('call', 'F1 pedido por todo el stock (17 de 17, 3 lotes)', jV, 'authenticated',
         format(c_call, format('[{"product_key":"%s","quantity":17}]', kG1), 'entrega manana'), 'OK', NULL, false, NULL),
        ('assert', 'F1a items 3@10 + 4@12 + 10@8 en 3 lotes distintos, total 158', NULL, NULL,
         format($q$SELECT (SELECT array_agg(oi.quantity::int || '@' || oi.unit_price ORDER BY p.entry_date NULLS LAST, p.created_at)
                             FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
                             JOIN public.products p ON p.id = oi.product_id WHERE o.customer_id = %L)
                           = ARRAY['3@10.00','4@12.00','10@8.00']
                    AND (SELECT count(DISTINCT oi.product_id) FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id WHERE o.customer_id = %L) = 3
                    AND (SELECT o.total_amount FROM public.orders o WHERE o.customer_id = %L) = 158$q$, cV, cV, cV), NULL, NULL, false, NULL),

        -- ================= camino feliz (cliente A, JWT con claims hostiles) =================
        -- H1: 5 de G1 (reparte 3 + 2) + 2 de G2; payload con precio/tenant/cliente/vendedor/lote falsificados
        ('call', 'H1 pedido FIFO 3+2 (lote viejo 3, pedido 5) + otro producto; payload falsificado', jA, 'authenticated',
         format(c_call, format('[{"product_key":"%s","quantity":5,"price":0.01,"unit_price":0.01,"total_price":0.05,"tenant_id":"%s","customer_id":"%s","seller_id":"%s","lot_id":"%s","product_id":"%s"},{"product_key":"%s","quantity":2,"price":0}]',
                kG1, tB, cB, coalesce(uS, uB), uB, uB, kG2), 'pedido de prueba'), 'OK', NULL, false, NULL),
        ('assert', 'H1a pedido con tenant/cliente del servidor, Pending, web, sin vendedor, PED- consecutivo', NULL, NULL,
         format($q$SELECT (SELECT count(*) FROM public.orders WHERE customer_id = %L) = 1
                    AND (SELECT count(*) FROM public.orders WHERE customer_id = %L AND tenant_id = %L AND seller_id IS NULL
                           AND status = 'Pending' AND origin = 'web' AND notes = 'pedido de prueba'
                           AND order_number ~ ('^PED-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD') || '-[0-9]{4,}$')) = 1
                    AND (SELECT count(*) FROM public.orders WHERE customer_id = %L) = 0$q$, cA, cA, tA, cB), NULL, NULL, false, NULL),
        ('assert', 'H1b FIFO: G1 reparte 3 en el lote mas antiguo y 2 en el siguiente; G2 2@5; precios del servidor', NULL, NULL,
         format($q$SELECT (SELECT array_agg(p.name || ':' || oi.quantity::int || '@' || oi.unit_price || '=' || oi.total_price ORDER BY lower(p.name), p.entry_date NULLS LAST, p.created_at)
                             FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
                             JOIN public.products p ON p.id = oi.product_id WHERE o.customer_id = %L)
                           = ARRAY['ZZ Manzana:3@10.00=30.00', 'ZZ MANZANA:2@12.00=24.00', 'ZZ Pera:2@5.00=10.00']$q$, cA), NULL, NULL, false, NULL),
        ('assert', 'H1c total y subtotal calculados en el servidor (64.00), no 0.05', NULL, NULL,
         format($q$SELECT (SELECT total_amount FROM public.orders WHERE customer_id = %L) = 64.00
                    AND (SELECT subtotal FROM public.orders WHERE customer_id = %L) = 64.00
                    AND (SELECT sum(oi.total_price) FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id WHERE o.customer_id = %L) = 64.00$q$, cA, cA, cA), NULL, NULL, false, NULL),
        ('assert', 'H1d sin descuento de stock (Pending no mueve inventario)', NULL, NULL,
         format($q$SELECT (SELECT array_agg(p.available_quantity ORDER BY lower(p.name), p.entry_date NULLS LAST, p.created_at) FROM public.products p WHERE p.tenant_id = %L)
                           = ARRAY[0.00, 5.00, 100.00, 0.00, 3.00, 4.00, 10.00, 2.00, 5.00]::numeric[]
                    AND (SELECT available_quantity FROM public.products WHERE tenant_id = %L) = 10.00$q$, tA, tB), NULL, NULL, false, NULL),

        -- H2: 9 de G1 (3 + 4 + 2 del lote sin entry_date) con notas de 600 caracteres
        ('call', 'H2 pedido FIFO 3+4+2 en tres lotes, notas largas', jA, 'authenticated',
         format(c_call, format('[{"product_key":"%s","quantity":9}]', kG1), repeat('n', 600)), 'OK', NULL, false, NULL),
        ('assert', 'H2a items 3@10, 4@12, 2@8 y total 94.00; notas truncadas a 500', NULL, NULL,
         format($q$SELECT (SELECT array_agg(oi.quantity::int || '@' || oi.unit_price ORDER BY p.entry_date NULLS LAST, p.created_at)
                             FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
                             JOIN public.products p ON p.id = oi.product_id
                            WHERE o.customer_id = %L AND o.total_amount = 94.00)
                           = ARRAY['3@10.00','4@12.00','2@8.00']
                    AND (SELECT length(notes) FROM public.orders WHERE customer_id = %L AND total_amount = 94.00) = 500$q$, cA, cA), NULL, NULL, false, NULL),

        -- H3: 1 de G1 (un solo lote), tercer pendiente
        ('call', 'H3 pedido de 1 unidad (un solo lote)', jA, 'authenticated',
         format(c_call, format('[{"product_key":"%s","quantity":1}]', kG1), NULL), 'OK', NULL, false, NULL),
        ('assert', 'H3a un solo item 1@10 y total 10.00', NULL, NULL,
         format($q$SELECT (SELECT count(*) FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
                            WHERE o.customer_id = %L AND o.total_amount = 10.00) = 1$q$, cA), NULL, NULL, false, NULL),

        -- limite de pedidos Pending web por cliente (3)
        ('call', 'L1 cuarto pedido Pending rechazado', jA, 'authenticated',
         format(c_call, format('[{"product_key":"%s","quantity":1}]', kG2), NULL), 'SW006', 'too_many_pending', false, NULL),
        ('assert', 'L1a sigue habiendo 3 pedidos del cliente A', NULL, NULL,
         format($q$SELECT (SELECT count(*) FROM public.orders WHERE customer_id = %L) = 3$q$, cA), NULL, NULL, false, NULL),

        -- numeracion: 4 pedidos creados (V + 3 de A), consecutivos
        ('assert', 'N1 la secuencia avanzo exactamente 4 (un numero por pedido creado) y los numeros son consecutivos', NULL, NULL,
         format($q$SELECT ((SELECT last_value FROM public.order_number_seq) - current_setting('c13.seq_last')::bigint
                           + CASE WHEN current_setting('c13.seq_called')::boolean THEN 0 ELSE 1 END) = 4
                    AND (SELECT max(substr(order_number, 14)::bigint) - min(substr(order_number, 14)::bigint)
                           FROM public.orders WHERE tenant_id = %L) = 3
                    AND (SELECT count(DISTINCT order_number) FROM public.orders WHERE tenant_id = %L) = 4$q$, tA, tA), NULL, NULL, false, NULL),
        ('assert', 'N2 mismo formato que next_order_number (PED-YYYYMMDD-NNNN)', NULL, NULL,
         format($q$SELECT NOT EXISTS (SELECT 1 FROM public.orders WHERE tenant_id = %L
                                       AND order_number !~ ('^PED-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD') || '-[0-9]{4,}$'))$q$, tA), NULL, NULL, false, NULL),

        -- ================= consultas de lo propio =================
        ('true', 'A1 cliente A: ve exactamente sus 3 pedidos', jA, 'authenticated',
         'SELECT count(*) = 3 FROM public.store_list_my_orders()', 'true', NULL, false, NULL),
        ('true', 'A2 items agrupados por producto (sin lotes) con llaves exactas', jA, 'authenticated',
         $q$SELECT (SELECT jsonb_array_length(items) FROM public.store_list_my_orders() WHERE total_amount = 64.00) = 2
              AND (SELECT array_agg(DISTINCT k ORDER BY k) FROM public.store_list_my_orders() o,
                          LATERAL jsonb_array_elements(o.items) e, LATERAL jsonb_object_keys(e) k)
                  = ARRAY['caliber','name','quality','quantity','total_price','unit_price']$q$, 'true', NULL, false, NULL),
        ('true', 'A3 el grupo G1 del pedido H1 suma 5 unidades y 54.00', jA, 'authenticated',
         $q$SELECT EXISTS (SELECT 1 FROM public.store_list_my_orders() o, LATERAL jsonb_array_elements(o.items) e
                            WHERE o.total_amount = 64.00 AND e ->> 'name' = 'ZZ Manzana'
                              AND (e ->> 'quantity')::int = 5 AND (e ->> 'total_price')::numeric = 54.00)$q$, 'true', NULL, false, NULL),
        ('true', 'A4 cliente V solo ve el suyo (158.00)', jV, 'authenticated',
         'SELECT count(*) = 1 AND bool_and(total_amount = 158.00) FROM public.store_list_my_orders()', 'true', NULL, false, NULL),
        ('true', 'A5 autenticado sin cliente: 0 pedidos y 0 cuentas', jN, 'authenticated',
         'SELECT (SELECT count(*) FROM public.store_list_my_orders()) = 0 AND (SELECT count(*) FROM public.store_get_my_account()) = 0', 'true', NULL, false, NULL),
        ('true', 'A6 mi cuenta: solo la propia', jA, 'authenticated',
         format($q$SELECT count(*) = 1 AND bool_and(contact_name = 'Cliente A' AND phone = '70000001' AND address = 'Calle A 1'
                                                AND department = 'San Salvador' AND municipality = 'Soyapango'
                                                AND email = %L) FROM public.store_get_my_account()$q$, v_stamp || '-a@test.invalid'), 'true', NULL, false, NULL),
        ('true', 'A7 mi cuenta: las columnas son solo las 6 del contrato', jV, 'authenticated',
         $q$SELECT (SELECT array_agg(k ORDER BY k) FROM public.store_get_my_account() a, LATERAL jsonb_object_keys(to_jsonb(a)) k)
                   = ARRAY['address','contact_name','department','email','municipality','phone']$q$, 'true', NULL, false, NULL),

        -- ================= tienda deshabilitada / otro tenant (la tienda pasa a B) =================
        ('exec', 'la tienda pasa del tenant A al B', NULL, NULL,
         format($q$UPDATE public.tenants SET store_enabled = false WHERE store_enabled; UPDATE public.tenants SET store_enabled = true WHERE id = %L$q$, tB), NULL, NULL, false, NULL),
        ('call', 'D1 tienda deshabilitada: el cliente de A es rechazado', jA, 'authenticated',
         format(c_call, format('[{"product_key":"%s","quantity":1}]', kG2), NULL), 'SW008', 'store_unavailable', false, NULL),
        ('call', 'D2 cliente de B con product_key de A: rechazado', jB, 'authenticated',
         format(c_call, format('[{"product_key":"%s","quantity":1}]', kG2), NULL), 'SW002', 'product_unavailable', false, NULL),
        ('call', 'D3 cliente de B con producto de B: OK', jB, 'authenticated',
         format(c_call, format('[{"product_key":"%s","quantity":2,"price":0.01}]', kGB), NULL), 'OK', NULL, false, NULL),
        ('assert', 'D3a pedido en el tenant B, cliente B, total 14.00', NULL, NULL,
         format($q$SELECT (SELECT count(*) FROM public.orders WHERE customer_id = %L AND tenant_id = %L AND total_amount = 14.00
                             AND status = 'Pending' AND origin = 'web' AND seller_id IS NULL) = 1$q$, cB, tB), NULL, NULL, false, NULL),
        ('true', 'D4 cliente B ve solo su pedido', jB, 'authenticated',
         'SELECT count(*) = 1 AND bool_and(total_amount = 14.00) FROM public.store_list_my_orders()', 'true', NULL, false, NULL),
        ('true', 'D5 cliente A conserva su cuenta y sus pedidos aunque la tienda este deshabilitada', jA, 'authenticated',
         'SELECT (SELECT count(*) FROM public.store_list_my_orders()) = 3 AND (SELECT count(*) FROM public.store_get_my_account()) = 1', 'true', NULL, false, NULL),

        -- ================= invariantes finales =================
        ('assert', 'Z1 ningun producto cambio de stock en todo el recorrido', NULL, NULL,
         format($q$SELECT (SELECT sum(available_quantity) FROM public.products WHERE tenant_id = %L) = 129.00
                    AND (SELECT sum(available_quantity) FROM public.products WHERE tenant_id = %L) = 10.00$q$, tA, tB), NULL, NULL, false, NULL),
        ('assert', 'Z2 todos los pedidos de la prueba son web, Pending y sin vendedor', NULL, NULL,
         format($q$SELECT NOT EXISTS (SELECT 1 FROM public.orders WHERE tenant_id IN (%L, %L)
                                       AND (origin <> 'web' OR status <> 'Pending' OR seller_id IS NOT NULL))$q$, tA, tB), NULL, NULL, false, NULL);

      -- ---------------------------------------------------------------- ejecucion
      FOR v_case IN SELECT * FROM zz_cases ORDER BY ord LOOP
        v_state := NULL; v_msg := NULL; v_det := NULL; v_hint := NULL; v_ok := NULL;

        IF v_case.kind = 'exec' THEN
          EXECUTE v_case.stmt;
          CONTINUE;
        END IF;

        IF v_case.kind = 'assert' THEN
          EXECUTE v_case.stmt INTO v_ok;
          IF v_ok IS DISTINCT FROM true THEN
            v_fail := v_fail || format(E'\n - %s', v_case.label);
          END IF;
          CONTINUE;
        END IF;

        PERFORM set_config('request.jwt.claims', v_case.claims, true);
        EXECUTE format('SET LOCAL ROLE %I', v_case.role_);
        BEGIN
          IF v_case.kind = 'true' THEN
            EXECUTE v_case.stmt INTO v_ok;
            v_state := CASE WHEN v_ok IS NOT DISTINCT FROM true THEN 'true' ELSE 'false' END;
          ELSE
            EXECUTE v_case.stmt INTO v_oid;
            v_state := 'OK';
          END IF;
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT,
                                  v_det = PG_EXCEPTION_DETAIL, v_hint = PG_EXCEPTION_HINT;
        END;
        RESET ROLE;

        IF v_state IS DISTINCT FROM v_case.expect THEN
          v_fail := v_fail || format(E'\n - %s: resultado %s | %s (esperado %s)', v_case.label, v_state, coalesce(v_msg, ''), v_case.expect);
        ELSIF v_case.like_ IS NOT NULL AND v_msg IS DISTINCT FROM v_case.like_ THEN
          v_fail := v_fail || format(E'\n - %s: mensaje "%s" (esperado "%s")', v_case.label, v_msg, v_case.like_);
        END IF;
        IF v_case.nodigits AND (coalesce(v_msg, '') ~ '[0-9]' OR coalesce(v_det, '') ~ '[0-9]' OR coalesce(v_hint, '') <> '') THEN
          v_fail := v_fail || format(E'\n - %s: el rechazo revela cantidades (mensaje "%s", detalle "%s", hint "%s")', v_case.label, v_msg, v_det, v_hint);
        END IF;
        IF v_case.detail_ IS NOT NULL AND v_det IS DISTINCT FROM v_case.detail_ THEN
          v_fail := v_fail || format(E'\n - %s: detalle "%s" (esperado solo el nombre "%s")', v_case.label, v_det, v_case.detail_);
        END IF;
      END LOOP;

      -- la secuencia de pedidos se restaura SOLO si nadie mas la uso mientras corria la prueba
      -- (comparar-y-restaurar: sin condicion podria duplicar numeros de un pedido real concurrente)
      SELECT count(*) INTO v_n FROM public.orders WHERE tenant_id IN (tA, tB);
      SELECT last_value, is_called INTO v_seq_now, v_seq_now_called FROM public.order_number_seq;
      v_seq_last := current_setting('c13.seq_last')::bigint;
      v_seq_called := current_setting('c13.seq_called')::boolean;
      IF v_seq_now = v_seq_last + v_n - (CASE WHEN v_seq_called THEN 0 ELSE 1 END) AND v_seq_now_called THEN
        PERFORM setval('public.order_number_seq', v_seq_last, v_seq_called);
      ELSE
        RAISE NOTICE 'C1.3 VERIFY: la secuencia de pedidos avanzo por otra sesion durante la prueba (% -> %); no se restaura (queda un hueco de % numero/s)', v_seq_last, v_seq_now, v_n;
      END IF;
    END IF;

    RAISE EXCEPTION 'c13_sentinel' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    NULL;  -- esperado: fixtures, GUCs y rol deshechos
  END;

  PERFORM set_config('request.jwt.claims', '', true);

  IF v_fail <> '' THEN
    RAISE EXCEPTION E'C1.3 VERIFY FAIL (comportamiento):%', v_fail;
  END IF;
END
$verify_behavior$;

COMMIT;
