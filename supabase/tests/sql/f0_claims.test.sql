-- =============================================================================
-- f0_claims.test.sql  (Strict TDD - fase RED)
-- Change: tienda-web-clientes / F0 "Claims y signup seguros"
-- Spec:   openspec/changes/tienda-web-clientes/specs/auth-claims-hardening/spec.md
--
-- ESTADO (actualizado 2026-11-27): ARCHIVO DE REFERENCIA / DOCUMENTACION de escenarios.
-- El equipo no usa el SQL editor ni hay staging: la verificacion REAL vive dentro de cada
-- migracion (bloques DO autoverificables, ver 20261127090000_* y 20261127100000_*).
-- Fallback de transicion vigente = B: app_metadata -> user_profiles (NUNCA user_metadata),
-- por eso ACH-05 espera NULL siempre y ACH-05c cubre el fallback al perfil.
--
-- COMO CORRERLO (solo si alguien quiere reproducirlo a mano):
--   1. Supabase Dashboard -> SQL Editor del proyecto de STAGING (nunca prod primero).
--   2. Pegar TODO este archivo y ejecutar (rol postgres, el default del editor).
--   3. El script SIEMPRE termina con un error controlado (RAISE EXCEPTION) para que
--      Postgres haga rollback de TODO lo que creo (fixtures incluidos). El mensaje
--      del error ES el reporte:
--          F0_CLAIMS RESULT: FAIL (n fail / N total)
--          PASS  ACH-03 ...
--          FAIL  ACH-01 ... <detalle esperado vs actual>
--      "RESULT: PASS" = todos los casos pasan. Nada queda persistido en ningun caso.
--
-- ESTADO ESPERADO:
--   * ANTES de las migraciones 0a/0b (hoy): RED. Casi todo falla. Es lo correcto.
--   * Despues de 0a + 0b: GREEN completo.
--   * c_fallback_expected quedo obsoleto (el fallback es a user_profiles, no a user_metadata).
--   * Casos marcados [NO-REGRESION] pueden pasar ya hoy: protegen que el fix no rompa nada.
--
-- CONTRATO DE ESQUEMA que este test exige a las migraciones (A1.1 / A1.2):
--   * public.staff_invitations(id, email, nonce uuid DEFAULT gen_random_uuid(), full_name,
--       roles text[], tenant_id, expires_at timestamptz, consumed_at, consumed_by)
--   * public.tenants.store_enabled boolean (indice unico parcial: max 1 tenant)
--   * public.customers.auth_user_id uuid UNIQUE, public.customers.email text
--   * triggers guard_user_profiles_privileged_cols y sync_user_claims en user_profiles
--   * get_auth_*: nunca leen user_metadata; con app_metadata vacio consultan user_profiles.
--
-- Los casos de edge functions (Invitar empleado / Cambio de rol) se cubren en la
-- tarea A2.4 con vitest (buildInvitePayload), no aqui.
-- =============================================================================

BEGIN;

-- Acumulador de resultados por GUC (los temp tables no son accesibles bajo SET ROLE).
SELECT set_config('f0.report', '', false),
       set_config('f0.fails',  '0', false),
       set_config('f0.total',  '0', false);

CREATE OR REPLACE FUNCTION pg_temp.rec(p_name text, p_ok boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('f0.total',
    (coalesce(nullif(current_setting('f0.total', true), ''), '0')::int + 1)::text, false);
  IF NOT coalesce(p_ok, false) THEN
    PERFORM set_config('f0.fails',
      (coalesce(nullif(current_setting('f0.fails', true), ''), '0')::int + 1)::text, false);
  END IF;
  PERFORM set_config('f0.report',
    coalesce(current_setting('f0.report', true), '') ||
    format(E'%s  %s  %s\n', CASE WHEN coalesce(p_ok, false) THEN 'PASS' ELSE 'FAIL' END, p_name, p_detail),
    false);
END $$;

-- Simula un JWT (solo para llamar como postgres o tras SET LOCAL ROLE authenticated).
CREATE OR REPLACE FUNCTION pg_temp.jwt(p_sub uuid, p_app jsonb, p_user jsonb, p_role text DEFAULT 'authenticated')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_sub, 'role', p_role,
                       'app_metadata', coalesce(p_app, '{}'::jsonb),
                       'user_metadata', coalesce(p_user, '{}'::jsonb))::text,
    true);
END $$;

