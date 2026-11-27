-- =============================================================================
-- F0 / 0a - Endurecer claims de autorizacion (change: tienda-web-clientes)
--
-- PROBLEMA (hallazgos H1, H2, H3 del design):
--   * get_auth_tenant_id()/get_auth_roles() leian el JWT "user_metadata", que
--     CUALQUIER usuario autenticado puede reescribir con supabase.auth.updateUser()
--     (escalada de rol y de tenant).
--   * get_auth_roles() devolvia 'vendedor' cuando no habia rol (H1).
--   * La policy user_profiles_select_policy_v3 leia el JWT "user_metadata" directo (H2).
--   * Un usuario podia cambiarse su propio user_profiles.role/tenant_id (H3).
--
-- SOLUCION (fallback "B", decision del usuario 2026-11-27):
--   1. get_auth_tenant_id()/get_auth_roles(): primero app_metadata del JWT (solo lo
--      escribe el servidor). Si esta vacio, consultan public.user_profiles por
--      auth.uid(). NUNCA leen la metadata editable por el usuario.
--      Son SECURITY DEFINER + search_path fijo + STABLE: asi la consulta a
--      user_profiles NO dispara RLS (las policies de user_profiles llaman a estas
--      mismas funciones; sin DEFINER habria recursion infinita).
--      get_auth_roles() devuelve '{}' (no 'vendedor') si no encuentra nada.
--   2. Trigger BEFORE UPDATE guard_user_profiles_privileged_cols: un usuario final
--      no puede cambiar role/tenant_id/is_active/status de su propio perfil, ni
--      cambiar los de otro sin permiso usuarios.edit. service_role, migraciones y
--      GoTrue (sin JWT de usuario) pasan.
--   3. Trigger sync_user_claims: user_profiles(role, tenant_id) -> auth.users
--      raw_app_meta_data. Backfill de los usuarios existentes en esta misma migracion.
--   4. Tabla staff_invitations (la usa 0b): invitaciones internas con nonce secreto.
--   5. Policy user_profiles_select_policy_v3 reescrita con get_auth_tenant_id().
--
-- AUTOVERIFICACION: la migracion corre en una transaccion; antes del COMMIT un bloque
-- DO comprueba las post-condiciones (catalogo + comportamiento con fixtures que se
-- deshacen en un sub-bloque). Cualquier fallo hace RAISE EXCEPTION y revierte TODO:
-- la BD queda exactamente como estaba.
--
-- Rollback: supabase/rollback/20261127090000_endurecer_claims_app_metadata.down.sql
-- (migracion hacia adelante preparada; copiarla a migrations/ con timestamp nuevo
-- solo si hace falta).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. LINEA BASE (antes de cambiar nada): filas visibles para un cliente autenticado
--    SIN claims ni perfil. Despues de la migracion no pueden aumentar.
-- -----------------------------------------------------------------------------
DO $base$
DECLARE
  v_tbl   text;
  v_n     bigint;
  v_json  jsonb := '{}'::jsonb;
  c_tables CONSTANT text[] := ARRAY['orders', 'customers', 'products', 'user_profiles', 'order_items'];
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated',
                       'app_metadata', '{}'::jsonb, 'user_metadata', '{}'::jsonb)::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    FOREACH v_tbl IN ARRAY c_tables LOOP
      IF to_regclass('public.' || v_tbl) IS NOT NULL THEN
        EXECUTE format('SELECT count(*) FROM public.%I', v_tbl) INTO v_n;
        v_json := v_json || jsonb_build_object(v_tbl, v_n);
      END IF;
    END LOOP;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_json := '{"error": true}'::jsonb;   -- sin linea base: se omite la comparacion
    RAISE NOTICE '0a base: no se pudo medir la linea base (%): se omite la comparacion', SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('f0a.base_counts', v_json::text, true);
END
$base$;

