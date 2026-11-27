-- =============================================================================
-- F0 / 0b - handle_new_user seguro y ramificado (change: tienda-web-clientes)
--
-- PROBLEMA: handle_new_user() confiaba en raw_user_meta_data (roles y tenant_id), que
-- cualquiera controla en un signUp: signup publico => perfil interno con el rol/tenant
-- que el atacante escriba.
--
-- SOLUCION:
--   * Rama INTERNA: solo si existe una invitacion vigente en staff_invitations
--     (email + nonce secreto, ver migracion 0a). El perfil se crea con los datos de la
--     INVITACION, nunca con la metadata. Las escribe la edge function con service_role.
--   * Rama TIENDA: cualquier alta sin invitacion valida. Si hay un tenant con
--     store_enabled, crea un customers (tenant resuelto en servidor, auth_user_id) y
--     NO crea user_profiles. Sin tenant de tienda habilitado, no crea nada.
--   * Cualquier error interno se captura (WARNING) y NUNCA bloquea el alta en auth.users.
--
-- Nuevo schema: tenants.store_enabled (maximo 1 tenant con true en v1),
--               customers.auth_user_id (unico, FK a auth.users) y customers.email.
--
-- COMPATIBILIDAD CON F1 (B1.3, 20261128100000_rpcs_catalogo_tienda): esa migracion crea
-- tenants.store_enabled y uq_tenants_single_store_enabled con IF NOT EXISTS y la MISMA
-- definicion, y puede aplicarse ANTES que esta. Aqui todo el DDL de schema es idempotente,
-- asi que esta migracion es un no-op sobre esas dos piezas (verificado en ambos ordenes).
-- IMPORTANTE (orden de despliegue): antes de mergear esta migracion a main, RENOMBRARLA con
-- un timestamp posterior a la ultima migracion aplicada (Supabase rechaza migraciones
-- fuera de orden). Ver tasks.md (A2.0).
--
-- ATENCION (transicion): hasta que las edge functions escriban staff_invitations
-- (tarea A2.4), el flujo "invite-employee" depende de que el trigger cree el perfil
-- desde la metadata y dejara de hacerlo. "manage-users" no se afecta porque hace su
-- propio upsert de user_profiles. Ver nota en tasks.md / design.md.
--
-- AUTOVERIFICACION: bloque DO antes del COMMIT (catalogo + comportamiento con
-- fixtures dentro de un sub-bloque que se revierte). Cualquier fallo => rollback total.
--
-- Rollback: supabase/rollback/20261127100000_handle_new_user_ramificado.down.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Schema
-- -----------------------------------------------------------------------------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS store_enabled boolean NOT NULL DEFAULT false;

-- A lo sumo UN tenant con tienda habilitada (v1): el trigger resuelve el tenant sin ambiguedad.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_single_store_enabled
  ON public.tenants ((true)) WHERE store_enabled;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS email text;

