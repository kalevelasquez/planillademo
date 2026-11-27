-- =============================================================================
-- F0 / 0d - Retirar el fallback a user_profiles (change: tienda-web-clientes)
--
-- GATE DE F2: a partir de aqui las claims de autorizacion (tenant y roles) salen
-- UNICAMENTE de auth.jwt()->'app_metadata'. get_auth_tenant_id()/get_auth_roles() ya
-- no consultan public.user_profiles. Nunca leen user_metadata.
--
-- POR QUE ES SEGURO (y por que aborta si no lo es):
--   1. Re-ejecuta el backfill de 0a de forma idempotente (user_profiles -> app_metadata).
--   2. ANTES de tocar las funciones comprueba que TODO usuario interno activo
--      (user_profiles con tenant_id y is_active) tiene app_metadata.tenant_id y
--      app_metadata.roles identicos al perfil. Si hay ALGUNO distinto => RAISE EXCEPTION
--      con la cuenta y los ids, y se revierte TODO: nadie queda sin acceso.
--   3. Despues de reescribir las funciones simula el JWT REAL de cada usuario interno
--      activo (su propio app_metadata) y comprueba que get_auth_* devuelven el tenant y
--      los roles de su perfil (prueba anti-lockout), y que un JWT SIN claims ya no
--      obtiene tenant ni roles aunque exista su perfil.
--
-- EFECTO VISIBLE: los access tokens emitidos ANTES del backfill de 0a (sin app_metadata)
-- dejan de tener tenant hasta refrescarse (vida del access token <= 1 h por defecto) o
-- hasta un nuevo login. Los tokens emitidos despues de 0a ya traen app_metadata.
--
-- NO habilita el signup ni tenants.store_enabled (eso es manual, despues del deploy).
-- Rollback: supabase/rollback/20261130090000_retirar_fallback_user_profiles.down.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Backfill idempotente (mismo criterio que 0a): perfiles -> app_metadata
-- -----------------------------------------------------------------------------
UPDATE auth.users u
   SET raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object(
                                'tenant_id', p.tenant_id,
                                'roles', to_jsonb(coalesce(p.role, '{}'::text[])))
  FROM public.user_profiles p
 WHERE p.id = u.id
   AND p.tenant_id IS NOT NULL
   AND ( (u.raw_app_meta_data ->> 'tenant_id') IS DISTINCT FROM p.tenant_id::text
      OR (u.raw_app_meta_data -> 'roles')      IS DISTINCT FROM to_jsonb(coalesce(p.role, '{}'::text[])) );

-- -----------------------------------------------------------------------------
-- 2. GATE DE SEGURIDAD: ningun usuario interno activo sin claims coherentes.
--    Se ejecuta ANTES de reescribir las funciones. Si falla, aborta todo.
-- -----------------------------------------------------------------------------
DO $gate$
DECLARE
  n       int;
  v_list  text;
BEGIN
  SELECT count(*), string_agg(p.id::text, ',' ORDER BY p.id) INTO n, v_list
    FROM public.user_profiles p
    LEFT JOIN auth.users u ON u.id = p.id
   WHERE p.tenant_id IS NOT NULL
     AND coalesce(p.is_active, true)
     AND ( u.id IS NULL
        OR (u.raw_app_meta_data ->> 'tenant_id') IS DISTINCT FROM p.tenant_id::text
        OR (u.raw_app_meta_data -> 'roles')      IS DISTINCT FROM to_jsonb(coalesce(p.role, '{}'::text[])) );
  IF n > 0 THEN
    RAISE EXCEPTION '0d GATE FAIL: % usuario(s) interno(s) activo(s) sin app_metadata coherente con user_profiles (tenant_id/roles); se aborta para no dejarlos sin acceso. Ids: %',
      n, left(v_list, 600);
  END IF;
END
$gate$;