-- -----------------------------------------------------------------------------
-- 1. staff_invitations (invitaciones internas; solo service_role y funciones DEFINER)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_invitations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text        NOT NULL,
  nonce       uuid        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  full_name   text,
  roles       text[]      NOT NULL,
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by  uuid,
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  consumed_at timestamptz,
  consumed_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_invitations_email ON public.staff_invitations (lower(email));

ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;   -- sin policies: nadie via PostgREST
REVOKE ALL ON public.staff_invitations FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. get_auth_tenant_id() / get_auth_roles()  (fallback B: app_metadata -> user_profiles)
--    OJO: estos cuerpos NO deben nombrar la metadata editable por el usuario
--    (la autoverificacion lo comprueba escaneando pg_proc).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim  text;
  v_uid    uuid;
  v_tenant uuid;
BEGIN
  -- 1) app_metadata del JWT (solo escribible por el servidor)
  v_claim := auth.jwt() -> 'app_metadata' ->> 'tenant_id';
  IF v_claim IS NOT NULL AND v_claim <> '' THEN
    BEGIN
      RETURN v_claim::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      NULL;  -- claim corrupta: se cae al perfil
    END;
  END IF;

  -- 2) Transicion: tokens emitidos antes del backfill -> perfil del usuario
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.tenant_id INTO v_tenant FROM public.user_profiles p WHERE p.id = v_uid;
  RETURN v_tenant;   -- NULL si no hay perfil (p. ej. cliente de tienda)
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
  v_uid   uuid;
BEGIN
  -- 1) app_metadata del JWT
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

  IF v_roles IS NOT NULL AND cardinality(v_roles) > 0 THEN
    RETURN v_roles;
  END IF;

  -- 2) Transicion: perfil del usuario
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    SELECT ARRAY(SELECT DISTINCT r FROM unnest(p.role) AS r) INTO v_roles
      FROM public.user_profiles p WHERE p.id = v_uid;
  END IF;

  -- Sin default 'vendedor' (hallazgo H1): sin rol conocido => ningun rol
  RETURN coalesce(v_roles, '{}'::text[]);
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Policy de lectura de user_profiles sin metadata editable (H2)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "user_profiles_select_policy_v3" ON public.user_profiles;
CREATE POLICY "user_profiles_select_policy_v3" ON public.user_profiles
FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR tenant_id = public.get_auth_tenant_id()
);

-- -----------------------------------------------------------------------------
-- 4. Guard: nadie se auto-escala (H3)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_user_profiles_privileged_cols()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role      IS DISTINCT FROM OLD.role
  OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
  OR NEW.is_active IS DISTINCT FROM OLD.is_active
  OR NEW.status    IS DISTINCT FROM OLD.status THEN

    -- Solo se controla a usuarios finales (JWT con sub). Pasan sin control:
    --   * service_role (edge functions)
    --   * contexto sin JWT de usuario (migraciones, SQL editor, GoTrue y sus triggers)
    IF auth.uid() IS NOT NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
      IF NEW.id = auth.uid() OR NOT public.has_permission('usuarios', 'edit') THEN
        RAISE EXCEPTION 'guard_user_profiles_privileged_cols: no autorizado a modificar role, tenant_id, is_active o status'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_user_profiles_privileged_cols() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_user_profiles_privileged_cols ON public.user_profiles;
CREATE TRIGGER guard_user_profiles_privileged_cols
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_user_profiles_privileged_cols();

-- -----------------------------------------------------------------------------
-- 5. Sync user_profiles -> app_metadata
--    Si falla, NO bloquea la escritura del perfil: el fallback a user_profiles de
--    get_auth_* cubre el hueco (y queda un WARNING en los logs).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_user_claims()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;   -- sin tenant no hay claims que publicar
  END IF;

  BEGIN
    UPDATE auth.users
       SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                               || jsonb_build_object(
                                    'tenant_id', NEW.tenant_id,
                                    'roles', to_jsonb(coalesce(NEW.role, '{}'::text[])))
     WHERE id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sync_user_claims % : %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_user_claims() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_user_claims ON public.user_profiles;
