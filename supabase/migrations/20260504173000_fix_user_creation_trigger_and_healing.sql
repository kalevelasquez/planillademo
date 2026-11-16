BEGIN;

-- 1. Rediseño de Función con Blindaje de Transacción
-- Esta versión atrapa errores de casteo para no bloquear el registro en auth.users
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

-- 2. Asegurar vinculación del Trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created 
AFTER INSERT ON auth.users 
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. SCRIPT DE SANACIÓN (Healing): Recuperar usuarios huérfanos actuales
-- Identifica usuarios en auth.users que no tienen perfil en public.user_profiles y los crea.
INSERT INTO public.user_profiles (id, full_name, role, tenant_id, email, is_active, status)
SELECT 
    u.id,
    COALESCE(u.raw_user_meta_data->>'full_name', 'Usuario Recuperado'),
    CASE 
      WHEN (u.raw_user_meta_data->'roles') IS NOT NULL AND jsonb_typeof(u.raw_user_meta_data->'roles') = 'array' 
      THEN (SELECT array_agg(x)::text[] FROM jsonb_array_elements_text(u.raw_user_meta_data->'roles') x)
      ELSE ARRAY[COALESCE(u.raw_user_meta_data->>'role', 'vendedor')]
    END,
    (u.raw_user_meta_data->>'tenant_id')::uuid,
    u.email,
    TRUE,
    'ACTIVE'
FROM auth.users u
LEFT JOIN public.user_profiles up ON u.id = up.id
WHERE up.id IS NULL 
  AND (u.raw_user_meta_data->>'tenant_id') IS NOT NULL -- Solo sanamos si hay tenant asignado
ON CONFLICT (id) DO NOTHING;

COMMIT;
