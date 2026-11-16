-- Migration: Soporte para Roles Múltiples y Gestión de Usuarios (US-AUTH-06) - VERSIÓN FINAL PROD
-- Author: @operador & Antigravity
-- Fecha: 2026-03-12 (Updated 2026-03-18)
-- Descripción: Cambia el tipo de perfil a array y actualiza TODA la infraestructura de RLS 
--              usando funciones SECURITY DEFINER para evitar recursión y fallos de JWT.

BEGIN;

-- ============================================================
-- 1. ELIMINAR POLÍTICAS DEPENDIENTES (Limpieza Total)
-- Dropeamos todas las políticas de las tablas afectadas para que
-- el ALTER COLUMN TYPE no falle por dependencias de políticas previas,
-- sin importar qué nombres hayan tenido en migraciones anteriores.
-- ============================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    -- Usamos pg_catalog directamente (más confiable que la vista pg_policies)
    -- y casteamos a text explícitamente para evitar problemas con el tipo "name".
    FOR r IN
        SELECT n.nspname::text AS schema_name,
               c.relname::text AS table_name,
               pol.polname::text AS policy_name
        FROM pg_catalog.pg_policy pol
        JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname::text = 'public'
          AND c.relname::text = ANY(ARRAY['customers','products','orders','order_items','user_profiles'])
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policy_name, r.schema_name, r.table_name);
    END LOOP;
END $$;

-- ============================================================
-- 2. TRANSFORMAR ESTRUCTURA DE ROLES
-- ============================================================

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'PENDING';

-- Dropear todos los CHECK constraints de user_profiles antes de alterar el tipo de "role".
-- Una migración anterior puede haber dejado un constraint como CHECK (role = 'admin' OR ...)
-- que, al cambiar role de text a text[], genera "operator does not exist: text[] = text"
-- cuando PostgreSQL intenta revalidar el constraint almacenado.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT con.conname::text AS constraint_name
        FROM pg_catalog.pg_constraint con
        JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname::text = 'public'
          AND c.relname::text = 'user_profiles'
          AND con.contype = 'c'
    LOOP
        EXECUTE format('ALTER TABLE public.user_profiles DROP CONSTRAINT %I', r.constraint_name);
    END LOOP;
END $$;

-- Asegurar tipo TEXT[] para roles
DO $$
DECLARE
    v_type_fmt text;
BEGIN
    -- format_type devuelve 'text', 'character varying', 'text[]', etc.
    -- Usamos pg_catalog para evitar los tipos especiales de information_schema.
    SELECT pg_catalog.format_type(a.atttypid, a.atttypmod)
    INTO v_type_fmt
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname::text = 'public'
      AND c.relname::text = 'user_profiles'
      AND a.attname::text = 'role'
      AND a.attnum > 0
      AND NOT a.attisdropped;

    -- Si no termina en '[]', no es array → hay que convertir.
    -- EXECUTE para que el DDL se compile en runtime, no en parse time.
    IF v_type_fmt IS NOT NULL AND v_type_fmt NOT LIKE '%[]' THEN
        EXECUTE 'ALTER TABLE public.user_profiles ALTER COLUMN role TYPE TEXT[] USING ARRAY[role::text]';
    END IF;
END $$;

-- Validation Constraint
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_roles_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_roles_check 
  CHECK (role <@ ARRAY['admin', 'supervisor', 'vendedor', 'despachador']::TEXT[]);

-- ============================================================
-- 3. FUNCIONES DE SEGURIDAD (ANTI-RECURSIÓN & SECURITY DEFINER)
-- ============================================================

-- get_auth_tenant_id: Obtiene el tenant actual saltándose el RLS
CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid());
END; $$;

-- get_auth_roles: Obtiene los roles actuales saltándose el RLS
CREATE OR REPLACE FUNCTION public.get_auth_roles()
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN (SELECT role FROM public.user_profiles WHERE id = auth.uid());
END; $$;

-- ============================================================
-- 4. RECREAR POLÍTICAS RLS (BASADAS EN FUNCIONES SEGURAS)
-- ============================================================

-- USER_PROFILES
CREATE POLICY "user_profiles_select_v5" ON public.user_profiles
  FOR SELECT USING (id = auth.uid() OR tenant_id = public.get_auth_tenant_id());

CREATE POLICY "user_profiles_admin_v5" ON public.user_profiles
  FOR ALL USING ('admin' = ANY(public.get_auth_roles()) AND tenant_id = public.get_auth_tenant_id());

-- CUSTOMERS
CREATE POLICY "customers_access_v5" ON public.customers
  FOR ALL USING (
    tenant_id = public.get_auth_tenant_id() 
    AND (
      'admin' = ANY(public.get_auth_roles()) OR 
      'supervisor' = ANY(public.get_auth_roles()) OR 
      assigned_seller_id = auth.uid()
    )
  );

-- PRODUCTS
CREATE POLICY "products_access_v5" ON public.products
  FOR ALL USING (tenant_id = public.get_auth_tenant_id());

-- ORDERS
CREATE POLICY "orders_access_v5" ON public.orders
  FOR ALL USING (
    tenant_id = public.get_auth_tenant_id()
    AND (
      'admin' = ANY(public.get_auth_roles()) OR
      'supervisor' = ANY(public.get_auth_roles()) OR
      seller_id = auth.uid()
    )
  );

-- ORDER_ITEMS
CREATE POLICY "order_items_access_v5" ON public.order_items
  FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.orders 
        WHERE orders.id = order_items.order_id 
        AND orders.tenant_id = public.get_auth_tenant_id()
    )
  );

-- ============================================================
-- 5. ACTUALIZAR TRIGGERS (LÓGICA HIERRO)
-- ============================================================

-- handle_new_user: Robusto a fallos de metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_tenant_id uuid;
  v_roles text[];
BEGIN
  BEGIN
    v_tenant_id := (NEW.raw_user_meta_data->>'tenant_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_tenant_id := NULL;
  END;

  IF (NEW.raw_user_meta_data->'roles') IS NOT NULL AND jsonb_typeof(NEW.raw_user_meta_data->'roles') = 'array' THEN
    SELECT array_agg(x)::text[] INTO v_roles FROM jsonb_array_elements_text(NEW.raw_user_meta_data->'roles') x;
  ELSE
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

-- sync_user_status_and_login
CREATE OR REPLACE FUNCTION public.sync_user_status_and_login()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
BEGIN
    UPDATE public.user_profiles
    SET 
        email = NEW.email,
        last_login_at = NEW.last_sign_in_at,
        is_active = CASE WHEN NEW.banned_until IS NOT NULL THEN FALSE ELSE is_active END
    WHERE id = NEW.id;
    RETURN NEW;
END; $$;

-- Asegurar el trigger principal
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMIT;