CREATE TRIGGER sync_user_claims
AFTER INSERT OR UPDATE OF role, tenant_id ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_user_claims();

-- -----------------------------------------------------------------------------
-- 6. Backfill: perfiles existentes -> app_metadata (idempotente)
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
-- 7. AUTOVERIFICACION A: catalogo y datos (cualquier fallo => rollback total)
-- -----------------------------------------------------------------------------
DO $verify_catalog$
DECLARE
  n       int;
  v_list  text;
  v_def   text;
BEGIN
  -- 7.1 staff_invitations: existe, RLS ON, sin policies, sin acceso para anon/authenticated
  IF to_regclass('public.staff_invitations') IS NULL THEN
    RAISE EXCEPTION '0a VERIFY FAIL: no existe public.staff_invitations';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.staff_invitations'::regclass) THEN
    RAISE EXCEPTION '0a VERIFY FAIL: staff_invitations sin RLS habilitado';
  END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'staff_invitations';
  IF n <> 0 THEN
    RAISE EXCEPTION '0a VERIFY FAIL: staff_invitations no debe tener policies (hay %)', n;
  END IF;
  IF has_table_privilege('anon', 'public.staff_invitations', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.staff_invitations', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION '0a VERIFY FAIL: anon/authenticated tienen privilegios sobre staff_invitations';
  END IF;

  -- 7.2 get_auth_*: DEFINER, search_path fijo, sin metadata editable
  FOR v_def IN SELECT unnest(ARRAY['get_auth_tenant_id', 'get_auth_roles']) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'public' AND p.proname = v_def
         AND p.prosecdef
         AND p.provolatile = 's'
         AND coalesce(p.proconfig::text, '') ILIKE '%search_path%'
         AND p.prosrc NOT ILIKE '%user_metadata%'
    ) THEN
      RAISE EXCEPTION '0a VERIFY FAIL: % debe ser SECURITY DEFINER STABLE con search_path fijo y sin leer user_metadata', v_def;
    END IF;
  END LOOP;

  -- 7.3 Triggers presentes y habilitados
  FOR v_def IN SELECT unnest(ARRAY['guard_user_profiles_privileged_cols', 'sync_user_claims']) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid = 'public.user_profiles'::regclass AND t.tgname = v_def
         AND NOT t.tgisinternal AND t.tgenabled = 'O'
    ) THEN
      RAISE EXCEPTION '0a VERIFY FAIL: trigger % ausente o deshabilitado en user_profiles', v_def;
    END IF;
  END LOOP;

  -- 7.4 Policy v3: existe, usa get_auth_tenant_id() y no la metadata editable
  SELECT qual INTO v_def FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'user_profiles' AND policyname = 'user_profiles_select_policy_v3';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '0a VERIFY FAIL: falta la policy user_profiles_select_policy_v3';
  END IF;
  IF v_def ILIKE '%user_metadata%' OR v_def NOT ILIKE '%get_auth_tenant_id%' THEN
    RAISE EXCEPTION '0a VERIFY FAIL: user_profiles_select_policy_v3 mal definida: %', v_def;
  END IF;

  -- 7.5 Ninguna policy ni funcion de public lee la metadata editable (spec: verificacion punto 7)
  SELECT count(*), string_agg(x.obj, '; ') INTO n, v_list
    FROM (
      SELECT 'policy ' || schemaname || '.' || tablename || '.' || policyname AS obj
        FROM pg_policies
       WHERE coalesce(qual, '') ILIKE '%user_metadata%' OR coalesce(with_check, '') ILIKE '%user_metadata%'
      UNION ALL
      SELECT 'fn public.' || p.proname
        FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'public' AND p.prosrc ILIKE '%user_metadata%'
    ) x;
  IF n > 0 THEN
    RAISE EXCEPTION '0a VERIFY FAIL: quedan % objetos que leen user_metadata: %', n, left(v_list, 800);
  END IF;

  -- 7.6 Backfill completo: todo perfil con tenant tiene app_metadata coherente
  SELECT count(*), string_agg(p.id::text, ',') INTO n, v_list
    FROM public.user_profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.tenant_id IS NOT NULL
     AND ( (u.raw_app_meta_data ->> 'tenant_id') IS DISTINCT FROM p.tenant_id::text
        OR (u.raw_app_meta_data -> 'roles')      IS DISTINCT FROM to_jsonb(coalesce(p.role, '{}'::text[])) );
  IF n > 0 THEN
    RAISE EXCEPTION '0a VERIFY FAIL: % perfiles sin app_metadata coherente tras el backfill: %', n, left(v_list, 400);
  END IF;

  -- 7.7 Informativo (no falla): usuarios cuyo tenant en la metadata editable difiere del perfil.
  --     A partir de ahora manda el perfil (fuente de verdad).
  SELECT count(*) INTO n
    FROM public.user_profiles p JOIN auth.users u ON u.id = p.id
   WHERE (u.raw_user_meta_data ->> 'tenant_id') IS NOT NULL
     AND (u.raw_user_meta_data ->> 'tenant_id') IS DISTINCT FROM p.tenant_id::text;
  IF n > 0 THEN
    RAISE NOTICE '0a: % usuarios tienen en la metadata de usuario un tenant distinto al de user_profiles (manda user_profiles)', n;
  END IF;
