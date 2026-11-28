-- =============================================================================
-- F1 / B4.6 - Habilitar la tienda del tenant demo (change: tienda-web-clientes)
--
-- QUE HACE
--   UPDATE tenants SET store_enabled = true, SOLO si existe EXACTAMENTE UN tenant activo.
--   Es la regla segura para resolver el tenant en SQL sin adivinar:
--     * 0 o 2+ tenants activos  => RAISE NOTICE y NO-OP (la migracion termina bien, no habilita nada;
--                                  habilitar a mano el tenant correcto, ver supabase/rollback/*.down.sql).
--     * ya hay un tenant con la tienda habilitada (el que sea) => NO-OP (idempotente, no se mueve).
--   El id del tenant habilitado se imprime en un NOTICE: es el valor de VITE_STORE_TENANT_ID.
--
-- POR QUE ES SEGURO HABILITARLA AHORA (F1: sin signup de tienda, sin pedidos)
--   Con store_enabled=true la rama "tienda" de handle_new_user (0b) crea un `customers` para
--   cualquier alta SIN invitacion valida. Esta migracion NO abre el signup (el toggle de
--   registro de Supabase Auth no vive en la base) ni da acceso alguno; lo que SI verifica es que
--   un alta asi no obtiene privilegios ni datos:
--     * sin user_profiles, sin claims de rol/tenant en app_metadata (aunque la metadata sea hostil);
--     * como `authenticated` con ese JWT: get_auth_tenant_id() es NULL y products / orders /
--       customers / user_profiles devuelven 0 filas;
--     * el unico conjunto de funciones store_* ejecutable por anon/authenticated son las dos RPCs
--       del catalogo (no existe ninguna de pedidos/cuenta);
--     * handle_new_user sigue ramificado (invitacion vigente => interna; el resto => tienda).
--
-- AUTOVERIFICACION (cualquier fallo => RAISE EXCEPTION => rollback total de esta migracion)
--   A. si hay exactamente 1 tenant activo, ESE tenant debe quedar con la tienda habilitada
--   B. anon llama store_list_products(tenant): sin cantidades (llaves exactas y seguras), con filas
--      si el tenant tiene productos activos; tenant inexistente => 0 filas; SELECT directo => 0
--   C. no-apertura del signup (ver arriba)
--   El bloque de comportamiento corre contra los datos reales con fixtures @test.invalid que se
--   deshacen (sub-bloque con centinela ZZ001); si no se pueden crear los fixtures de auth.users se
--   omite esa parte con un NOTICE (mismo criterio que 0b).
--
-- Rollback: supabase/rollback/20261201090000_habilitar_tienda_demo.down.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Habilitar (idempotente)
-- -----------------------------------------------------------------------------
DO $enable$
DECLARE
  v_enabled uuid;
  v_ids     uuid[];
BEGIN
  SELECT t.id INTO v_enabled FROM public.tenants t WHERE t.store_enabled LIMIT 1;
  IF v_enabled IS NOT NULL THEN
    RAISE NOTICE 'B4.6: la tienda ya esta habilitada para el tenant % (VITE_STORE_TENANT_ID); no se modifica nada', v_enabled;
    RETURN;
  END IF;

  SELECT array_agg(t.id) INTO v_ids FROM public.tenants t WHERE coalesce(t.is_active, true);

  IF coalesce(cardinality(v_ids), 0) <> 1 THEN
    RAISE NOTICE 'B4.6: se esperaba EXACTAMENTE 1 tenant activo y hay %; la tienda NO se habilito (NO-OP). Habilitala a mano para el tenant correcto: UPDATE public.tenants SET store_enabled = true WHERE id = ''<uuid>'';',
      coalesce(cardinality(v_ids), 0);
    RETURN;
  END IF;

  UPDATE public.tenants SET store_enabled = true WHERE id = v_ids[1] AND NOT store_enabled;
  RAISE NOTICE 'B4.6: tienda habilitada para el tenant % (usalo como VITE_STORE_TENANT_ID en Vercel)', v_ids[1];
END
$enable$;

-- -----------------------------------------------------------------------------
-- 2. AUTOVERIFICACION
-- -----------------------------------------------------------------------------
DO $verify$
DECLARE
  c_allowed constant text[] := ARRAY['availability', 'caliber', 'image_url', 'name', 'price', 'product_key', 'quality'];
  u1 constant uuid := '33330000-f0b4-0000-0000-000000000001';  -- alta con metadata hostil
  u2 constant uuid := '33330000-f0b4-0000-0000-000000000002';  -- alta de tienda normal
  v_ids    uuid[];
  v_store  uuid;
  v_active int;
  v_n      int;
  v_keys   text[];
  v_bad    int;
  v_has    boolean;
  v_app    jsonb;
  v_tid    uuid;
  v_ct     uuid;
  v_tbl    text;
  v_fns    text[];
  v_def    text;
  v_fail   text := '';
  v_ready  boolean := false;
BEGIN
  SELECT array_agg(t.id) INTO v_ids FROM public.tenants t WHERE coalesce(t.is_active, true);
  SELECT t.id INTO v_store FROM public.tenants t WHERE t.store_enabled;  -- a lo sumo 1 (indice unico parcial)

  -- A. con exactamente 1 tenant activo y ninguna tienda habilitada en otro tenant, DEBE quedar habilitada
  --    para ese tenant (si la tienda ya estaba en otro tenant, la migracion no la mueve: no-op)
  IF coalesce(cardinality(v_ids), 0) = 1 AND v_store IS NULL THEN
    RAISE EXCEPTION 'B4.6 VERIFY FAIL: unico tenant activo % sin tienda habilitada', v_ids[1];
  END IF;

  IF v_store IS NULL THEN
    RAISE NOTICE 'B4.6 VERIFY: ningun tenant con tienda habilitada (no-op por la regla de un unico tenant activo): se omite el bloque de comportamiento';
    RETURN;
  END IF;
  IF NOT coalesce((SELECT t.is_active FROM public.tenants t WHERE t.id = v_store), true) THEN
    RAISE NOTICE 'B4.6 VERIFY: el tenant con tienda (%) esta inactivo: se omite el bloque de comportamiento', v_store;
    RETURN;
  END IF;

  -- C1. handle_new_user sigue siendo la version ramificada y segura (0b)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'handle_new_user'
       AND p.prosecdef AND p.prosrc ILIKE '%staff_invitations%'
       AND p.prosrc NOT ILIKE '%''roles''%' AND p.prosrc NOT ILIKE '%''tenant_id''%' AND p.prosrc NOT ILIKE '%''role''%'
  ) THEN
    RAISE EXCEPTION 'B4.6 VERIFY FAIL: handle_new_user no es la version ramificada (invitacion vigente => interna) o lee roles/tenant de la metadata';
  END IF;
  SELECT pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_trigger t
   WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal;
  IF v_def IS NULL OR v_def NOT ILIKE '%AFTER INSERT%' OR v_def NOT ILIKE '%handle_new_user%' THEN
    RAISE EXCEPTION 'B4.6 VERIFY FAIL: on_auth_user_created ausente o mal definido: %', coalesce(v_def, 'NULL');
  END IF;

  -- C2. las unicas funciones store_* ejecutables por anon/authenticated son las 2 RPCs del catalogo
  SELECT array_agg(p.proname::text ORDER BY p.proname) INTO v_fns
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname LIKE 'store\_%'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_fns IS DISTINCT FROM ARRAY['store_get_product', 'store_list_products']::text[] THEN
    RAISE EXCEPTION 'B4.6 VERIFY FAIL: funciones store_* ejecutables por anon/authenticated: % (esperado solo store_get_product y store_list_products)', v_fns;
  END IF;

  SELECT count(*) INTO v_active FROM public.products p WHERE p.tenant_id = v_store AND p.status = 'active';

  -- B + C3. comportamiento sobre los datos reales (todo lo que escriba se revierte)
  BEGIN
    -- Fixtures de alta (auth.users): hostil (roles/tenant en metadata) y normal
    BEGIN
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES
        (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b46-evil@test.invalid', '', '{}'::jsonb,
         jsonb_build_object('roles', jsonb_build_array('admin'), 'role', 'admin', 'tenant_id', gen_random_uuid(), 'full_name', 'Evil'),
         now(), now()),
        (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b46-shop@test.invalid', '', '{}'::jsonb,
         jsonb_build_object('full_name', 'Cliente Tienda', 'phone', '70000000'),
         now(), now());
      v_ready := true;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'B4.6 VERIFY: no se pudieron crear fixtures de auth.users (%): se omite la verificacion de no-apertura del signup', SQLERRM;
    END;

    -- B. anon: catalogo del tenant habilitado, sin cantidades
    PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
    SET LOCAL ROLE anon;

    SELECT count(*) INTO v_n FROM public.store_list_products(v_store, NULL, 100, 0);
    IF v_active > 0 AND v_n = 0 THEN
      v_fail := v_fail || format(E'\n - B1 anon recibe 0 filas pero el tenant tiene %s productos activos (tienda no efectiva)', v_active);
    END IF;

    SELECT coalesce(array_agg(DISTINCT k ORDER BY k), ARRAY[]::text[]) INTO v_keys
      FROM public.store_list_products(v_store, NULL, 100, 0) x, LATERAL jsonb_object_keys(to_jsonb(x)) k;
    IF NOT (v_keys <@ c_allowed) THEN
      v_fail := v_fail || format(E'\n - B2 el payload anon trae llaves no permitidas (posibles cantidades/costos/ids): %s', v_keys);
    END IF;
    IF v_active > 0 AND v_keys IS DISTINCT FROM c_allowed THEN
      v_fail := v_fail || format(E'\n - B2b llaves del payload anon: %s (esperadas exactamente %s)', v_keys, c_allowed);
    END IF;

    SELECT count(*) INTO v_bad FROM public.store_list_products(v_store, NULL, 100, 0) x
     WHERE x.availability NOT IN ('Disponible', 'Agotado');
    IF v_bad <> 0 THEN
      v_fail := v_fail || format(E'\n - B3 %s filas con disponibilidad distinta de Disponible/Agotado', v_bad);
    END IF;

    SELECT count(*) INTO v_n FROM public.store_list_products(gen_random_uuid(), NULL, 100, 0);
    IF v_n <> 0 THEN
      v_fail := v_fail || format(E'\n - B4 un tenant inexistente devolvio %s filas', v_n);
    END IF;

    v_n := 0;
    BEGIN
      SELECT count(*) INTO v_n FROM public.products;
    EXCEPTION WHEN insufficient_privilege THEN v_n := 0;
    END;
    IF v_n <> 0 THEN
      v_fail := v_fail || format(E'\n - B5 anon vio %s filas de products por SELECT directo', v_n);
    END IF;
    RESET ROLE;

    -- C3. un alta sin invitacion NO obtiene privilegios ni datos
    IF v_ready THEN
      SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id IN (u1, u2)) INTO v_has;
      IF v_has THEN
        v_fail := v_fail || E'\n - C3a un alta sin invitacion creo user_profiles (acceso interno)';
      END IF;

      FOR v_tid, v_app IN SELECT u.id, u.raw_app_meta_data FROM auth.users u WHERE u.id IN (u1, u2) LOOP
        IF (v_app ? 'roles') OR (v_app ? 'role') OR (v_app ->> 'tenant_id') IS NOT NULL THEN
          v_fail := v_fail || format(E'\n - C3b alta %s con claims de rol/tenant en app_metadata: %s', v_tid, v_app);
        END IF;
      END LOOP;

      -- el alta hostil nunca cae en un tenant elegido por el cliente: solo en el de la tienda (o en ninguno)
      SELECT c.tenant_id INTO v_ct FROM public.customers c WHERE c.auth_user_id = u1;
      IF v_ct IS NOT NULL AND v_ct <> v_store THEN
        v_fail := v_fail || format(E'\n - C3c el alta con tenant_id hostil quedo en el tenant % (esperado % o ninguno)', v_ct, v_store);
      END IF;

      -- como ese usuario (JWT sin claims de tenant/rol)
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', u2, 'role', 'authenticated',
        'app_metadata', '{}'::jsonb, 'user_metadata', '{}'::jsonb)::text, true);
      SET LOCAL ROLE authenticated;

      v_tid := public.get_auth_tenant_id();
      IF v_tid IS NOT NULL THEN
        v_fail := v_fail || format(E'\n - C3d get_auth_tenant_id() de un alta de tienda = %s (esperado NULL)', v_tid);
      END IF;

      FOREACH v_tbl IN ARRAY ARRAY['products', 'orders', 'customers', 'user_profiles'] LOOP
        v_n := 0;
        BEGIN
          EXECUTE format('SELECT count(*) FROM public.%I', v_tbl) INTO v_n;
        EXCEPTION WHEN insufficient_privilege THEN v_n := 0;
        END;
        IF v_n <> 0 THEN
          v_fail := v_fail || format(E'\n - C3e un alta de tienda ve %s filas de %s', v_n, v_tbl);
        END IF;
      END LOOP;

      -- si, en cambio, puede listar el catalogo publico (para eso se habilita la tienda)
      SELECT count(*) INTO v_n FROM public.store_list_products(v_store, NULL, 100, 0);
      IF v_active > 0 AND v_n = 0 THEN
        v_fail := v_fail || E'\n - C3f un authenticated de tienda no puede listar el catalogo';
      END IF;
      RESET ROLE;
    END IF;

    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 'b46_sentinel' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    NULL;  -- esperado: fixtures y GUCs deshechos
  END;

  IF v_fail <> '' THEN
    RAISE EXCEPTION E'B4.6 VERIFY FAIL (comportamiento):%', v_fail;
  END IF;
END
$verify$;

COMMIT;
