-- =============================================================================
-- ROLLBACK de 20261127090000_endurecer_claims_app_metadata.sql  (0a)
--
-- NO vive en supabase/migrations (el pipeline lo aplicaria solo). Si hay que
-- revertir 0a: copiar este archivo a supabase/migrations/ con un timestamp NUEVO
-- (posterior a la ultima migracion aplicada) y hacer push a main. NUNCA editar la
-- migracion original ya aplicada.
--
-- ORDEN: revertir PRIMERO 0b (20261127100000_...down.sql); este .down elimina
-- staff_invitations, de la que depende el handle_new_user de 0b.
--
-- QUE HACE:
--   * Restaura get_auth_tenant_id()/get_auth_roles() y la policy v3 ORIGINALES
--     (texto literal en _originals_f0.sql [1][2][3]). OJO: reabre los hallazgos
--     H1 (default 'vendedor'), H2 y la escalada via la metadata editable.
--   * Elimina los triggers guard/sync y sus funciones, y la tabla staff_invitations.
--   * app_metadata ya backfilleado se deja (inocuo: nadie lo lee tras el rollback).
--
-- AUTOVERIFICACION: si alguna post-condicion falla, RAISE EXCEPTION y rollback total.
-- =============================================================================

BEGIN;

-- 1. Triggers y funciones nuevas
DROP TRIGGER IF EXISTS guard_user_profiles_privileged_cols ON public.user_profiles;
DROP TRIGGER IF EXISTS sync_user_claims ON public.user_profiles;
DROP FUNCTION IF EXISTS public.guard_user_profiles_privileged_cols();
DROP FUNCTION IF EXISTS public.sync_user_claims();

-- 2. Restaurar get_auth_* originales (de _originals_f0.sql).
--    CREATE OR REPLACE reinicia los atributos: vuelven a SECURITY INVOKER / LANGUAGE sql.
CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_roles()
RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT ARRAY(
    SELECT DISTINCT val
    FROM jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(auth.jwt() -> 'user_metadata' -> 'roles') = 'array' THEN auth.jwt() -> 'user_metadata' -> 'roles'
        WHEN jsonb_typeof(auth.jwt() -> 'user_metadata' -> 'role') = 'array' THEN auth.jwt() -> 'user_metadata' -> 'role'
        ELSE jsonb_build_array(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', 'vendedor'))
      END
    ) AS val
  );
$$;

-- 3. Restaurar la policy v3 original
DROP POLICY IF EXISTS "user_profiles_select_policy_v3" ON public.user_profiles;
CREATE POLICY "user_profiles_select_policy_v3" ON public.user_profiles
FOR SELECT TO authenticated
USING (
    id = auth.uid()
    OR tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid
);

-- 4. Quitar staff_invitations (requiere que 0b ya este revertido)
DROP TABLE IF EXISTS public.staff_invitations;

-- 5. Autoverificacion
DO $verify$
DECLARE
  v_def text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid = 'public.user_profiles'::regclass
                AND t.tgname IN ('guard_user_profiles_privileged_cols', 'sync_user_claims')
                AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION '0a DOWN VERIFY FAIL: quedan triggers guard/sync';
  END IF;

  IF to_regclass('public.staff_invitations') IS NOT NULL THEN
    RAISE EXCEPTION '0a DOWN VERIFY FAIL: staff_invitations sigue existiendo';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname IN ('get_auth_tenant_id', 'get_auth_roles')
     GROUP BY ns.nspname
    HAVING count(*) = 2 AND bool_and(NOT p.prosecdef) AND bool_and(p.prosrc ILIKE '%user_metadata%')
  ) THEN
    RAISE EXCEPTION '0a DOWN VERIFY FAIL: get_auth_* no son las versiones originales';
  END IF;

  SELECT qual INTO v_def FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'user_profiles' AND policyname = 'user_profiles_select_policy_v3';
  IF v_def IS NULL OR v_def NOT ILIKE '%user_metadata%' THEN
    RAISE EXCEPTION '0a DOWN VERIFY FAIL: policy v3 no es la original: %', coalesce(v_def, 'NULL');
  END IF;
END
$verify$;

COMMIT;