END
$verify_catalog$;

-- -----------------------------------------------------------------------------
-- 8. AUTOVERIFICACION B: comportamiento (JWT simulados + RLS + guard + sync).
--    Todo ocurre dentro de un sub-bloque que termina con una excepcion centinela:
--    Postgres deshace cualquier cambio (UPDATEs de prueba, sync a auth.users, GUCs,
--    SET ROLE). No se crean usuarios ni tenants: solo se lee/modifica-y-deshace.
-- -----------------------------------------------------------------------------
DO $verify_behavior$
DECLARE
  v_fail     text := '';
  v_rand     uuid := gen_random_uuid();
  v_other    uuid := gen_random_uuid();
  v_sub      uuid;
  v_ptenant  uuid;
  v_prole    text[];
  v_tenant   uuid;
  v_roles    text[];
  v_n        bigint;
  v_base     jsonb := coalesce(nullif(current_setting('f0a.base_counts', true), '')::jsonb, '{"error": true}'::jsonb);
  v_tbl      text;
  v_raised   boolean;
  v_rows     int;
  v_msg      text;
  v_app      jsonb;
  c_tables   CONSTANT text[] := ARRAY['orders', 'customers', 'products', 'user_profiles', 'order_items'];
  c_hostile  CONSTANT jsonb := '{"tenant_id": "dddddddd-0000-0000-0000-00000000000d", "roles": ["admin"], "role": "admin"}'::jsonb;
