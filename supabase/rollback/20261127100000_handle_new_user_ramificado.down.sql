-- =============================================================================
-- ROLLBACK de 20261127100000_handle_new_user_ramificado.sql  (0b)
--
-- NO vive en supabase/migrations (el pipeline lo aplicaria solo). Si hay que
-- revertir 0b: copiar este archivo a supabase/migrations/ con un timestamp NUEVO
-- (posterior a la ultima migracion aplicada, p. ej. 2026XXXX090000_revertir_0b.sql)
-- y hacer push a main. NUNCA editar la migracion original ya aplicada.
--
-- ORDEN: si tambien se revierte 0a, este .down va PRIMERO (0b depende de
-- staff_invitations, que 0a.down elimina).
--
-- QUE HACE:
--   * Restaura el handle_new_user ORIGINAL (texto literal en _originals_f0.sql [4]).
--     OJO: reabre el agujero (el signup publico vuelve a poder crear un perfil interno
--     con roles/tenant de la metadata). Es lo que existia antes de F0.
--   * Deshabilita la tienda (store_enabled=false).
--   * Las columnas nuevas (tenants.store_enabled, customers.auth_user_id/email) y sus
--     indices quedan: son inocuos y evitan perder datos de clientes ya vinculados.
--
-- AUTOVERIFICACION: si alguna post-condicion falla, RAISE EXCEPTION y rollback total.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_tenant_id uuid;
  v_roles text[];
BEGIN
  -- Intento de casteo seguro de tenant_id desde metadata
  BEGIN
    v_tenant_id := (NEW.raw_user_meta_data->>'tenant_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_tenant_id := NULL; -- El trigger no debe bloquear el registro de Auth si falla la metadata
  END;

  -- Normalización dinámica de roles (soporta array u objeto individual)
  IF (NEW.raw_user_meta_data->'roles') IS NOT NULL AND jsonb_typeof(NEW.raw_user_meta_data->'roles') = 'array' THEN
    SELECT array_agg(x)::text[] INTO v_roles FROM jsonb_array_elements_text(NEW.raw_user_meta_data->'roles') x;
  ELSE
    v_roles := ARRAY[COALESCE(NEW.raw_user_meta_data->>'role', 'vendedor')];
  END IF;

  -- Upsert Idempotente: Si el perfil ya existe (o falló a medias), se actualiza.
  INSERT INTO public.user_profiles (id, full_name, role, tenant_id, email, is_active, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Usuario Invitado'),
    v_roles,
    v_tenant_id,
    NEW.email,
    TRUE,
    'PENDING'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    tenant_id = COALESCE(EXCLUDED.tenant_id, user_profiles.tenant_id),
    email = EXCLUDED.email;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

UPDATE public.tenants SET store_enabled = false WHERE store_enabled;

-- Autoverificacion
DO $verify$
DECLARE
  v_def text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'handle_new_user'
       AND p.prosrc ILIKE '%raw_user_meta_data->>''tenant_id''%'
       AND p.prosrc NOT ILIKE '%staff_invitations%'
  ) THEN
    RAISE EXCEPTION '0b DOWN VERIFY FAIL: handle_new_user no es la version original';
  END IF;

  SELECT pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_trigger t
   WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal;
  IF v_def IS NULL OR v_def NOT ILIKE '%AFTER INSERT%' OR v_def NOT ILIKE '%handle_new_user%' THEN
    RAISE EXCEPTION '0b DOWN VERIFY FAIL: on_auth_user_created ausente o mal definido';
  END IF;

  IF EXISTS (SELECT 1 FROM public.tenants WHERE store_enabled) THEN
    RAISE EXCEPTION '0b DOWN VERIFY FAIL: quedan tenants con store_enabled=true';
  END IF;
END
$verify$;

COMMIT;
