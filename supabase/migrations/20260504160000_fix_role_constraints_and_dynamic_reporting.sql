-- Migration: Fix Role Constraints and Dynamic Reporting
-- Author: @arquitecto
-- Description: Elimina restricciones hardcoded y dinamiza reportes para soportar roles personalizados.

BEGIN;

-- 1. Eliminar la restricción restrictiva de roles
ALTER TABLE public.user_profiles 
DROP CONSTRAINT IF EXISTS user_profiles_roles_check;

-- 2. Asegurar que handle_new_user sea totalmente dinámico
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_tenant_id uuid;
  v_roles text[];
BEGIN
  -- Extraer tenant_id con manejo de errores
  BEGIN
    v_tenant_id := (NEW.raw_user_meta_data->>'tenant_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_tenant_id := NULL;
  END;

  -- Extraer roles del array o del campo individual
  IF (NEW.raw_user_meta_data->'roles') IS NOT NULL AND jsonb_typeof(NEW.raw_user_meta_data->'roles') = 'array' THEN
    SELECT array_agg(x)::text[] INTO v_roles FROM jsonb_array_elements_text(NEW.raw_user_meta_data->'roles') x;
  ELSE
    -- Si no hay roles, asignamos 'vendedor' como fallback seguro de sistema
    v_roles := ARRAY[COALESCE(NEW.raw_user_meta_data->>'role', 'vendedor')];
  END IF;

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
    tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email;

  RETURN NEW;
END; $$;

-- 3. Dinamizar reporte de vendedores
CREATE OR REPLACE FUNCTION public.get_report_sellers(
    p_tenant_id UUID,
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(t) INTO v_result
    FROM (
        SELECT 
            up.id as seller_id,
            up.full_name as seller_name,
            COUNT(o.id) as orders_count,
            COALESCE(SUM(o.total_amount), 0) as total_sales,
            CASE 
                WHEN COUNT(o.id) > 0 THEN ROUND(SUM(o.total_amount) / COUNT(o.id), 2)
                ELSE 0 
            END as avg_ticket
        FROM public.user_profiles up
        LEFT JOIN public.orders o ON up.id = o.seller_id 
              AND o.created_at >= p_start_date 
              AND o.created_at <= p_end_date
              AND o.status NOT IN ('borrador', 'cancelado', 'Draft', 'Cancelled')
        WHERE up.tenant_id = p_tenant_id 
        GROUP BY up.id, up.full_name
        HAVING COUNT(o.id) > 0 OR up.role && ARRAY['admin', 'supervisor', 'vendedor']::TEXT[]
        ORDER BY total_sales DESC
    ) t;
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- 4. SANACIÓN DE DATOS: Reparar usuarios huérfanos
-- Identifica usuarios en auth.users que no tienen perfil en public.user_profiles y los crea.
INSERT INTO public.user_profiles (id, full_name, role, tenant_id, email, is_active, status)
SELECT 
    u.id,
    COALESCE(u.raw_user_meta_data->>'full_name', 'Usuario Recuperado'),
    ARRAY[COALESCE(u.raw_user_meta_data->>'role', 'vendedor')],
    (u.raw_user_meta_data->>'tenant_id')::uuid,
    u.email,
    TRUE,
    'ACTIVE'
FROM auth.users u
LEFT JOIN public.user_profiles up ON u.id = up.id
WHERE up.id IS NULL
  AND (u.raw_user_meta_data->>'tenant_id') IS NOT NULL
ON CONFLICT (id) DO NOTHING;

COMMIT;
