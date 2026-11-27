-- =============================================================================
-- ROLLBACK de 20261130090000_retirar_fallback_user_profiles.sql  (0d)
--
-- NO vive en supabase/migrations (el pipeline lo aplicaria solo). Si hay que revertir
-- 0d: copiar este archivo a supabase/migrations/ con un timestamp NUEVO (posterior a la
-- ultima migracion aplicada) y hacer push a main. NUNCA editar la migracion aplicada.
--
-- QUE HACE: reaplica las versiones de 0a (fallback B) de get_auth_tenant_id() y
-- get_auth_roles(): primero app_metadata del JWT y, si esta vacio, el perfil del
-- usuario en public.user_profiles (por auth.uid()). NUNCA lee user_metadata.
-- Texto literal de 20261127090000_endurecer_claims_app_metadata.sql, seccion 2.
--
-- Util si, tras 0d, algun usuario interno se quedo sin tenant porque su access token
-- es anterior al backfill (el fallback cubre ese hueco sin esperar al refresh).
-- app_metadata ya backfilleado se deja (inocuo). No toca triggers ni policies.
--
-- AUTOVERIFICACION: si alguna post-condicion falla, RAISE EXCEPTION y rollback total.
-- =============================================================================

BEGIN;

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

-- Autoverificacion
DO $verify$
DECLARE
  v_fn  text;
  v_sub uuid;
  v_t   uuid;
  v_p   uuid;
BEGIN
  FOR v_fn IN SELECT unnest(ARRAY['get_auth_tenant_id', 'get_auth_roles']) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'public' AND p.proname = v_fn
         AND p.prosecdef AND p.provolatile = 's'
         AND coalesce(p.proconfig::text, '') ILIKE '%search_path%'
         AND p.prosrc ILIKE '%user_profiles%'
         AND p.prosrc ILIKE '%app_metadata%'
         AND p.prosrc NOT ILIKE '%user_metadata%'
    ) THEN
      RAISE EXCEPTION '0d DOWN VERIFY FAIL: % no es la version con fallback a user_profiles', v_fn;
    END IF;
  END LOOP;

  -- comportamiento: un perfil real sin claims vuelve a resolver su tenant (si hay perfiles)
  SELECT p.id, p.tenant_id INTO v_sub, v_p
    FROM public.user_profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.tenant_id IS NOT NULL LIMIT 1;
  IF v_sub IS NOT NULL THEN
    BEGIN
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_sub, 'role', 'authenticated',
        'app_metadata', '{}'::jsonb)::text, true);
      v_t := public.get_auth_tenant_id();
      IF v_t IS DISTINCT FROM v_p THEN
        RAISE EXCEPTION '0d DOWN VERIFY FAIL: fallback no resuelve el tenant del perfil (%, esperado %)', v_t, v_p;
      END IF;
      PERFORM set_config('request.jwt.claims', '', true);
    END;
  END IF;
END
$verify$;

COMMIT;