-- -----------------------------------------------------------------------------
-- 3. get_auth_tenant_id() / get_auth_roles(): SOLO app_metadata del JWT.
--    Mantienen SECURITY DEFINER + STABLE + search_path fijo (atributos y ACL de 0a).
--    OJO: no deben nombrar la metadata editable por el usuario ni user_profiles.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim text;
BEGIN
  v_claim := auth.jwt() -> 'app_metadata' ->> 'tenant_id';
  IF v_claim IS NULL OR v_claim = '' THEN
    RETURN NULL;   -- sin claim => sin tenant (p. ej. cliente de tienda)
  END IF;
  BEGIN
    RETURN v_claim::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;   -- claim corrupta => sin tenant (nunca un error ni un tenant adivinado)
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_roles()
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_app   jsonb;
  v_roles text[];
BEGIN
  v_app := auth.jwt() -> 'app_metadata';

  IF jsonb_typeof(v_app -> 'roles') = 'array' THEN
    SELECT coalesce(array_agg(DISTINCT x), '{}'::text[]) INTO v_roles
      FROM jsonb_array_elements_text(v_app -> 'roles') AS x;
  ELSIF jsonb_typeof(v_app -> 'role') = 'array' THEN
    SELECT coalesce(array_agg(DISTINCT x), '{}'::text[]) INTO v_roles
      FROM jsonb_array_elements_text(v_app -> 'role') AS x;
  ELSIF jsonb_typeof(v_app -> 'role') = 'string' THEN
    v_roles := ARRAY[v_app ->> 'role'];
  END IF;

  -- Sin default 'vendedor' (H1): sin rol en el JWT => ningun rol
  RETURN coalesce(v_roles, '{}'::text[]);
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. AUTOVERIFICACION A: catalogo
-- -----------------------------------------------------------------------------
DO $verify_catalog$
DECLARE
  v_def text;
  n     int;
BEGIN
  FOR v_def IN SELECT unnest(ARRAY['get_auth_tenant_id', 'get_auth_roles']) LOOP
    -- DEFINER, STABLE, search_path fijo, sin user_metadata y SIN fallback a user_profiles
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'public' AND p.proname = v_def
         AND p.prosecdef
         AND p.provolatile = 's'
         AND coalesce(p.proconfig::text, '') ILIKE '%search_path%'
         AND p.prosrc NOT ILIKE '%user_metadata%'
         AND p.prosrc NOT ILIKE '%user_profiles%'
         AND p.prosrc ILIKE '%app_metadata%'
    ) THEN
      RAISE EXCEPTION '0d VERIFY FAIL: % debe ser SECURITY DEFINER STABLE con search_path fijo, leer solo app_metadata y no consultar user_profiles ni user_metadata', v_def;
    END IF;
    -- una sola version (sin sobrecargas)
    SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = v_def;
    IF n <> 1 THEN
      RAISE EXCEPTION '0d VERIFY FAIL: % tiene % versiones (esperado 1)', v_def, n;
    END IF;
    -- el ACL no cambia: anon/authenticated pueden ejecutarlas (las usan policies y has_permission)
    IF NOT has_function_privilege('authenticated', format('public.%I()', v_def), 'EXECUTE') THEN
      RAISE EXCEPTION '0d VERIFY FAIL: authenticated perdio EXECUTE sobre %', v_def;
    END IF;
  END LOOP;

  -- Ninguna policy ni funcion de public lee la metadata editable (spec: verificacion punto 7)
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM pg_policies
     WHERE coalesce(qual, '') ILIKE '%user_metadata%' OR coalesce(with_check, '') ILIKE '%user_metadata%'
    UNION ALL
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prosrc ILIKE '%user_metadata%'
  ) x;
  IF n > 0 THEN
    RAISE EXCEPTION '0d VERIFY FAIL: quedan % objetos que leen user_metadata', n;
  END IF;

  -- Triggers de 0a intactos (guard + sync siguen publicando cambios de rol/tenant en app_metadata)
  FOR v_def IN SELECT unnest(ARRAY['guard_user_profiles_privileged_cols', 'sync_user_claims']) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid = 'public.user_profiles'::regclass AND t.tgname = v_def
         AND NOT t.tgisinternal AND t.tgenabled = 'O'
    ) THEN
      RAISE EXCEPTION '0d VERIFY FAIL: trigger % ausente o deshabilitado en user_profiles', v_def;
    END IF;
  END LOOP;