-- Inserta un auth.users minimo (dispara on_auth_user_created, a proposito).
CREATE OR REPLACE FUNCTION pg_temp.mk_auth_user(p_id uuid, p_email text, p_app jsonb, p_user jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, '',
          coalesce(p_app, '{}'::jsonb), coalesce(p_user, '{}'::jsonb), now(), now());
END $$;

-- =============================================================================
-- BLOQUE 1: get_auth_tenant_id() / get_auth_roles() (solo claims simuladas)
-- =============================================================================
DO $$
DECLARE
  tA constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  tB constant uuid := 'bbbbbbbb-0000-0000-0000-00000000000b';
  sub constant uuid := '99999999-0000-0000-0000-000000000001';
  v_roles text[];
  v_tenant uuid;
BEGIN
  -- ACH-01 Escalada de roles via updateUser (cliente sin roles en app_metadata)
  BEGIN
    PERFORM pg_temp.jwt(sub, '{}'::jsonb, jsonb_build_object('roles', jsonb_build_array('admin')));
    v_roles := public.get_auth_roles();
    PERFORM pg_temp.rec('ACH-01 escalada de roles via user_metadata no da admin',
      NOT ('admin' = ANY(coalesce(v_roles, '{}'))),
      'esperado: sin admin; actual roles=' || coalesce(v_roles::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-01 escalada de roles via user_metadata no da admin', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-01b role (string) en user_metadata tampoco escala
  BEGIN
    PERFORM pg_temp.jwt(sub, '{}'::jsonb, jsonb_build_object('role', 'admin'));
    v_roles := public.get_auth_roles();
    PERFORM pg_temp.rec('ACH-01b user_metadata.role=admin no da admin',
      NOT ('admin' = ANY(coalesce(v_roles, '{}'))),
      'esperado: sin admin; actual roles=' || coalesce(v_roles::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-01b user_metadata.role=admin no da admin', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-02 Escalada de tenant: usuario de A hace updateUser({tenant_id: B})
  BEGIN
    PERFORM pg_temp.jwt(sub,
      jsonb_build_object('tenant_id', tA, 'roles', jsonb_build_array('vendedor')),
      jsonb_build_object('tenant_id', tB));
    v_tenant := public.get_auth_tenant_id();
    PERFORM pg_temp.rec('ACH-02 escalada de tenant via user_metadata sigue siendo A',
      v_tenant IS NOT DISTINCT FROM tA,
      format('esperado=%s actual=%s', tA, coalesce(v_tenant::text, 'NULL')));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-02 escalada de tenant via user_metadata sigue siendo A', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-03 Usuario interno legitimo (app_metadata completo)
  BEGIN
    PERFORM pg_temp.jwt(sub,
      jsonb_build_object('tenant_id', tA, 'roles', jsonb_build_array('vendedor')), '{}'::jsonb);
    v_tenant := public.get_auth_tenant_id();
    v_roles  := public.get_auth_roles();
    PERFORM pg_temp.rec('ACH-03 interno legitimo: tenant y roles desde app_metadata',
      v_tenant IS NOT DISTINCT FROM tA AND v_roles = ARRAY['vendedor']::text[],
      format('tenant=%s roles=%s', coalesce(v_tenant::text, 'NULL'), coalesce(v_roles::text, 'NULL')));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-03 interno legitimo: tenant y roles desde app_metadata', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-04 app_metadata prevalece sobre user_metadata (tenant y roles)
  BEGIN
    PERFORM pg_temp.jwt(sub,
      jsonb_build_object('tenant_id', tA, 'roles', jsonb_build_array('vendedor')),
      jsonb_build_object('tenant_id', tB, 'roles', jsonb_build_array('admin')));
    v_tenant := public.get_auth_tenant_id();
    v_roles  := public.get_auth_roles();
    PERFORM pg_temp.rec('ACH-04 app_metadata prevalece sobre user_metadata',
      v_tenant IS NOT DISTINCT FROM tA AND NOT ('admin' = ANY(coalesce(v_roles, '{}'))),
      format('tenant=%s (esperado %s) roles=%s (esperado sin admin)', coalesce(v_tenant::text, 'NULL'), tA, coalesce(v_roles::text, 'NULL')));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-04 app_metadata prevalece sobre user_metadata', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-05 user_metadata NUNCA da tenant (fallback B: el fallback es user_profiles, no user_metadata)
  BEGIN
    PERFORM pg_temp.jwt(sub, '{}'::jsonb,
      jsonb_build_object('tenant_id', tA, 'roles', jsonb_build_array('vendedor')));
    v_tenant := public.get_auth_tenant_id();
    PERFORM pg_temp.rec('ACH-05 app vacio + user_metadata.tenant (sin perfil) -> NULL',
      v_tenant IS NULL,
      format('esperado=NULL actual=%s', coalesce(v_tenant::text, 'NULL')));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-05 app vacio + user_metadata.tenant (sin perfil) -> NULL', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-05b user_metadata completa tampoco da tenant ni admin
  BEGIN
    PERFORM pg_temp.jwt(sub, '{}'::jsonb,
      jsonb_build_object('tenant_id', tA, 'roles', jsonb_build_array('admin')));
    v_tenant := public.get_auth_tenant_id();
    v_roles  := public.get_auth_roles();
    PERFORM pg_temp.rec('ACH-05b user_metadata completa no da tenant ni admin',
      v_tenant IS NULL AND NOT ('admin' = ANY(coalesce(v_roles, '{}'))),
      format('tenant=%s roles=%s', coalesce(v_tenant::text, 'NULL'), coalesce(v_roles::text, 'NULL')));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-05b user_metadata completa no da tenant ni admin', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-06 Usuario de tienda sin claims: tenant NULL y roles vacio (sin default 'vendedor', hallazgo H1)
  BEGIN
    PERFORM pg_temp.jwt(sub, '{}'::jsonb, '{}'::jsonb);
    v_tenant := public.get_auth_tenant_id();
    v_roles  := public.get_auth_roles();
    PERFORM pg_temp.rec('ACH-06 cliente sin claims: tenant NULL y roles vacios',
      v_tenant IS NULL AND coalesce(cardinality(v_roles), 0) = 0,
      format('tenant=%s roles=%s (esperado NULL y {})', coalesce(v_tenant::text, 'NULL'), coalesce(v_roles::text, 'NULL')));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-06 cliente sin claims: tenant NULL y roles vacios', false, 'ERROR: ' || SQLERRM);
  END;

  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- =============================================================================
-- BLOQUE 2: fixtures + policy de user_profiles + guard + sync + backfill
-- =============================================================================
DO $$
DECLARE
  tA constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  tB constant uuid := 'bbbbbbbb-0000-0000-0000-00000000000b';
  uInt constant uuid := '11111111-0000-0000-0000-000000000001';  -- interno tenant A
  uOth constant uuid := '11111111-0000-0000-0000-000000000002';  -- interno tenant B
  uSpy constant uuid := '99999999-0000-0000-0000-000000000002';  -- sin fila en user_profiles
  n int;
  v_role text[];
  v_tenant uuid;
  v_name text;
  v_raised boolean;
  v_app jsonb;
  v_rows int;
  v_bad int;
  v_total int;
  v_list text;
BEGIN
  -- Fixtures (rollback al final)
  BEGIN
    INSERT INTO public.tenants (id, name) VALUES (tA, 'F0 TEST tenant A'), (tB, 'F0 TEST tenant B');
    PERFORM pg_temp.mk_auth_user(uInt, 'f0-int@test.invalid', '{}'::jsonb, '{}'::jsonb);
    PERFORM pg_temp.mk_auth_user(uOth, 'f0-oth@test.invalid', '{}'::jsonb, '{}'::jsonb);
    -- El trigger actual puede haber creado el perfil (tenant NULL): upsert al estado deseado.
    INSERT INTO public.user_profiles (id, tenant_id, role, full_name, email, is_active, status)
    VALUES (uInt, tA, ARRAY['vendedor'], 'F0 Interno A', 'f0-int@test.invalid', true, 'ACTIVE'),
           (uOth, tB, ARRAY['vendedor'], 'F0 Interno B', 'f0-oth@test.invalid', true, 'ACTIVE')
    ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, role = EXCLUDED.role,
                                   full_name = EXCLUDED.full_name, email = EXCLUDED.email;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('SETUP fixtures bloque 2', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-07 La policy de user_profiles NO usa user_metadata (H2).
  -- JWT: app_metadata tenant B, user_metadata tenant A. No debe ver filas de A.
  BEGIN
    PERFORM pg_temp.jwt(uSpy, jsonb_build_object('tenant_id', tB), jsonb_build_object('tenant_id', tA));
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.user_profiles WHERE tenant_id = tA;
    RESET ROLE;
    PERFORM pg_temp.rec('ACH-07 policy user_profiles ignora user_metadata.tenant_id',
      n = 0, format('filas de tenant A visibles con app=B/user=A: %s (esperado 0)', n));
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM pg_temp.rec('ACH-07 policy user_profiles ignora user_metadata.tenant_id', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-07b Interno legitimo de A ve a su equipo (no sobre-bloquear) [NO-REGRESION post-0a]
  BEGIN
    PERFORM pg_temp.jwt(uInt, jsonb_build_object('tenant_id', tA, 'roles', jsonb_build_array('vendedor')), '{}'::jsonb);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.user_profiles WHERE id = uInt;
    RESET ROLE;
    PERFORM pg_temp.rec('ACH-07b [NO-REGRESION] interno ve su propia fila de user_profiles',
      n = 1, format('filas propias visibles: %s (esperado 1)', n));
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM pg_temp.rec('ACH-07b [NO-REGRESION] interno ve su propia fila de user_profiles', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-08 Cliente de tienda sin claims no accede a tablas admin
  BEGIN
    PERFORM pg_temp.jwt(uSpy, '{}'::jsonb, '{}'::jsonb);
    SET LOCAL ROLE authenticated;
    SELECT (SELECT count(*) FROM public.orders)
         + (SELECT count(*) FROM public.customers)
         + (SELECT count(*) FROM public.products)
         + (SELECT count(*) FROM public.user_profiles) INTO n;
    RESET ROLE;
    PERFORM pg_temp.rec('ACH-08 [NO-REGRESION] cliente sin claims ve 0 filas en orders/customers/products/user_profiles',
      n = 0, format('filas visibles: %s (esperado 0)', n));
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM pg_temp.rec('ACH-08 [NO-REGRESION] cliente sin claims ve 0 filas en orders/customers/products/user_profiles', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-09 Guard: un usuario NO puede cambiarse su propio role (H3)
  BEGIN
    PERFORM pg_temp.jwt(uInt, jsonb_build_object('tenant_id', tA, 'roles', jsonb_build_array('vendedor')), '{}'::jsonb);
    SET LOCAL ROLE authenticated;
    v_raised := false;
    BEGIN
      UPDATE public.user_profiles SET role = ARRAY['admin'] WHERE id = uInt;
    EXCEPTION WHEN OTHERS THEN
      v_raised := true;
    END;
    RESET ROLE;
    SELECT role INTO v_role FROM public.user_profiles WHERE id = uInt;
    PERFORM pg_temp.rec('ACH-09 guard: autoescalada de role bloqueada',
      v_raised OR NOT ('admin' = ANY(v_role)),
      format('raised=%s role_final=%s (esperado: error o role sin admin)', v_raised, v_role));
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM pg_temp.rec('ACH-09 guard: autoescalada de role bloqueada', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-10 Guard: un usuario NO puede cambiarse su propio tenant_id
  BEGIN
    PERFORM pg_temp.jwt(uInt, jsonb_build_object('tenant_id', tA, 'roles', jsonb_build_array('vendedor')), '{}'::jsonb);
    SET LOCAL ROLE authenticated;
    v_raised := false;
    BEGIN
      UPDATE public.user_profiles SET tenant_id = tB WHERE id = uInt;
    EXCEPTION WHEN OTHERS THEN
      v_raised := true;
    END;
    RESET ROLE;
    SELECT tenant_id INTO v_tenant FROM public.user_profiles WHERE id = uInt;
    PERFORM pg_temp.rec('ACH-10 guard: cambio propio de tenant_id bloqueado',
      v_raised OR v_tenant = tA,
      format('raised=%s tenant_final=%s (esperado: error o %s)', v_raised, v_tenant, tA));
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM pg_temp.rec('ACH-10 guard: cambio propio de tenant_id bloqueado', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-11 Guard no sobre-bloquea: editar full_name propio sigue permitido [NO-REGRESION]
  BEGIN
    PERFORM pg_temp.jwt(uInt, jsonb_build_object('tenant_id', tA, 'roles', jsonb_build_array('vendedor')), '{}'::jsonb);
    SET LOCAL ROLE authenticated;
    UPDATE public.user_profiles SET full_name = 'F0 Nombre Nuevo' WHERE id = uInt;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    SELECT full_name INTO v_name FROM public.user_profiles WHERE id = uInt;
    PERFORM pg_temp.rec('ACH-11 [NO-REGRESION] guard permite editar columnas no privilegiadas',
      v_rows = 1 AND v_name = 'F0 Nombre Nuevo', format('filas=%s full_name=%s', v_rows, v_name));
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM pg_temp.rec('ACH-11 [NO-REGRESION] guard permite editar columnas no privilegiadas', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-12 service_role (edge functions) SI puede cambiar role
  BEGIN
    PERFORM pg_temp.jwt(NULL, '{}'::jsonb, '{}'::jsonb, 'service_role');
    UPDATE public.user_profiles SET role = ARRAY['supervisor'] WHERE id = uInt;
    SELECT role INTO v_role FROM public.user_profiles WHERE id = uInt;
    PERFORM pg_temp.rec('ACH-12 guard: service_role puede cambiar role',
      v_role = ARRAY['supervisor']::text[], format('role_final=%s (esperado {supervisor})', v_role));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-12 guard: service_role puede cambiar role', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-13 sync_user_claims: el cambio de role de ACH-12 llega a app_metadata
  BEGIN
    SELECT raw_app_meta_data INTO v_app FROM auth.users WHERE id = uInt;
    PERFORM pg_temp.rec('ACH-13 sync: UPDATE de role se refleja en app_metadata.roles',
      v_app->'roles' = '["supervisor"]'::jsonb AND (v_app->>'tenant_id') = tA::text,
      'raw_app_meta_data=' || coalesce(v_app::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-13 sync: UPDATE de role se refleja en app_metadata.roles', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-14 sync_user_claims en INSERT: el perfil de tenant B (upsert del fixture) quedo sincronizado
  BEGIN
    SELECT raw_app_meta_data INTO v_app FROM auth.users WHERE id = uOth;
    PERFORM pg_temp.rec('ACH-14 sync: INSERT de perfil escribe tenant_id y roles en app_metadata',
      (v_app->>'tenant_id') = tB::text AND v_app->'roles' = '["vendedor"]'::jsonb,
      'raw_app_meta_data=' || coalesce(v_app::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-14 sync: INSERT de perfil escribe tenant_id y roles en app_metadata', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-05c Fallback B: token sin app_metadata + metadata hostil -> tenant/roles del PERFIL
  BEGIN
    PERFORM pg_temp.jwt(uInt, '{}'::jsonb,
      jsonb_build_object('tenant_id', tB, 'roles', jsonb_build_array('admin')));
    v_tenant := public.get_auth_tenant_id();
    SELECT role INTO v_role FROM public.user_profiles WHERE id = uInt;
    PERFORM pg_temp.rec('ACH-05c fallback a user_profiles ignora user_metadata hostil',
      v_tenant IS NOT DISTINCT FROM tA AND NOT ('admin' = ANY(coalesce(public.get_auth_roles(), '{}'))),
      format('tenant=%s (esp %s) roles=%s', coalesce(v_tenant::text, 'NULL'), tA, coalesce(public.get_auth_roles()::text, 'NULL')));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-05c fallback a user_profiles ignora user_metadata hostil', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-15 Backfill: TODO perfil con tenant tiene app_metadata consistente (datos reales)
  BEGIN
    SELECT count(*) FILTER (WHERE (u.raw_app_meta_data->>'tenant_id') IS DISTINCT FROM p.tenant_id::text),
           count(*),
           string_agg(p.id::text, ',') FILTER (WHERE (u.raw_app_meta_data->>'tenant_id') IS DISTINCT FROM p.tenant_id::text)
      INTO v_bad, v_total, v_list
      FROM public.user_profiles p JOIN auth.users u ON u.id = p.id
     WHERE p.tenant_id IS NOT NULL;
    PERFORM pg_temp.rec('ACH-15 backfill: perfiles con tenant sin app_metadata.tenant_id = 0',
      v_bad = 0, format('inconsistentes=%s de %s perfiles; ids(max 400 chars)=%s', v_bad, v_total, left(coalesce(v_list, '-'), 400)));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-15 backfill: perfiles con tenant sin app_metadata.tenant_id = 0', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-16 Ninguna policy ni funcion (salvo get_auth_*) lee user_metadata (verificacion 0a, punto 7)
  BEGIN
    SELECT count(*), string_agg(x.obj, '; ')
      INTO n, v_list
      FROM (
        SELECT 'policy ' || schemaname || '.' || tablename || '.' || policyname AS obj
          FROM pg_policies
         WHERE coalesce(qual, '') ILIKE '%user_metadata%' OR coalesce(with_check, '') ILIKE '%user_metadata%'
        UNION ALL
        SELECT 'fn ' || n2.nspname || '.' || p.proname
          FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
         WHERE n2.nspname = 'public' AND p.prosrc ILIKE '%user_metadata%'
           AND p.proname NOT IN ('get_auth_tenant_id', 'get_auth_roles')
      ) x;
    PERFORM pg_temp.rec('ACH-16 sin policies/funciones que lean user_metadata (excepto get_auth_*)',
      n = 0, format('violaciones=%s: %s', n, left(coalesce(v_list, '-'), 600)));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-16 sin policies/funciones que lean user_metadata (excepto get_auth_*)', false, 'ERROR: ' || SQLERRM);
  END;

  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- =============================================================================
-- BLOQUE 3: handle_new_user ramificado (invitacion vs tienda, metadata maliciosa, fallo)
-- =============================================================================
DO $$
DECLARE
  tA constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';  -- tenant del invitador
  tB constant uuid := 'bbbbbbbb-0000-0000-0000-00000000000b';  -- tenant "ajeno" (metadata maliciosa)
  tS constant uuid := 'cccccccc-0000-0000-0000-00000000000c';  -- unico tenant con tienda
  v_id uuid;
  v_nonce text;
  v_pt uuid;
  v_pr text[];
  v_has_profile boolean;
  v_cust_tenant uuid;
  v_cust_count int;
  v_consumed boolean;
  v_app jsonb;
  v_store_ready boolean := false;
BEGIN
  -- Setup: tenants + tienda habilitada en tS (y ningun otro, por el indice unico parcial)
  BEGIN
    INSERT INTO public.tenants (id, name) VALUES (tA, 'F0 TEST tenant A') ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.tenants (id, name) VALUES (tB, 'F0 TEST tenant B') ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.tenants (id, name) VALUES (tS, 'F0 TEST tienda');
    UPDATE public.tenants SET store_enabled = false WHERE store_enabled;
    UPDATE public.tenants SET store_enabled = true  WHERE id = tS;
    v_store_ready := true;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('SETUP tenants.store_enabled (migracion 0b)', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-17 Invitacion valida -> user_profiles con datos de la INVITACION (nunca de la metadata)
  BEGIN
    v_id := '22222222-0000-0000-0000-000000000001';
    INSERT INTO public.staff_invitations (email, full_name, roles, tenant_id, expires_at)
    VALUES ('f0-invite@test.invalid', 'Invitado F0', ARRAY['vendedor'], tA, now() + interval '1 hour')
    RETURNING nonce::text INTO v_nonce;

    PERFORM pg_temp.mk_auth_user(v_id, 'f0-invite@test.invalid', '{}'::jsonb,
      jsonb_build_object('invitation_nonce', v_nonce, 'full_name', 'Invitado F0',
                         'roles', jsonb_build_array('admin'), 'tenant_id', tB));  -- metadata hostil adicional

    SELECT tenant_id, role INTO v_pt, v_pr FROM public.user_profiles WHERE id = v_id;
    SELECT (consumed_at IS NOT NULL) INTO v_consumed FROM public.staff_invitations WHERE nonce::text = v_nonce;
    SELECT count(*) INTO v_cust_count FROM public.customers WHERE auth_user_id = v_id;
    PERFORM pg_temp.rec('ACH-17 invitacion valida crea user_profiles con tenant/rol de la invitacion',
      v_pt = tA AND v_pr = ARRAY['vendedor']::text[] AND coalesce(v_consumed, false) AND v_cust_count = 0,
      format('tenant=%s (esp %s) role=%s (esp {vendedor}) consumida=%s customers=%s (esp 0)', v_pt, tA, v_pr, v_consumed, v_cust_count));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-17 invitacion valida crea user_profiles con tenant/rol de la invitacion', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-18 Nonce incorrecto -> NO es interno: rama tienda (sin user_profiles)
  BEGIN
    v_id := '22222222-0000-0000-0000-000000000002';
    INSERT INTO public.staff_invitations (email, full_name, roles, tenant_id, expires_at)
    VALUES ('f0-badnonce@test.invalid', 'Nonce Malo', ARRAY['admin'], tA, now() + interval '1 hour');

    PERFORM pg_temp.mk_auth_user(v_id, 'f0-badnonce@test.invalid', '{}'::jsonb,
      jsonb_build_object('invitation_nonce', gen_random_uuid()::text, 'full_name', 'Nonce Malo'));

    SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_id) INTO v_has_profile;
    SELECT tenant_id INTO v_cust_tenant FROM public.customers WHERE auth_user_id = v_id;
    PERFORM pg_temp.rec('ACH-18 nonce incorrecto: sin user_profiles, customers en tenant de tienda',
      NOT v_has_profile AND v_cust_tenant = tS,
      format('perfil=%s customers.tenant=%s (esp %s)', v_has_profile, v_cust_tenant, tS));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-18 nonce incorrecto: sin user_profiles, customers en tenant de tienda', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-19 Signup malicioso con metadata roles/tenant_id (sin invitacion)
  BEGIN
    v_id := '22222222-0000-0000-0000-000000000003';
    PERFORM pg_temp.mk_auth_user(v_id, 'f0-evil@test.invalid', '{}'::jsonb,
      jsonb_build_object('roles', jsonb_build_array('admin'), 'tenant_id', tB, 'role', 'admin', 'full_name', 'Evil'));

    SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_id) INTO v_has_profile;
    SELECT tenant_id INTO v_cust_tenant FROM public.customers WHERE auth_user_id = v_id;
    SELECT raw_app_meta_data INTO v_app FROM auth.users WHERE id = v_id;
    PERFORM pg_temp.rec('ACH-19 signup malicioso: sin roles/tenant, customers usa tenant resuelto en servidor',
      NOT v_has_profile AND v_cust_tenant = tS
        AND NOT (v_app ? 'roles') AND (v_app->>'tenant_id') IS DISTINCT FROM tB::text,
      format('perfil=%s customers.tenant=%s (esp %s) app_metadata=%s', v_has_profile, v_cust_tenant, tS, v_app));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-19 signup malicioso: sin roles/tenant, customers usa tenant resuelto en servidor', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-20 Signup de tienda normal: customers vinculado (auth_user_id, email), sin user_profiles
  BEGIN
    v_id := '22222222-0000-0000-0000-000000000004';
    PERFORM pg_temp.mk_auth_user(v_id, 'f0-shop@test.invalid', '{}'::jsonb,
      jsonb_build_object('full_name', 'Cliente Tienda', 'phone', '70000000'));

    SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_id) INTO v_has_profile;
    SELECT count(*), min(tenant_id::text)::uuid INTO v_cust_count, v_cust_tenant
      FROM public.customers WHERE auth_user_id = v_id AND email = 'f0-shop@test.invalid';
    PERFORM pg_temp.rec('ACH-20 signup de tienda: customers(auth_user_id,email) y sin user_profiles',
      NOT v_has_profile AND v_cust_count = 1 AND v_cust_tenant = tS,
      format('perfil=%s customers=%s (esp 1) tenant=%s (esp %s)', v_has_profile, v_cust_count, v_cust_tenant, tS));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-20 signup de tienda: customers(auth_user_id,email) y sin user_profiles', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-21 Invitacion expirada -> rama tienda
  BEGIN
    v_id := '22222222-0000-0000-0000-000000000005';
    INSERT INTO public.staff_invitations (email, full_name, roles, tenant_id, expires_at)
    VALUES ('f0-expired@test.invalid', 'Expirada', ARRAY['admin'], tA, now() - interval '1 minute')
    RETURNING nonce::text INTO v_nonce;

    PERFORM pg_temp.mk_auth_user(v_id, 'f0-expired@test.invalid', '{}'::jsonb,
      jsonb_build_object('invitation_nonce', v_nonce));

    SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_id) INTO v_has_profile;
    PERFORM pg_temp.rec('ACH-21 invitacion expirada no crea user_profiles',
      NOT v_has_profile, format('perfil=%s (esperado false)', v_has_profile));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-21 invitacion expirada no crea user_profiles', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-22 Nonce valido pero email distinto -> rama tienda (el nonce no es transferible)
  BEGIN
    v_id := '22222222-0000-0000-0000-000000000006';
    INSERT INTO public.staff_invitations (email, full_name, roles, tenant_id, expires_at)
    VALUES ('f0-owner@test.invalid', 'Dueno', ARRAY['admin'], tA, now() + interval '1 hour')
    RETURNING nonce::text INTO v_nonce;

    PERFORM pg_temp.mk_auth_user(v_id, 'f0-thief@test.invalid', '{}'::jsonb,
      jsonb_build_object('invitation_nonce', v_nonce));

    SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_id) INTO v_has_profile;
    SELECT (consumed_at IS NOT NULL) INTO v_consumed FROM public.staff_invitations WHERE nonce::text = v_nonce;
    PERFORM pg_temp.rec('ACH-22 nonce con email distinto no crea perfil ni consume la invitacion',
      NOT v_has_profile AND NOT coalesce(v_consumed, true),
      format('perfil=%s consumida=%s (esperado false/false)', v_has_profile, v_consumed));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-22 nonce con email distinto no crea perfil ni consume la invitacion', false, 'ERROR: ' || SQLERRM);
  END;

  -- ACH-23 Fallo interno del trigger NO bloquea el alta (bloque EXCEPTION)
  -- Se fuerza el fallo con un CHECK temporal (DDL transaccional, rollback al final).
  BEGIN
    v_id := '22222222-0000-0000-0000-000000000007';
    ALTER TABLE public.customers ADD CONSTRAINT zz_f0_force_fail CHECK (business_name <> 'F0_FORCE_FAIL');
    PERFORM pg_temp.mk_auth_user(v_id, 'f0-fail@test.invalid', '{}'::jsonb,
      jsonb_build_object('full_name', 'F0_FORCE_FAIL'));
    SELECT count(*) INTO v_cust_count FROM public.customers WHERE auth_user_id = v_id;
    PERFORM pg_temp.rec('ACH-23 fallo del insert en customers no bloquea el alta en auth.users',
      EXISTS (SELECT 1 FROM auth.users WHERE id = v_id) AND v_cust_count = 0,
      format('auth.users existe=%s customers=%s (esp true/0)', EXISTS (SELECT 1 FROM auth.users WHERE id = v_id), v_cust_count));
    ALTER TABLE public.customers DROP CONSTRAINT zz_f0_force_fail;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.rec('ACH-23 fallo del insert en customers no bloquea el alta en auth.users', false, 'ERROR: ' || SQLERRM);
  END;

  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- =============================================================================
-- REPORTE FINAL: siempre RAISE EXCEPTION => rollback total de fixtures.
-- =============================================================================
DO $$
DECLARE
  v_fails int := coalesce(nullif(current_setting('f0.fails', true), ''), '0')::int;
  v_total int := coalesce(nullif(current_setting('f0.total', true), ''), '0')::int;
BEGIN
  RAISE EXCEPTION E'F0_CLAIMS RESULT: % (% fail / % total)\n%',
    CASE WHEN v_fails = 0 THEN 'PASS' ELSE 'FAIL' END, v_fails, v_total,
    coalesce(current_setting('f0.report', true), '');
END $$;

ROLLBACK;

-- =============================================================================
-- A2 (0c) - Escenarios de blindaje de RPCs SECURITY DEFINER  (ACH-24 .. ACH-31)
-- Implementados como autoverificacion DENTRO de supabase/migrations/20261129090000_blindar_rpcs_definer.sql
-- (casos con sujeto real/JWT simulados) y, los que requieren DOS tenants con datos, en
-- supabase/tests/sql/f0_rpc_hardening.test.sql (H1..H12, prueba local en Postgres desechable).
--   ACH-24 cliente de tienda (authenticated sin perfil, claims/metadata hostiles) NO ejecuta
--          assert_internal_user-protegidas: create_direct_order_atomic, confirm_order_atomic,
--          get_report_*, get_dashboard_metrics, get_sales_trend, sync_inventory_catalog, next_order_number
--   ACH-25 admin con p_tenant_id ajeno => c0_guard (no filtra datos ni crea pedidos)
--   ACH-26 rol sin permiso (pedidos.create / reportes.view / inventario.edit) => c0_guard
--   ACH-27 confirm_order_atomic sobre borrador de otro tenant => indistinguible de inexistente
--   ACH-28 fn_crear_notificacion / fn_notificar_preparador_y_admins_planilla / seed_default_permissions:
--          sin EXECUTE para authenticated/anon; el camino legitimo (funciones DEFINER) sigue funcionando
--   ACH-29 fn_notificar_aprobadores_planilla: solo notifica dentro del tenant de la sesion
--   ACH-30 log_tech_error / increment_error_metrics ignoran el tenant del parametro
--   ACH-31 anon no ejecuta ninguna RPC blindada (salvo log_tech_error)
-- =============================================================================