-- Unico por usuario de auth (los NULL no colisionan). Permite ON CONFLICT (auth_user_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_auth_user_id
  ON public.customers (auth_user_id);

-- -----------------------------------------------------------------------------
-- 2. handle_new_user ramificado
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv   public.staff_invitations;
  v_store uuid;
BEGIN
  BEGIN
    -- Rama interna: consume la invitacion (email + nonce vigentes y sin usar).
    UPDATE public.staff_invitations
       SET consumed_at = now(), consumed_by = NEW.id
     WHERE lower(email) = lower(NEW.email)
       AND nonce::text = NEW.raw_user_meta_data ->> 'invitation_nonce'
       AND consumed_at IS NULL
       AND expires_at > now()
    RETURNING * INTO v_inv;

    IF v_inv.id IS NOT NULL THEN
      -- Datos de la INVITACION, jamas de la metadata del cliente.
      INSERT INTO public.user_profiles (id, full_name, role, tenant_id, email, is_active, status)
      VALUES (NEW.id, coalesce(v_inv.full_name, 'Usuario Invitado'), v_inv.roles, v_inv.tenant_id,
              NEW.email, true, 'PENDING')
      ON CONFLICT (id) DO UPDATE
        SET role = EXCLUDED.role, tenant_id = EXCLUDED.tenant_id;
      -- sync_user_claims publica tenant/roles en app_metadata.
    ELSE
      -- Rama tienda: sin invitacion valida.
      SELECT t.id INTO v_store
        FROM public.tenants t
       WHERE t.store_enabled AND coalesce(t.is_active, true);

      IF v_store IS NOT NULL THEN
        INSERT INTO public.customers
          (tenant_id, auth_user_id, email, business_name, contact_name, phone, address,
           department, municipality, status)
        VALUES (
          v_store, NEW.id, NEW.email,
          left(coalesce(nullif(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''), NEW.email), 120),
          left(NEW.raw_user_meta_data ->> 'full_name', 120),
          left(NEW.raw_user_meta_data ->> 'phone', 20),
          left(NEW.raw_user_meta_data ->> 'address', 300),
          left(NEW.raw_user_meta_data ->> 'department', 60),
          left(NEW.raw_user_meta_data ->> 'municipality', 60),
          'activo')
        ON CONFLICT (auth_user_id) DO NOTHING;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Nunca bloquea el alta; el sub-bloque revierte lo parcial (incluida la invitacion consumida).
    RAISE WARNING 'handle_new_user % : %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. AUTOVERIFICACION A: catalogo
-- -----------------------------------------------------------------------------
DO $verify_catalog$
DECLARE
  v_def text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'tenants'
                    AND column_name = 'store_enabled' AND data_type = 'boolean'
                    AND is_nullable = 'NO' AND column_default = 'false') THEN
    RAISE EXCEPTION '0b VERIFY FAIL: tenants.store_enabled boolean NOT NULL DEFAULT false ausente o distinta';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname = 'uq_tenants_single_store_enabled'
                    AND i.indisunique AND i.indpred IS NOT NULL) THEN
    RAISE EXCEPTION '0b VERIFY FAIL: falta el indice unico parcial de tenants.store_enabled';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname = 'uq_customers_auth_user_id' AND i.indisunique) THEN
    RAISE EXCEPTION '0b VERIFY FAIL: falta el indice unico de customers.auth_user_id';
  END IF;

  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'customers'
         AND column_name IN ('auth_user_id', 'email')) <> 2 THEN
    RAISE EXCEPTION '0b VERIFY FAIL: faltan customers.auth_user_id / customers.email';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'handle_new_user'
       AND p.prosecdef AND coalesce(p.proconfig::text, '') ILIKE '%search_path%'
       AND p.prosrc ILIKE '%staff_invitations%' AND p.prosrc ILIKE '%EXCEPTION WHEN OTHERS%'
  ) THEN
    RAISE EXCEPTION '0b VERIFY FAIL: handle_new_user no es la version ramificada (DEFINER, search_path, staff_invitations, EXCEPTION)';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
              WHERE ns.nspname = 'public' AND p.proname = 'handle_new_user'
                AND (p.prosrc ILIKE '%''roles''%' OR p.prosrc ILIKE '%''tenant_id''%' OR p.prosrc ILIKE '%''role''%')) THEN
    RAISE EXCEPTION '0b VERIFY FAIL: handle_new_user sigue leyendo roles/tenant_id de la metadata';
  END IF;

  -- El trigger de auth.users sigue apuntando a handle_new_user (AFTER INSERT)
  SELECT pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_trigger t
   WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal;
  IF v_def IS NULL OR v_def NOT ILIKE '%AFTER INSERT%' OR v_def NOT ILIKE '%handle_new_user%' THEN
    RAISE EXCEPTION '0b VERIFY FAIL: on_auth_user_created ausente o mal definido en auth.users: %', coalesce(v_def, 'NULL');
  END IF;
END
$verify_catalog$;

-- -----------------------------------------------------------------------------
-- 4. AUTOVERIFICACION B: comportamiento con fixtures (se deshacen: sub-bloque con centinela)
--    Usuarios @test.invalid; GoTrue no interviene, asi que no hay emails ni side effects
--    fuera de la transaccion. Si no se pueden crear los fixtures (schema inesperado) se
--    omite esta parte con un NOTICE; el catalogo ya se verifico arriba.
-- -----------------------------------------------------------------------------
DO $verify_behavior$
DECLARE
  tA constant uuid := 'aaaaaaaa-f0b0-0000-0000-00000000000a';  -- tenant del invitador
  tB constant uuid := 'bbbbbbbb-f0b0-0000-0000-00000000000b';  -- tenant "ajeno" (metadata hostil)
  tS constant uuid := 'cccccccc-f0b0-0000-0000-00000000000c';  -- tenant con tienda
  v_fail  text := '';
  v_ready boolean := false;
  v_id    uuid;
  v_nonce text;
  v_pt    uuid;
  v_pr    text[];
  v_has   boolean;
  v_ct    uuid;
  v_cn    int;
  v_cons  boolean;
  v_app   jsonb;
  v_dup   boolean;