BEGIN
  -- Sujeto real: un perfil con tenant (preferimos admin). Puede no existir en una BD vacia.
  SELECT p.id, p.tenant_id, p.role INTO v_sub, v_ptenant, v_prole
    FROM public.user_profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.tenant_id IS NOT NULL
   ORDER BY (('admin' = ANY (p.role))) DESC, p.created_at NULLS LAST
   LIMIT 1;

  BEGIN  -- sub-bloque revertible

    -- B1 cliente sin claims y sin perfil: tenant NULL, roles vacios (H1)
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_rand, 'role', 'authenticated',
      'app_metadata', '{}'::jsonb, 'user_metadata', '{}'::jsonb)::text, true);
    v_tenant := public.get_auth_tenant_id();  v_roles := public.get_auth_roles();
    IF v_tenant IS NOT NULL OR cardinality(v_roles) <> 0 THEN
      v_fail := v_fail || format(E'\n - B1 cliente sin claims: tenant=%s roles=%s (esperado NULL y {})', v_tenant, v_roles);
    END IF;

    -- B2 escalada via la metadata editable (sin app_metadata): ni tenant ni admin
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_rand, 'role', 'authenticated',
      'app_metadata', '{}'::jsonb, 'user_metadata', c_hostile)::text, true);
    v_tenant := public.get_auth_tenant_id();  v_roles := public.get_auth_roles();
    IF v_tenant IS NOT NULL OR 'admin' = ANY (v_roles) THEN
      v_fail := v_fail || format(E'\n - B2 metadata hostil: tenant=%s roles=%s (esperado NULL y sin admin)', v_tenant, v_roles);
    END IF;

    -- B3 app_metadata prevalece sobre la metadata hostil
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_rand, 'role', 'authenticated',
      'app_metadata', jsonb_build_object('tenant_id', v_other, 'roles', jsonb_build_array('vendedor')),
      'user_metadata', c_hostile)::text, true);
    v_tenant := public.get_auth_tenant_id();  v_roles := public.get_auth_roles();
    IF v_tenant IS DISTINCT FROM v_other OR v_roles IS DISTINCT FROM ARRAY['vendedor']::text[] THEN
      v_fail := v_fail || format(E'\n - B3 app_metadata prevalece: tenant=%s (esp %s) roles=%s (esp {vendedor})', v_tenant, v_other, v_roles);
    END IF;

    IF v_sub IS NOT NULL THEN
      -- B4 fallback B: app_metadata vacio + metadata hostil => tenant/roles del PERFIL
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_sub, 'role', 'authenticated',
        'app_metadata', '{}'::jsonb, 'user_metadata', c_hostile)::text, true);
      v_tenant := public.get_auth_tenant_id();  v_roles := public.get_auth_roles();
      IF v_tenant IS DISTINCT FROM v_ptenant
         OR NOT (v_roles @> v_prole AND v_roles <@ v_prole) THEN
        v_fail := v_fail || format(E'\n - B4 fallback a user_profiles: tenant=%s (esp %s) roles=%s (esp %s)', v_tenant, v_ptenant, v_roles, v_prole);
      END IF;

      -- B5 policy de user_profiles ignora la metadata editable:
      --    app tenant = otro, metadata hostil apunta al tenant real => 0 filas del tenant real
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_rand, 'role', 'authenticated',
        'app_metadata', jsonb_build_object('tenant_id', v_other),
        'user_metadata', jsonb_build_object('tenant_id', v_ptenant))::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO v_n FROM public.user_profiles WHERE tenant_id = v_ptenant;
      RESET ROLE;
      IF v_n <> 0 THEN
        v_fail := v_fail || format(E'\n - B5 policy user_profiles: %s filas visibles via metadata editable (esperado 0)', v_n);
      END IF;

      -- B8 el usuario puede editar una columna NO privilegiada propia (el guard no sobre-bloquea).
      --    Ademas mide si la policy deja actualizar la propia fila: si no, B6/B7 no son probables.
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_sub, 'role', 'authenticated',
        'app_metadata', jsonb_build_object('tenant_id', v_ptenant, 'roles', to_jsonb(v_prole)),
        'user_metadata', '{}'::jsonb)::text, true);
      SET LOCAL ROLE authenticated;
      v_raised := false;  v_msg := '';  v_rows := 0;
      BEGIN
        UPDATE public.user_profiles SET phone = phone WHERE id = v_sub;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
      EXCEPTION WHEN OTHERS THEN
        v_raised := true;  v_msg := SQLERRM;
      END;
      RESET ROLE;
      IF v_raised THEN
        v_fail := v_fail || format(E'\n - B8 guard sobre-bloquea una columna normal: %s', v_msg);
      END IF;

      IF v_rows = 1 THEN
        -- B6 guard: auto-escalada de role bloqueada (usuario final, sin service_role)
        SET LOCAL ROLE authenticated;
        v_raised := false;  v_msg := '';
        BEGIN
          UPDATE public.user_profiles SET role = array_append(role, 'zz_guard_probe') WHERE id = v_sub;
        EXCEPTION WHEN OTHERS THEN
          v_raised := true;  v_msg := SQLERRM;
        END;
        RESET ROLE;
        IF NOT v_raised OR v_msg NOT LIKE 'guard_user_profiles_privileged_cols%' THEN
          v_fail := v_fail || format(E'\n - B6 guard role: raised=%s msg=%s (esperado el error del guard)', v_raised, v_msg);
        END IF;

        -- B7 guard: auto-cambio de is_active tambien bloqueado
        SET LOCAL ROLE authenticated;
        v_raised := false;  v_msg := '';
        BEGIN
          UPDATE public.user_profiles SET is_active = NOT coalesce(is_active, true) WHERE id = v_sub;
        EXCEPTION WHEN OTHERS THEN
          v_raised := true;  v_msg := SQLERRM;
        END;
        RESET ROLE;
        IF NOT v_raised OR v_msg NOT LIKE 'guard_user_profiles_privileged_cols%' THEN
          v_fail := v_fail || format(E'\n - B7 guard is_active: raised=%s msg=%s (esperado el error del guard)', v_raised, v_msg);
        END IF;
      ELSE
        RAISE NOTICE '0a VERIFY: la policy no deja actualizar la propia fila (filas=%); se omiten B6/B7', v_rows;
      END IF;

      -- B9 service_role SI puede cambiar role, y sync_user_claims lo publica en app_metadata
      PERFORM set_config('request.jwt.claims',
        jsonb_build_object('role', 'service_role')::text, true);
      v_raised := false;  v_msg := '';
      BEGIN
        UPDATE public.user_profiles SET role = array_append(role, 'zz_sync_probe') WHERE id = v_sub;
      EXCEPTION WHEN OTHERS THEN
        v_raised := true;  v_msg := SQLERRM;
      END;
      IF v_raised THEN
        v_fail := v_fail || format(E'\n - B9 service_role no pudo cambiar role: %s', v_msg);
      ELSE
        SELECT raw_app_meta_data INTO v_app FROM auth.users WHERE id = v_sub;
        IF NOT (coalesce(v_app -> 'roles', '[]'::jsonb) ? 'zz_sync_probe')
           OR (v_app ->> 'tenant_id') IS DISTINCT FROM v_ptenant::text THEN
          v_fail := v_fail || format(E'\n - B9 sync_user_claims no publico el cambio en app_metadata: %s', v_app);
        END IF;
      END IF;
    ELSE
      RAISE NOTICE '0a VERIFY: no hay perfiles con tenant; se omiten B4-B9 (solo B1-B3)';
    END IF;

    -- B10 cliente sin claims: no ve MAS filas que antes de la migracion (no ensancha acceso)
    IF v_base ? 'error' THEN
      RAISE NOTICE '0a VERIFY: sin linea base, se omite la comparacion de filas visibles';
    ELSE
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated',
        'app_metadata', '{}'::jsonb, 'user_metadata', '{}'::jsonb)::text, true);
      SET LOCAL ROLE authenticated;
      FOREACH v_tbl IN ARRAY c_tables LOOP
        IF v_base ? v_tbl THEN
          EXECUTE format('SELECT count(*) FROM public.%I', v_tbl) INTO v_n;
          IF v_n > (v_base ->> v_tbl)::bigint THEN
            v_fail := v_fail || format(E'\n - B10 cliente sin claims ve %s filas en %s (antes %s)', v_n, v_tbl, v_base ->> v_tbl);
          END IF;
        END IF;
      END LOOP;
      RESET ROLE;
    END IF;

    -- Centinela: fuerza el rollback del sub-bloque (fixtures, sync, GUCs, roles)
    RAISE EXCEPTION 'f0a_sentinel' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    NULL;  -- esperado: todo lo hecho dentro del sub-bloque queda deshecho
  END;

  IF v_fail <> '' THEN
    RAISE EXCEPTION E'0a VERIFY FAIL (comportamiento):%', v_fail;
  END IF;
END
$verify_behavior$;

COMMIT;