END
$verify_catalog$;

-- -----------------------------------------------------------------------------
-- 5. AUTOVERIFICACION B: comportamiento (JWT simulados; sub-bloque con centinela ZZ001
--    que deshace GUCs y SET ROLE; no se escribe ningun dato).
-- -----------------------------------------------------------------------------
DO $verify_behavior$
DECLARE
  v_fail    text := '';
  v_rand    uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_sub     uuid;
  v_ptenant uuid;
  v_prole   text[];
  v_tenant  uuid;
  v_roles   text[];
  v_n       bigint;
  v_checked int := 0;
  r         record;
  c_hostile CONSTANT jsonb := '{"tenant_id": "dddddddd-0000-0000-0000-00000000000d", "roles": ["admin"], "role": "admin"}'::jsonb;
BEGIN
  BEGIN  -- sub-bloque revertible

    -- B1 anti-lockout: el JWT REAL de cada usuario interno activo resuelve su tenant y roles
    FOR r IN
      SELECT p.id, p.tenant_id, p.role, u.raw_app_meta_data AS app
        FROM public.user_profiles p JOIN auth.users u ON u.id = p.id
       WHERE p.tenant_id IS NOT NULL AND coalesce(p.is_active, true)
    LOOP
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', r.id, 'role', 'authenticated',
        'app_metadata', r.app, 'user_metadata', '{}'::jsonb)::text, true);
      v_tenant := public.get_auth_tenant_id();  v_roles := public.get_auth_roles();
      v_checked := v_checked + 1;
      IF v_tenant IS DISTINCT FROM r.tenant_id
         OR NOT (v_roles @> r.role AND v_roles <@ r.role) THEN
        v_fail := v_fail || format(E'\n - B1 usuario %s: tenant=%s (esp %s) roles=%s (esp %s)', r.id, v_tenant, r.tenant_id, v_roles, r.role);
      END IF;
    END LOOP;

    -- Sujeto para las pruebas negativas: un perfil real con tenant (preferimos admin)
    SELECT p.id, p.tenant_id, p.role INTO v_sub, v_ptenant, v_prole
      FROM public.user_profiles p JOIN auth.users u ON u.id = p.id
     WHERE p.tenant_id IS NOT NULL
     ORDER BY (('admin' = ANY (p.role))) DESC, p.created_at NULLS LAST
     LIMIT 1;
    IF v_sub IS NULL THEN
      v_sub := v_rand;   -- BD sin perfiles: las pruebas negativas siguen siendo validas
    END IF;

    -- B2 fallback retirado: JWT sin claims de un usuario CON perfil => tenant NULL, roles {}
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_sub, 'role', 'authenticated',
      'app_metadata', '{}'::jsonb, 'user_metadata', '{}'::jsonb)::text, true);
    v_tenant := public.get_auth_tenant_id();  v_roles := public.get_auth_roles();
    IF v_tenant IS NOT NULL OR cardinality(v_roles) <> 0 THEN
      v_fail := v_fail || format(E'\n - B2 sin claims pero con perfil: tenant=%s roles=%s (esperado NULL y {}: el fallback sigue vivo)', v_tenant, v_roles);
    END IF;

    -- B3 metadata editable hostil sin app_metadata: ni tenant ni admin
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_sub, 'role', 'authenticated',
      'app_metadata', '{}'::jsonb, 'user_metadata', c_hostile)::text, true);
    v_tenant := public.get_auth_tenant_id();  v_roles := public.get_auth_roles();
    IF v_tenant IS NOT NULL OR 'admin' = ANY (v_roles) THEN
      v_fail := v_fail || format(E'\n - B3 metadata hostil: tenant=%s roles=%s (esperado NULL y sin admin)', v_tenant, v_roles);
    END IF;

    -- B4 app_metadata prevalece sobre la metadata hostil
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_sub, 'role', 'authenticated',
      'app_metadata', jsonb_build_object('tenant_id', v_other, 'roles', jsonb_build_array('vendedor')),
      'user_metadata', c_hostile)::text, true);
    v_tenant := public.get_auth_tenant_id();  v_roles := public.get_auth_roles();
    IF v_tenant IS DISTINCT FROM v_other OR v_roles IS DISTINCT FROM ARRAY['vendedor']::text[] THEN
      v_fail := v_fail || format(E'\n - B4 app_metadata prevalece: tenant=%s (esp %s) roles=%s (esp {vendedor})', v_tenant, v_other, v_roles);
    END IF;

    -- B5 claim de tenant corrupta: NULL sin error y sin caer al perfil
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_sub, 'role', 'authenticated',
      'app_metadata', jsonb_build_object('tenant_id', 'no-es-un-uuid'))::text, true);
    v_tenant := public.get_auth_tenant_id();
    IF v_tenant IS NOT NULL THEN
      v_fail := v_fail || format(E'\n - B5 claim corrupta: tenant=%s (esperado NULL)', v_tenant);
    END IF;

    -- B6 formas legadas de roles ('role' texto y 'role' arreglo)
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_sub, 'role', 'authenticated',
      'app_metadata', jsonb_build_object('role', 'supervisor'))::text, true);
    v_roles := public.get_auth_roles();
    IF v_roles IS DISTINCT FROM ARRAY['supervisor']::text[] THEN
      v_fail := v_fail || format(E'\n - B6a role texto: %s (esp {supervisor})', v_roles);
    END IF;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_sub, 'role', 'authenticated',
      'app_metadata', jsonb_build_object('role', jsonb_build_array('a', 'a', 'b')))::text, true);
    v_roles := public.get_auth_roles();
    IF v_roles IS DISTINCT FROM ARRAY['a', 'b']::text[] THEN
      v_fail := v_fail || format(E'\n - B6b role arreglo: %s (esp {a,b})', v_roles);
    END IF;

    -- B7 JWT anonimo / sin app_metadata: NULL y {}
    PERFORM set_config('request.jwt.claims', '{}', true);
    v_tenant := public.get_auth_tenant_id();  v_roles := public.get_auth_roles();
    IF v_tenant IS NOT NULL OR cardinality(v_roles) <> 0 THEN
      v_fail := v_fail || format(E'\n - B7 sin JWT: tenant=%s roles=%s (esperado NULL y {})', v_tenant, v_roles);
    END IF;

    -- B8 RLS: un usuario con perfil pero SIN claims solo ve su propia fila de user_profiles
    --    (antes veia su tenant entero via fallback). Sin recursion ni error de RLS.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_sub, 'role', 'authenticated',
      'app_metadata', '{}'::jsonb, 'user_metadata', jsonb_build_object('tenant_id', v_ptenant))::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM public.user_profiles WHERE id <> v_sub;
    RESET ROLE;
    IF v_n <> 0 THEN
      v_fail := v_fail || format(E'\n - B8 sin claims ve %s filas ajenas de user_profiles (esperado 0)', v_n);
    END IF;

    -- Centinela: deshace GUCs y roles del sub-bloque
    RAISE EXCEPTION 'f0d_sentinel' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    NULL;
  END;

  IF v_fail <> '' THEN
    RAISE EXCEPTION E'0d VERIFY FAIL (comportamiento):%', v_fail;
  END IF;
  RAISE NOTICE '0d OK: % usuarios internos activos verificados con su JWT real', v_checked;
END
$verify_behavior$;

COMMIT;