BEGIN
  BEGIN  -- sub-bloque revertible

    -- Setup
    BEGIN
      INSERT INTO public.tenants (id, name) VALUES (tA, 'F0B TEST A'), (tB, 'F0B TEST B'), (tS, 'F0B TEST TIENDA');
      UPDATE public.tenants SET store_enabled = false WHERE store_enabled;
      UPDATE public.tenants SET store_enabled = true WHERE id = tS;
      v_ready := true;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '0b VERIFY: no se pudieron crear fixtures de tenants (%): se omite el bloque de comportamiento', SQLERRM;
    END;

    IF v_ready THEN
      -- T0 indice unico: un segundo tenant con tienda habilitada debe fallar
      v_dup := false;
      BEGIN
        UPDATE public.tenants SET store_enabled = true WHERE id = tA;
      EXCEPTION WHEN unique_violation THEN
        v_dup := true;
      END;
      IF NOT v_dup THEN
        v_fail := v_fail || E'\n - T0 se pudo habilitar la tienda en dos tenants (indice unico parcial no actua)';
      END IF;

      -- T1 invitacion valida (+ metadata hostil adicional) => perfil con datos de la invitacion
      v_id := '22220000-f0b0-0000-0000-000000000001';
      INSERT INTO public.staff_invitations (email, full_name, roles, tenant_id, expires_at)
      VALUES ('f0b-invite@test.invalid', 'Invitado F0B', ARRAY['vendedor'], tA, now() + interval '1 hour')
      RETURNING nonce::text INTO v_nonce;
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f0b-invite@test.invalid', '',
              '{}'::jsonb,
              jsonb_build_object('invitation_nonce', v_nonce, 'roles', jsonb_build_array('admin'), 'tenant_id', tB),
              now(), now());
      SELECT tenant_id, role INTO v_pt, v_pr FROM public.user_profiles WHERE id = v_id;
      SELECT (consumed_at IS NOT NULL) INTO v_cons FROM public.staff_invitations WHERE nonce::text = v_nonce;
      SELECT count(*) INTO v_cn FROM public.customers WHERE auth_user_id = v_id;
      SELECT raw_app_meta_data INTO v_app FROM auth.users WHERE id = v_id;
      IF v_pt IS DISTINCT FROM tA OR v_pr IS DISTINCT FROM ARRAY['vendedor']::text[]
         OR NOT coalesce(v_cons, false) OR v_cn <> 0 THEN
        v_fail := v_fail || format(E'\n - T1 invitacion valida: tenant=%s (esp %s) role=%s (esp {vendedor}) consumida=%s customers=%s (esp 0)', v_pt, tA, v_pr, v_cons, v_cn);
      END IF;
      IF (v_app ->> 'tenant_id') IS DISTINCT FROM tA::text OR v_app -> 'roles' IS DISTINCT FROM '["vendedor"]'::jsonb THEN
        v_fail := v_fail || format(E'\n - T1b sync a app_metadata tras invitacion: %s', v_app);
      END IF;

      -- T2 nonce incorrecto => rama tienda (sin perfil, customers en el tenant de la tienda)
      v_id := '22220000-f0b0-0000-0000-000000000002';
      INSERT INTO public.staff_invitations (email, full_name, roles, tenant_id, expires_at)
      VALUES ('f0b-badnonce@test.invalid', 'Nonce Malo', ARRAY['admin'], tA, now() + interval '1 hour');
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f0b-badnonce@test.invalid', '',
              '{}'::jsonb, jsonb_build_object('invitation_nonce', gen_random_uuid()::text), now(), now());
      SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_id) INTO v_has;
      SELECT tenant_id INTO v_ct FROM public.customers WHERE auth_user_id = v_id;
      IF v_has OR v_ct IS DISTINCT FROM tS THEN
        v_fail := v_fail || format(E'\n - T2 nonce incorrecto: perfil=%s (esp false) customers.tenant=%s (esp %s)', v_has, v_ct, tS);
      END IF;

      -- T3 signup malicioso con metadata roles/tenant_id, sin invitacion
      v_id := '22220000-f0b0-0000-0000-000000000003';
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f0b-evil@test.invalid', '',
              '{}'::jsonb,
              jsonb_build_object('roles', jsonb_build_array('admin'), 'role', 'admin', 'tenant_id', tB, 'full_name', 'Evil'),
              now(), now());
      SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_id) INTO v_has;
      SELECT tenant_id INTO v_ct FROM public.customers WHERE auth_user_id = v_id;
      SELECT raw_app_meta_data INTO v_app FROM auth.users WHERE id = v_id;
      IF v_has OR v_ct IS DISTINCT FROM tS OR (v_app ? 'roles') OR (v_app ->> 'tenant_id') IS NOT NULL THEN
        v_fail := v_fail || format(E'\n - T3 metadata hostil: perfil=%s (esp false) customers.tenant=%s (esp %s) app_metadata=%s (esp sin claims)', v_has, v_ct, tS, v_app);
      END IF;

      -- T4 signup de tienda normal => customers(auth_user_id, email), sin perfil
      v_id := '22220000-f0b0-0000-0000-000000000004';
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f0b-shop@test.invalid', '',
              '{}'::jsonb, jsonb_build_object('full_name', 'Cliente Tienda', 'phone', '70000000'), now(), now());
      SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_id) INTO v_has;
      SELECT count(*) INTO v_cn FROM public.customers
       WHERE auth_user_id = v_id AND email = 'f0b-shop@test.invalid' AND tenant_id = tS;
      IF v_has OR v_cn <> 1 THEN
        v_fail := v_fail || format(E'\n - T4 signup de tienda: perfil=%s (esp false) customers=%s (esp 1)', v_has, v_cn);
      END IF;

      -- T5 invitacion expirada => no crea perfil
      v_id := '22220000-f0b0-0000-0000-000000000005';
      INSERT INTO public.staff_invitations (email, full_name, roles, tenant_id, expires_at)
      VALUES ('f0b-expired@test.invalid', 'Expirada', ARRAY['admin'], tA, now() - interval '1 minute')
      RETURNING nonce::text INTO v_nonce;
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f0b-expired@test.invalid', '',
              '{}'::jsonb, jsonb_build_object('invitation_nonce', v_nonce), now(), now());
      SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_id) INTO v_has;
      IF v_has THEN
        v_fail := v_fail || E'\n - T5 invitacion expirada creo un perfil';
      END IF;

      -- T6 nonce valido con otro email => no crea perfil ni consume la invitacion
      v_id := '22220000-f0b0-0000-0000-000000000006';
      INSERT INTO public.staff_invitations (email, full_name, roles, tenant_id, expires_at)
      VALUES ('f0b-owner@test.invalid', 'Dueno', ARRAY['admin'], tA, now() + interval '1 hour')
      RETURNING nonce::text INTO v_nonce;
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f0b-thief@test.invalid', '',
              '{}'::jsonb, jsonb_build_object('invitation_nonce', v_nonce), now(), now());
      SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_id) INTO v_has;
      SELECT (consumed_at IS NOT NULL) INTO v_cons FROM public.staff_invitations WHERE nonce::text = v_nonce;
      IF v_has OR coalesce(v_cons, true) THEN
        v_fail := v_fail || format(E'\n - T6 nonce con otro email: perfil=%s consumida=%s (esp false/false)', v_has, v_cons);
      END IF;

      -- T7 fallo interno (email NULL => business_name NULL => NOT NULL violation): el alta NO se bloquea
      v_id := '22220000-f0b0-0000-0000-000000000007';
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL, '',
              '{}'::jsonb, '{}'::jsonb, now(), now());
      SELECT count(*) INTO v_cn FROM public.customers WHERE auth_user_id = v_id;
      IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_id) OR v_cn <> 0 THEN
        v_fail := v_fail || format(E'\n - T7 fallo interno: alta existe=%s customers=%s (esp true/0)',
                                   EXISTS (SELECT 1 FROM auth.users WHERE id = v_id), v_cn);
      END IF;
    END IF;

    RAISE EXCEPTION 'f0b_sentinel' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    NULL;  -- esperado: fixtures deshechos
  END;

  IF v_fail <> '' THEN
    RAISE EXCEPTION E'0b VERIFY FAIL (comportamiento):%', v_fail;
  END IF;
END
$verify_behavior$;

COMMIT;
