-- =============================================================================
-- TEXTO ORIGINAL (pre-F0) de los objetos que tocan las migraciones 0a/0b/0c/0d.
-- Copia LITERAL de las migraciones previas. Es la fuente de verdad para los .down.sql.
-- NO ejecutar este archivo entero: copiar el bloque que se necesite.
-- Verificado (rg) que no hay redefiniciones posteriores a las migraciones citadas.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- [1] get_auth_tenant_id()  y  [2] get_auth_roles()
-- Origen: supabase/migrations/20260317085921_critical_rl_recovery.sql (lineas 16-33)
-- Nota: version PRE-F0 lee SOLO user_metadata y devuelve 'vendedor' por defecto (H1).
-- Rollback 0a/0d: restaura exactamente esto.
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- [3] Policy user_profiles_select_policy_v3
-- Origen: supabase/migrations/20260317085921_critical_rl_recovery.sql (lineas 37-43)
-- Rollback 0a: DROP de la version nueva + recrear esta.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "user_profiles_select_policy_v3" ON public.user_profiles;
CREATE POLICY "user_profiles_select_policy_v3" ON public.user_profiles
FOR SELECT TO authenticated
USING (
    id = auth.uid()
    OR tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid
);


-- -----------------------------------------------------------------------------
-- [4] handle_new_user()  + trigger on_auth_user_created
-- Origen: supabase/migrations/20260504173000_fix_user_creation_trigger_and_healing.sql (lineas 5-49)
-- Nota: version PRE-F0 confia en raw_user_meta_data (roles/tenant_id): es el agujero a cerrar.
-- Rollback 0b: restaura esto + UPDATE public.tenants SET store_enabled = false;
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- [5] create_direct_order_atomic(...)
-- Origen: supabase/migrations/20260612100000_sequential_order_numbers.sql (lineas 110-170)
-- Nota: version PRE-F0 confia en p_tenant_id / p_seller_id del cliente (H4), sin search_path.
-- Rollback 0c (no recomendado): restaura esto.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_direct_order_atomic(
    p_tenant_id       UUID,
    p_customer_id     UUID,
    p_seller_id       UUID,
    p_subtotal        DECIMAL,
    p_discount_type   TEXT,
    p_discount_amount DECIMAL,
    p_total_amount    DECIMAL,
    p_notes           TEXT,
    p_items           JSONB
)
RETURNS TABLE(order_id UUID, order_number TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_id     UUID;
    v_order_number TEXT;
    v_item         JSONB;
BEGIN
    -- Limpiar borradores previos del mismo vendedor+cliente (evita duplicidad)
    DELETE FROM public.orders
    WHERE customer_id = p_customer_id
      AND seller_id   = p_seller_id
      AND status      = 'Draft';

    -- Generar número correlativo atómico
    v_order_number := public.next_order_number();

    -- Insertar cabecera del pedido
    INSERT INTO public.orders (
        tenant_id, order_number, customer_id, seller_id,
        status, subtotal, discount_type, discount_amount, total_amount, notes
    ) VALUES (
        p_tenant_id, v_order_number, p_customer_id, p_seller_id,
        'Approved', p_subtotal, p_discount_type, p_discount_amount, p_total_amount, p_notes
    )
    RETURNING id INTO v_order_id;

    -- Insertar items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        INSERT INTO public.order_items (
            order_id, product_id, quantity, unit_price, total_price,
            notes, discount_type, discount_amount
        ) VALUES (
            v_order_id,
            (v_item->>'product_id')::UUID,
            (v_item->>'quantity')::INTEGER,
            (v_item->>'unit_price')::DECIMAL,
            (v_item->>'total_price')::DECIMAL,
            v_item->>'notes',
            v_item->>'discount_type',
            (v_item->>'discount_amount')::DECIMAL
        );
    END LOOP;

    RETURN QUERY SELECT v_order_id, v_order_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_direct_order_atomic(UUID, UUID, UUID, DECIMAL, TEXT, DECIMAL, DECIMAL, TEXT, JSONB) TO authenticated;


-- -----------------------------------------------------------------------------
-- [6] confirm_order_atomic(...)
-- Origen: supabase/migrations/20260625000000_confirm_order_for_update_lock.sql (lineas 11-80)
-- Nota: version PRE-F0 NO valida el tenant del pedido (H4), sin search_path.
-- Rollback 0c (no recomendado): restaura esto.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_order_atomic(
    p_order_id        UUID,
    p_subtotal        DECIMAL,
    p_discount_type   TEXT,
    p_discount_amount DECIMAL,
    p_total_amount    DECIMAL,
    p_notes           TEXT,
    p_items           JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item         JSONB;
    v_draft_number TEXT;
    v_order_number TEXT;
BEGIN
    -- FOR UPDATE bloquea el row: si dos transacciones llegan al mismo tiempo,
    -- la segunda espera hasta que la primera haga COMMIT. Al liberarse el lock,
    -- la segunda lee status='Approved' y falla limpiamente.
    SELECT order_number INTO v_draft_number
    FROM public.orders
    WHERE id = p_order_id AND status = 'Draft'
    FOR UPDATE;

    IF v_draft_number IS NULL THEN
        RAISE EXCEPTION 'El pedido ya no es un borrador o no existe.';
    END IF;

    -- Convertir prefijo: DRAFT-YYYYMMDD-NNNN → PED-YYYYMMDD-NNNN
    v_order_number := replace(v_draft_number, 'DRAFT-', 'PED-');

    -- Limpiar items previos
    DELETE FROM public.order_items WHERE order_id = p_order_id;

    -- Insertar items definitivos
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        INSERT INTO public.order_items (
            order_id, product_id, quantity, unit_price, total_price,
            notes, discount_type, discount_amount
        ) VALUES (
            p_order_id,
            (v_item->>'product_id')::UUID,
            (v_item->>'quantity')::INTEGER,
            (v_item->>'unit_price')::DECIMAL,
            (v_item->>'total_price')::DECIMAL,
            v_item->>'notes',
            v_item->>'discount_type',
            (v_item->>'discount_amount')::DECIMAL
        );
    END LOOP;

    -- Promover a Approved actualizando el prefijo en order_number
    UPDATE public.orders SET
        status          = 'Approved',
        order_number    = v_order_number,
        subtotal        = p_subtotal,
        discount_type   = p_discount_type,
        discount_amount = p_discount_amount,
        total_amount    = p_total_amount,
        notes           = p_notes,
        created_at      = now()
    WHERE id = p_order_id;

    RETURN v_order_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_order_atomic(UUID, DECIMAL, TEXT, DECIMAL, DECIMAL, TEXT, JSONB) TO authenticated;
