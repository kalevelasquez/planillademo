-- =============================================================================
-- F0 / 0c - Blindaje de RPCs SECURITY DEFINER (change: tienda-web-clientes, A2.2)
--
-- PROBLEMA (hallazgo H4 + auditoria estatica A0.4, ver design.md):
--   Varias funciones SECURITY DEFINER confian en parametros del caller (p_tenant_id,
--   p_seller_id, p_user_id, p_roles) o no validan el tenant, y Postgres da EXECUTE a PUBLIC
--   por defecto. Con la tienda web habra usuarios `authenticated` que NO son personal
--   interno (clientes): podrian leer BI de otro tenant, crear/confirmar pedidos ajenos,
--   inyectar notificaciones, resembrar permisos o ensuciar la telemetria.
--
-- SOLUCION:
--   * Helper assert_internal_user(p_tenant_id): exige sesion + tenant de las claims +
--     user_profiles activo de ESE tenant (un cliente de tienda no tiene perfil) y, si se
--     pasa p_tenant_id, que coincida con el tenant de las claims. Devuelve el tenant.
--   * create_direct_order_atomic / confirm_order_atomic / get_report_* / get_dashboard_metrics
--     / get_sales_trend / sync_inventory_catalog / next_order_number: usan el helper y
--     permisos has_permission(); mismas firmas (el front no cambia). p_tenant_id solo se
--     VALIDA contra las claims; p_user_id/p_roles del dashboard se IGNORAN (se derivan de
--     las claims).
--   * fn_crear_notificacion, fn_notificar_preparador_y_admins_planilla,
--     seed_default_permissions: REVOKE EXECUTE a PUBLIC/anon/authenticated (solo las llaman
--     funciones SECURITY DEFINER / triggers que corren como owner; la autoverificacion
--     comprueba que NINGUNA funcion INVOKER las referencia).
--   * fn_notificar_aprobadores_planilla: la llama enviar_a_aprobacion, que es INVOKER
--     (corre como `authenticated`), asi que se conserva EXECUTE para authenticated pero se
--     revoca a anon/PUBLIC y se agrega guard de tenant (p_tenant_id = claims).
--   * log_tech_error: sigue abierta a anon (errores pre-login) pero ignora p_tenant_id:
--     con sesion usa el tenant de las claims, sin sesion guarda NULL.
--   * increment_error_metrics: usa el tenant de las claims (ignora p_tenant_id salvo
--     service_role); revocada a anon.
--   * revoke_user_sessions(uuid): NUEVA, solo service_role. La usa la edge function
--     manage-users (TOGGLE_ACTIVE) porque auth.admin.signOut(jwt) NO acepta un user id.
--
-- AUTOVERIFICACION: catalogo (existencia, DEFINER, search_path, privilegios, marcadores de
-- guard, sin sobrecargas, sin llamadores INVOKER de funciones revocadas) y comportamiento
-- (JWT simulados, SET LOCAL ROLE) dentro de un sub-bloque con excepcion centinela: no deja
-- filas ni side effects (a proposito NO ejecuta rutas que consumen la secuencia de pedidos).
-- Cualquier fallo => RAISE EXCEPTION => rollback total (la BD queda como estaba).
--
-- Timestamp posterior a la ultima migracion aplicada (20261128100000). 0d debe ir DESPUES.
-- Rollback: supabase/rollback/20261129090000_blindar_rpcs_definer.down.sql
-- =============================================================================

BEGIN;

-- >>> IMPLEMENTACION (la prueba RED corre solo desde "AUTOVERIFICACION" en adelante)

-- -----------------------------------------------------------------------------
-- 1. Helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_internal_user(p_tenant_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'c0_guard: sesion requerida' USING ERRCODE = '42501';
  END IF;

  v_tenant := public.get_auth_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'c0_guard: usuario sin tenant' USING ERRCODE = '42501';
  END IF;

  -- Personal interno ACTIVO del mismo tenant de las claims (un cliente de tienda no tiene perfil)
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles p
     WHERE p.id = v_uid AND p.tenant_id = v_tenant AND coalesce(p.is_active, true)
  ) THEN
    RAISE EXCEPTION 'c0_guard: no es un usuario interno activo' USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NOT NULL AND p_tenant_id <> v_tenant THEN
    RAISE EXCEPTION 'c0_guard: tenant no coincide con la sesion' USING ERRCODE = '42501';
  END IF;

  RETURN v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_internal_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_internal_user(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- 2. next_order_number (la llaman el front y create_direct_order_atomic)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_order_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_seq BIGINT;
BEGIN
    PERFORM public.assert_internal_user();
    v_seq := nextval('public.order_number_seq');
    -- lpad garantiza minimo 4 digitos; si supera 9999 crece naturalmente
    RETURN 'PED-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' || lpad(v_seq::TEXT, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_order_number() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_order_number() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. create_direct_order_atomic (mismas firma y comportamiento para el personal legitimo)
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
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant       UUID;
    v_order_id     UUID;
    v_order_number TEXT;
    v_item         JSONB;
BEGIN
    -- p_tenant_id solo se VALIDA contra las claims (nunca se confia en el)
    v_tenant := public.assert_internal_user(p_tenant_id);

    IF NOT public.has_permission('pedidos', 'create') THEN
        RAISE EXCEPTION 'c0_guard: sin permiso pedidos.create' USING ERRCODE = '42501';
    END IF;

    -- vendedor y cliente deben ser del tenant del caller
    IF NOT EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = p_seller_id AND up.tenant_id = v_tenant) THEN
        RAISE EXCEPTION 'c0_guard: el vendedor no pertenece al tenant' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = p_customer_id AND c.tenant_id = v_tenant) THEN
        RAISE EXCEPTION 'c0_guard: el cliente no pertenece al tenant' USING ERRCODE = '42501';
    END IF;

    -- todos los productos del pedido deben ser del tenant (evita descontar stock ajeno)
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION 'c0_guard: p_items debe ser un arreglo' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) i
          LEFT JOIN public.products p ON p.id = (i ->> 'product_id')::uuid AND p.tenant_id = v_tenant
         WHERE p.id IS NULL
    ) THEN
        RAISE EXCEPTION 'c0_guard: hay productos que no pertenecen al tenant' USING ERRCODE = '42501';
    END IF;

    -- Limpiar borradores previos del mismo vendedor+cliente (evita duplicidad)
    DELETE FROM public.orders
    WHERE customer_id = p_customer_id
      AND seller_id   = p_seller_id
      AND tenant_id   = v_tenant
      AND status      = 'Draft';

    -- Generar numero correlativo atomico
    v_order_number := public.next_order_number();

    -- Insertar cabecera del pedido
    INSERT INTO public.orders (
        tenant_id, order_number, customer_id, seller_id,
        status, subtotal, discount_type, discount_amount, total_amount, notes
    ) VALUES (
        v_tenant, v_order_number, p_customer_id, p_seller_id,
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

REVOKE ALL ON FUNCTION public.create_direct_order_atomic(UUID, UUID, UUID, DECIMAL, TEXT, DECIMAL, DECIMAL, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_direct_order_atomic(UUID, UUID, UUID, DECIMAL, TEXT, DECIMAL, DECIMAL, TEXT, JSONB) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. confirm_order_atomic (el borrador debe ser del tenant del caller)
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
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant       UUID;
    v_item         JSONB;
    v_draft_number TEXT;
    v_draft_seller UUID;
    v_order_number TEXT;
BEGIN
    v_tenant := public.assert_internal_user();

    -- FOR UPDATE bloquea el row: si dos transacciones llegan al mismo tiempo,
    -- la segunda espera hasta que la primera haga COMMIT. Al liberarse el lock,
    -- la segunda lee status='Approved' y falla limpiamente.
    -- El filtro de tenant hace que un borrador ajeno sea indistinguible de uno inexistente.
    SELECT order_number, seller_id INTO v_draft_number, v_draft_seller
    FROM public.orders
    WHERE id = p_order_id AND status = 'Draft' AND tenant_id = v_tenant
    FOR UPDATE;

    IF v_draft_number IS NULL THEN
        RAISE EXCEPTION 'El pedido ya no es un borrador o no existe.';
    END IF;

    -- Solo el dueno del borrador, o quien puede editar pedidos
    IF v_draft_seller IS DISTINCT FROM auth.uid() AND NOT public.has_permission('pedidos', 'edit') THEN
        RAISE EXCEPTION 'c0_guard: sin permiso para confirmar este borrador' USING ERRCODE = '42501';
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION 'c0_guard: p_items debe ser un arreglo' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) i
          LEFT JOIN public.products p ON p.id = (i ->> 'product_id')::uuid AND p.tenant_id = v_tenant
         WHERE p.id IS NULL
    ) THEN
        RAISE EXCEPTION 'c0_guard: hay productos que no pertenecen al tenant' USING ERRCODE = '42501';
    END IF;

    -- Convertir prefijo: DRAFT-YYYYMMDD-NNNN -> PED-YYYYMMDD-NNNN
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
    WHERE id = p_order_id AND tenant_id = v_tenant;

    RETURN v_order_number;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_order_atomic(UUID, DECIMAL, TEXT, DECIMAL, DECIMAL, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_order_atomic(UUID, DECIMAL, TEXT, DECIMAL, DECIMAL, TEXT, JSONB) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Reportes BI (tenant de las claims + permiso reportes.view)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_report_sellers(
    p_tenant_id UUID,
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result JSONB;
    v_tenant UUID;
BEGIN
    v_tenant := public.assert_internal_user(p_tenant_id);
    IF NOT public.has_permission('reportes', 'view') THEN
        RAISE EXCEPTION 'c0_guard: sin permiso reportes.view' USING ERRCODE = '42501';
    END IF;

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
        WHERE up.tenant_id = v_tenant
        GROUP BY up.id, up.full_name
        HAVING COUNT(o.id) > 0 OR up.role && ARRAY['admin', 'supervisor', 'vendedor']::TEXT[]
        ORDER BY total_sales DESC
    ) t;
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_report_products(
    p_tenant_id UUID,
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result JSONB;
    v_tenant UUID;
BEGIN
    v_tenant := public.assert_internal_user(p_tenant_id);
    IF NOT public.has_permission('reportes', 'view') THEN
        RAISE EXCEPTION 'c0_guard: sin permiso reportes.view' USING ERRCODE = '42501';
    END IF;

    SELECT jsonb_agg(t) INTO v_result
    FROM (
        SELECT
            p.id as product_id,
            p.name as product_name,
            COALESCE(pc.name, 'Sin categoría') as category,
            COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.quantity ELSE 0 END), 0) as total_quantity,
            COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.total_price ELSE 0 END), 0) as total_revenue,
            COUNT(DISTINCT o.id) as orders_count
        FROM public.products p
        LEFT JOIN public.product_categories pc ON p.category_id = pc.id
        LEFT JOIN public.order_items oi ON p.id = oi.product_id
        LEFT JOIN public.orders o ON oi.order_id = o.id
              AND o.created_at >= p_start_date
              AND o.created_at <= p_end_date
              AND o.status NOT IN ('borrador', 'cancelado', 'Draft', 'Cancelled')
        WHERE p.tenant_id = v_tenant
        GROUP BY p.id, p.name, pc.name
        ORDER BY total_quantity DESC
    ) t;
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_report_customers(
    p_tenant_id UUID,
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result JSONB;
    v_tenant UUID;
BEGIN
    v_tenant := public.assert_internal_user(p_tenant_id);
    IF NOT public.has_permission('reportes', 'view') THEN
        RAISE EXCEPTION 'c0_guard: sin permiso reportes.view' USING ERRCODE = '42501';
    END IF;

    SELECT jsonb_agg(t) INTO v_result
    FROM (
        SELECT
            c.id as customer_id,
            c.business_name,
            COUNT(o.id) as total_orders,
            COALESCE(SUM(o.total_amount), 0) as accumulated_amount,
            MAX(o.created_at) as last_order_at,
            CASE
                WHEN MAX(o.created_at) < (NOW() - INTERVAL '30 days') THEN true
                WHEN MAX(o.created_at) IS NULL THEN true
                ELSE false
            END as is_inactive,
            ROUND(COUNT(o.id)::numeric / NULLIF(EXTRACT(EPOCH FROM (p_end_date - p_start_date)) / 2592000, 0)::numeric, 2) as monthly_frequency
        FROM public.customers c
        LEFT JOIN public.orders o ON c.id = o.customer_id
              AND o.created_at >= p_start_date
              AND o.created_at <= p_end_date
              AND o.status NOT IN ('borrador', 'cancelado', 'Draft', 'Cancelled')
        WHERE c.tenant_id = v_tenant AND c.deleted_at IS NULL
        GROUP BY c.id, c.business_name
        ORDER BY accumulated_amount DESC
    ) t;
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_report_sellers(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_report_products(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_report_customers(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_report_sellers(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_products(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_customers(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Dashboard y tendencia: tenant, usuario y roles salen de las claims
--    (p_user_id y p_roles se conservan en la firma por compatibilidad, pero se IGNORAN)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(
    p_tenant_id UUID,
    p_user_id UUID,
    p_roles TEXT[],
    p_start_today TIMESTAMPTZ,
    p_end_today TIMESTAMPTZ,
    p_start_yesterday TIMESTAMPTZ,
    p_end_yesterday TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant UUID;
    v_uid UUID := auth.uid();
    v_is_admin BOOLEAN;
    v_t_sales NUMERIC := 0; v_t_count INT := 0;
    v_y_sales NUMERIC := 0; v_y_count INT := 0;
    v_pending INT := 0;
    v_top_prod JSONB; v_top_cust JSONB;
BEGIN
    v_tenant := public.assert_internal_user(p_tenant_id);
    v_is_admin := ('admin' = ANY(public.get_auth_roles())) OR ('supervisor' = ANY(public.get_auth_roles()));

    -- 1. Metricas de Hoy
    SELECT COALESCE(SUM(total_amount), 0), COUNT(id)
    INTO v_t_sales, v_t_count
    FROM public.orders
    WHERE tenant_id = v_tenant AND created_at BETWEEN p_start_today AND p_end_today
      AND status != 'Draft' AND (v_is_admin OR seller_id = v_uid);

    -- 2. Metricas de Ayer (Comparativa)
    SELECT COALESCE(SUM(total_amount), 0), COUNT(id)
    INTO v_y_sales, v_y_count
    FROM public.orders
    WHERE tenant_id = v_tenant AND created_at BETWEEN p_start_yesterday AND p_end_yesterday
      AND status != 'Draft' AND (v_is_admin OR seller_id = v_uid);

    -- 3. Pedidos Pendientes (Snapshot actual)
    SELECT COUNT(id) INTO v_pending FROM public.orders
    WHERE tenant_id = v_tenant AND status IN ('Approved', 'In Preparation')
      AND (v_is_admin OR seller_id = v_uid);

    -- 4. Top 5 Productos Hoy
    SELECT jsonb_agg(t) INTO v_top_prod FROM (
        SELECT p.name, SUM(oi.quantity) as quantity, SUM(oi.total_price) as total
        FROM public.order_items oi
        JOIN public.products p ON oi.product_id = p.id
        JOIN public.orders o ON oi.order_id = o.id
        WHERE o.tenant_id = v_tenant AND o.created_at BETWEEN p_start_today AND p_end_today
          AND o.status != 'Draft' AND (v_is_admin OR o.seller_id = v_uid)
        GROUP BY p.name ORDER BY total DESC LIMIT 5
    ) t;

    -- 5. Top 5 Clientes Hoy
    SELECT jsonb_agg(t) INTO v_top_cust FROM (
        SELECT c.business_name as name, SUM(o.total_amount) as total, COUNT(o.id) as orders_count
        FROM public.orders o
        JOIN public.customers c ON o.customer_id = c.id
        WHERE o.tenant_id = v_tenant AND o.created_at BETWEEN p_start_today AND p_end_today
          AND o.status != 'Draft' AND (v_is_admin OR o.seller_id = v_uid)
        GROUP BY c.business_name ORDER BY total DESC LIMIT 5
    ) t;

    -- 6. Resultado con calculo de tendencia normalizado
    RETURN jsonb_build_object(
        'today', jsonb_build_object(
            'total_sales', v_t_sales,
            'orders_count', v_t_count,
            'pending_orders', v_pending
        ),
        'comparison', jsonb_build_object(
            'previous_sales', v_y_sales,
            'previous_orders', v_y_count,
            'sales_trend', CASE
                WHEN v_y_sales = 0 THEN (CASE WHEN v_t_sales > 0 THEN 100 ELSE 0 END)
                ELSE ((v_t_sales - v_y_sales) / v_y_sales) * 100
            END,
            'orders_trend', CASE
                WHEN v_y_count = 0 THEN (CASE WHEN v_t_count > 0 THEN 100 ELSE 0 END)
                ELSE ((v_t_count - v_y_count)::numeric / v_y_count) * 100
            END
        ),
        'top_products', COALESCE(v_top_prod, '[]'::jsonb),
        'top_customers', COALESCE(v_top_cust, '[]'::jsonb)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sales_trend(
    p_tenant_id UUID,
    p_user_id UUID,
    p_roles TEXT[],
    p_days INT -- Generalmente 7, 30 o 90
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant UUID;
    v_uid UUID := auth.uid();
    v_is_admin BOOLEAN;
    v_timezone TEXT := '-06:00'; -- Zona horaria de El Salvador/Centroamerica
    v_result JSONB;
BEGIN
    v_tenant := public.assert_internal_user(p_tenant_id);
    v_is_admin := ('admin' = ANY(public.get_auth_roles())) OR ('supervisor' = ANY(public.get_auth_roles()));

    WITH RECURSIVE day_series AS (
        -- Generamos la serie de fechas para el periodo actual
        SELECT (CURRENT_DATE AT TIME ZONE v_timezone)::date - (p_days - 1) as day_date, 0 as idx
        UNION ALL
        SELECT (day_date + 1)::date, idx + 1
        FROM day_series
        WHERE idx < (p_days - 1)
    ),
    orders_data AS (
        -- Pedidos de ambos periodos (Actual y Espejo) de una sola vez
        SELECT
            (created_at AT TIME ZONE 'UTC' AT TIME ZONE v_timezone)::date as order_date,
            total_amount
        FROM public.orders
        WHERE tenant_id = v_tenant
          AND status NOT IN ('Draft', 'Cancelled')
          AND created_at >= (CURRENT_DATE AT TIME ZONE 'UTC' AT TIME ZONE v_timezone)::date - (2 * p_days - 1)
          AND (v_is_admin OR seller_id = v_uid)
    ),
    current_agg AS (
        SELECT order_date, SUM(total_amount) as total
        FROM orders_data
        WHERE order_date >= (CURRENT_DATE AT TIME ZONE 'UTC' AT TIME ZONE v_timezone)::date - (p_days - 1)
        GROUP BY 1
    ),
    previous_agg AS (
        SELECT (order_date + p_days)::date as matching_date, SUM(total_amount) as total
        FROM orders_data
        WHERE order_date < (CURRENT_DATE AT TIME ZONE 'UTC' AT TIME ZONE v_timezone)::date - (p_days - 1)
        GROUP BY 1
    )
    SELECT jsonb_agg(jsonb_build_object(
        'fullDate', ds.day_date::text,
        'label', to_char(ds.day_date, 'DD Mon'), -- Formato ej: "18 Mar"
        'current', COALESCE(ca.total, 0),
        'previous', COALESCE(pa.total, 0)
    )) INTO v_result
    FROM day_series ds
    LEFT JOIN current_agg ca ON ds.day_date = ca.order_date
    LEFT JOIN previous_agg pa ON ds.day_date = pa.matching_date;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_metrics(UUID, UUID, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_sales_trend(UUID, UUID, TEXT[], INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics(UUID, UUID, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sales_trend(UUID, UUID, TEXT[], INT) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. sync_inventory_catalog (borra/desactiva productos: tenant propio + inventario.edit)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_inventory_catalog(
    p_tenant_id UUID,
    p_import_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Ejecuta con privilegios administrativos para permitir DELETE donde RLS sea restrictivo
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant UUID;
    v_deleted_count INTEGER := 0;
    v_deactivated_count INTEGER := 0;
BEGIN
    v_tenant := public.assert_internal_user(p_tenant_id);
    IF NOT public.has_permission('inventario', 'edit') THEN
        RAISE EXCEPTION 'c0_guard: sin permiso inventario.edit' USING ERRCODE = '42501';
    END IF;

    -- Validar integridad: El import debe pertenecer al tenant del caller
    IF NOT EXISTS (SELECT 1 FROM public.inventory_imports WHERE id = p_import_id AND tenant_id = v_tenant) THEN
        RAISE EXCEPTION 'Operación no autorizada: ID de importación inválido para este Tenant.';
    END IF;

    -- A. DELETE: Borrado fisico de productos sin historial
    DELETE FROM public.products
    WHERE tenant_id = v_tenant
      AND status = 'active'
      AND (last_import_id IS NULL OR last_import_id != p_import_id)
      AND id NOT IN (SELECT DISTINCT product_id FROM public.order_items);

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    -- B. SOFT DELETE: 'unavailable' para productos con historial
    UPDATE public.products
    SET status = 'unavailable'
    WHERE tenant_id = v_tenant
      AND status = 'active'
      AND (last_import_id IS NULL OR last_import_id != p_import_id);

    GET DIAGNOSTICS v_deactivated_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_count', v_deleted_count,
        'deactivated_count', v_deactivated_count,
        'timestamp', now()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_inventory_catalog(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_inventory_catalog(UUID, UUID) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. Notificaciones: fn_crear_notificacion y fn_notificar_preparador_* solo desde funciones
--    DEFINER; fn_notificar_aprobadores_* se conserva para authenticated (la llama
--    enviar_a_aprobacion, que es INVOKER) pero con guard de tenant.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_notificar_aprobadores_planilla(
    p_tenant_id UUID, p_tipo TEXT, p_titulo TEXT, p_mensaje TEXT, p_referencia_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_usuario_id UUID;
BEGIN
    -- Con sesion de usuario, solo se notifica dentro del propio tenant.
    -- Sin sesion de usuario (migraciones, service_role) no se restringe.
    IF auth.uid() IS NOT NULL AND coalesce(auth.role(), '') <> 'service_role'
       AND p_tenant_id IS DISTINCT FROM public.get_auth_tenant_id() THEN
        RAISE EXCEPTION 'c0_guard: tenant no coincide con la sesion' USING ERRCODE = '42501';
    END IF;

    -- CA2: Aprobadores + Admin (copia), una sola query
    FOR v_usuario_id IN
        SELECT id FROM public.user_profiles
        WHERE tenant_id = p_tenant_id AND is_active
          AND (role && ARRAY['aprobador_planilla', 'admin'])
    LOOP
        PERFORM public.fn_crear_notificacion(p_tenant_id, v_usuario_id, p_tipo, p_titulo, p_mensaje, p_referencia_id);
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_notificar_preparador_y_admins_planilla(
    p_tenant_id UUID, p_preparador_id UUID, p_tipo TEXT, p_titulo TEXT, p_mensaje TEXT, p_referencia_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_usuario_id UUID;
BEGIN
    IF auth.uid() IS NOT NULL AND coalesce(auth.role(), '') <> 'service_role'
       AND p_tenant_id IS DISTINCT FROM public.get_auth_tenant_id() THEN
        RAISE EXCEPTION 'c0_guard: tenant no coincide con la sesion' USING ERRCODE = '42501';
    END IF;

    FOR v_usuario_id IN
        SELECT id FROM public.user_profiles
        WHERE tenant_id = p_tenant_id AND is_active
          AND (id = p_preparador_id OR 'admin' = ANY(role))
    LOOP
        PERFORM public.fn_crear_notificacion(p_tenant_id, v_usuario_id, p_tipo, p_titulo, p_mensaje, p_referencia_id);
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_crear_notificacion(UUID, UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_notificar_preparador_y_admins_planilla(UUID, UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_notificar_aprobadores_planilla(UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crear_notificacion(UUID, UUID, TEXT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_notificar_preparador_y_admins_planilla(UUID, UUID, TEXT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_notificar_aprobadores_planilla(UUID, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. seed_default_permissions: solo la llama el trigger de tenants (DEFINER)
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.seed_default_permissions(UUID) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.seed_default_permissions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_permissions(UUID) TO service_role;

-- -----------------------------------------------------------------------------
-- 10. Telemetria: tenant siempre de las claims
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_tech_error(
    p_message TEXT,
    p_stack TEXT DEFAULT NULL,
    p_context JSONB DEFAULT NULL,
    p_tenant_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant UUID;
BEGIN
    -- p_tenant_id del caller NO se usa con sesion de usuario; anon => NULL
    IF auth.uid() IS NOT NULL THEN
        v_tenant := public.get_auth_tenant_id();
    ELSIF coalesce(auth.role(), '') = 'service_role' THEN
        v_tenant := p_tenant_id;
    ELSE
        v_tenant := NULL;
    END IF;

    INSERT INTO public.tech_errors (tenant_id, user_id, message, stack, context)
    VALUES (v_tenant, auth.uid(), left(p_message, 2000), left(p_stack, 8000), p_context);
END;
$$;

REVOKE ALL ON FUNCTION public.log_tech_error(TEXT, TEXT, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_tech_error(TEXT, TEXT, JSONB, UUID) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.increment_error_metrics(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_hour   TIMESTAMPTZ := date_trunc('hour', now());
    v_tenant UUID;
BEGIN
    -- Tenant de las claims (p_tenant_id solo vale para service_role). Sin tenant: no-op
    -- (lo invoca el logger de errores: nunca debe generar mas errores).
    IF auth.uid() IS NOT NULL THEN
        v_tenant := public.get_auth_tenant_id();
    ELSIF coalesce(auth.role(), '') = 'service_role' THEN
        v_tenant := p_tenant_id;
    END IF;

    IF v_tenant IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO public.error_stats (tenant_id, hour_timestamp, error_count)
    VALUES (v_tenant, v_hour, 1)
    ON CONFLICT (tenant_id, hour_timestamp)
    DO UPDATE SET
        error_count = public.error_stats.error_count + 1,
        created_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.increment_error_metrics(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_error_metrics(UUID) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 11. revoke_user_sessions: la usa la edge function manage-users (TOGGLE_ACTIVE).
--     auth.admin.signOut() de supabase-js recibe un JWT, no un user id.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_user_sessions(p_user_id UUID)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_n integer;
BEGIN
    -- auth.sessions -> auth.refresh_tokens en cascada: el usuario ya no puede renovar el JWT
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_user_sessions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_sessions(UUID) TO service_role;

-- <<< IMPLEMENTACION

-- -----------------------------------------------------------------------------
-- AUTOVERIFICACION A: catalogo (cualquier fallo => rollback total)
-- -----------------------------------------------------------------------------
DO $verify_catalog$
DECLARE
  r        record;
  v_oid    oid;
  v_def    text;
  v_names  text;
  n        int;
  c_hard   CONSTANT text[] := ARRAY[
    'assert_internal_user', 'next_order_number', 'create_direct_order_atomic', 'confirm_order_atomic',
    'get_report_sellers', 'get_report_products', 'get_report_customers', 'get_dashboard_metrics',
    'get_sales_trend', 'sync_inventory_catalog', 'fn_crear_notificacion',
    'fn_notificar_aprobadores_planilla', 'fn_notificar_preparador_y_admins_planilla',
    'seed_default_permissions', 'log_tech_error', 'increment_error_metrics', 'revoke_user_sessions'];
BEGIN
  -- (sig, anon, authenticated, service_role, marcador que debe aparecer en el cuerpo)
  FOR r IN
    SELECT * FROM (VALUES
      ('public.assert_internal_user(uuid)',                                                false, false, true,  'get_auth_tenant_id'),
      ('public.next_order_number()',                                                       false, true,  true,  'assert_internal_user'),
      ('public.create_direct_order_atomic(uuid,uuid,uuid,numeric,text,numeric,numeric,text,jsonb)', false, true, true, 'assert_internal_user'),
      ('public.confirm_order_atomic(uuid,numeric,text,numeric,numeric,text,jsonb)',        false, true,  true,  'status = ''Draft'' AND tenant_id = v_tenant'),
      ('public.get_report_sellers(uuid,timestamptz,timestamptz)',                          false, true,  true,  'assert_internal_user'),
      ('public.get_report_products(uuid,timestamptz,timestamptz)',                         false, true,  true,  'assert_internal_user'),
      ('public.get_report_customers(uuid,timestamptz,timestamptz)',                        false, true,  true,  'assert_internal_user'),
      ('public.get_dashboard_metrics(uuid,uuid,text[],timestamptz,timestamptz,timestamptz,timestamptz)', false, true, true, 'assert_internal_user'),
      ('public.get_sales_trend(uuid,uuid,text[],integer)',                                 false, true,  true,  'assert_internal_user'),
      ('public.sync_inventory_catalog(uuid,uuid)',                                         false, true,  true,  'assert_internal_user'),
      ('public.fn_crear_notificacion(uuid,uuid,text,text,text,uuid)',                      false, false, true,  NULL),
      ('public.fn_notificar_aprobadores_planilla(uuid,text,text,text,uuid)',               false, true,  true,  'get_auth_tenant_id'),
      ('public.fn_notificar_preparador_y_admins_planilla(uuid,uuid,text,text,text,uuid)',  false, false, true,  'get_auth_tenant_id'),
      ('public.seed_default_permissions(uuid)',                                            false, false, true,  NULL),
      ('public.log_tech_error(text,text,jsonb,uuid)',                                      true,  true,  true,  'v_tenant := public.get_auth_tenant_id()'),
      ('public.increment_error_metrics(uuid)',                                             false, true,  true,  'v_tenant := public.get_auth_tenant_id()'),
      ('public.revoke_user_sessions(uuid)',                                                false, false, true,  'auth.sessions')
    ) AS t(sig, p_anon, p_auth, p_svc, marker)
  LOOP
    v_oid := to_regprocedure(r.sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '0c VERIFY FAIL: no existe %', r.sig;
    END IF;

    -- SECURITY DEFINER + search_path fijo
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid AND p.prosecdef
                      AND coalesce(p.proconfig::text, '') ILIKE '%search_path%') THEN
      RAISE EXCEPTION '0c VERIFY FAIL: % debe ser SECURITY DEFINER con search_path fijo', r.sig;
    END IF;

    -- Privilegios exactos: PUBLIC nunca; anon / authenticated / service_role segun la tabla
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION '0c VERIFY FAIL: % sigue ejecutable por PUBLIC', r.sig;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') <> r.p_anon THEN
      RAISE EXCEPTION '0c VERIFY FAIL: % EXECUTE anon = % (esperado %)', r.sig, has_function_privilege('anon', v_oid, 'EXECUTE'), r.p_anon;
    END IF;
    IF has_function_privilege('authenticated', v_oid, 'EXECUTE') <> r.p_auth THEN
      RAISE EXCEPTION '0c VERIFY FAIL: % EXECUTE authenticated = % (esperado %)', r.sig, has_function_privilege('authenticated', v_oid, 'EXECUTE'), r.p_auth;
    END IF;
    IF has_function_privilege('service_role', v_oid, 'EXECUTE') <> r.p_svc THEN
      RAISE EXCEPTION '0c VERIFY FAIL: % EXECUTE service_role = % (esperado %)', r.sig, has_function_privilege('service_role', v_oid, 'EXECUTE'), r.p_svc;
    END IF;

    -- El cuerpo contiene el guard esperado y no lee la metadata editable por el usuario
    SELECT p.prosrc INTO v_def FROM pg_proc p WHERE p.oid = v_oid;
    IF r.marker IS NOT NULL AND position(r.marker IN v_def) = 0 THEN
      RAISE EXCEPTION '0c VERIFY FAIL: el cuerpo de % no contiene el guard %', r.sig, r.marker;
    END IF;
    IF v_def ILIKE '%user_metadata%' THEN
      RAISE EXCEPTION '0c VERIFY FAIL: % lee user_metadata', r.sig;
    END IF;
  END LOOP;

  -- Las funciones de los tenants/pedidos NO se reescriben con p_tenant_id del caller en el filtro
  FOR r IN
    SELECT p.proname FROM pg_proc p
     WHERE p.oid IN (
       to_regprocedure('public.create_direct_order_atomic(uuid,uuid,uuid,numeric,text,numeric,numeric,text,jsonb)'),
       to_regprocedure('public.get_report_sellers(uuid,timestamptz,timestamptz)'),
       to_regprocedure('public.get_report_products(uuid,timestamptz,timestamptz)'),
       to_regprocedure('public.get_report_customers(uuid,timestamptz,timestamptz)'),
       to_regprocedure('public.get_dashboard_metrics(uuid,uuid,text[],timestamptz,timestamptz,timestamptz,timestamptz)'),
       to_regprocedure('public.get_sales_trend(uuid,uuid,text[],integer)'),
       to_regprocedure('public.sync_inventory_catalog(uuid,uuid)'))
       AND (regexp_replace(p.prosrc, 'assert_internal_user\(p_tenant_id\)', '', 'g')  ~* '(=|<>|!=)\s*p_tenant_id'
         OR regexp_replace(p.prosrc, 'assert_internal_user\(p_tenant_id\)', '', 'g')  ~* 'p_tenant_id\s*(=|<>|!=)')
  LOOP
    RAISE EXCEPTION '0c VERIFY FAIL: % todavia filtra por p_tenant_id del caller', r.proname;
  END LOOP;

  -- Sin sobrecargas de las funciones blindadas (una sobrecarga olvidada seguiria abierta)
  SELECT string_agg(p.oid::regprocedure::text, '; ') INTO v_names
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = ANY (c_hard)
     AND p.proname IN (SELECT proname FROM pg_proc q JOIN pg_namespace nq ON nq.oid = q.pronamespace
                        WHERE nq.nspname = 'public' AND q.proname = ANY (c_hard)
                        GROUP BY q.proname HAVING count(*) > 1);
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION '0c VERIFY FAIL: hay sobrecargas de funciones blindadas (quedarian sin proteger): %', left(v_names, 600);
  END IF;

  -- Ningun llamador INVOKER (corre como `authenticated`) de las funciones que se revocaron:
  -- si existiera, revocar EXECUTE lo romperia. Tambien se revisan policies.
  FOR r IN
    SELECT * FROM (VALUES ('fn_crear_notificacion'), ('fn_notificar_preparador_y_admins_planilla'),
                          ('seed_default_permissions'), ('assert_internal_user'), ('revoke_user_sessions')) t(fname)
  LOOP
    SELECT string_agg(p.oid::regprocedure::text, '; '), count(*) INTO v_names, n
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND NOT p.prosecdef AND p.prokind = 'f'
       AND p.prosrc ILIKE '%' || r.fname || '%';
    IF n > 0 THEN
      RAISE EXCEPTION '0c VERIFY FAIL: funciones INVOKER llaman a % (revocarla las romperia): %', r.fname, left(v_names, 600);
    END IF;

    SELECT count(*) INTO n FROM pg_policies
     WHERE coalesce(qual, '') ILIKE '%' || r.fname || '%' OR coalesce(with_check, '') ILIKE '%' || r.fname || '%';
    IF n > 0 THEN
      RAISE EXCEPTION '0c VERIFY FAIL: % policies usan % (revocarla las romperia)', n, r.fname;
    END IF;
  END LOOP;

  -- Los llamadores de fn_notificar_aprobadores_planilla que SON INVOKER siguen funcionando:
  -- se conserva EXECUTE a authenticated (verificado arriba). Informativo:
  SELECT string_agg(p.proname, ', ') INTO v_names
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND NOT p.prosecdef AND p.prosrc ILIKE '%fn_notificar_aprobadores_planilla%';
  RAISE NOTICE '0c: llamadores INVOKER de fn_notificar_aprobadores_planilla (siguen permitidos): %', coalesce(v_names, '-');

  -- Informativo (no falla): funciones SECURITY DEFINER aun ejecutables por anon/authenticated
  -- que reciben un id de tenant/usuario del caller y NO fueron blindadas aqui.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_names
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prosecdef AND p.prokind = 'f'
     AND p.prorettype <> 'trigger'::regtype
     AND p.proname <> ALL (c_hard)
     AND p.proname NOT LIKE 'store\_%'   -- catalogo publico de la tienda: p_tenant_id es publico a proposito
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     AND (pg_get_function_arguments(p.oid) ~* 'p_(tenant|user|seller)_id');
  IF v_names IS NOT NULL THEN
    RAISE NOTICE '0c: DEFINER ejecutables con p_tenant_id/p_user_id fuera del alcance de 0c (revisar): %', v_names;
  END IF;
END
$verify_catalog$;

-- -----------------------------------------------------------------------------
-- AUTOVERIFICACION B: comportamiento. JWT simulados + SET LOCAL ROLE dentro de un
-- sub-bloque con centinela ZZ001 (todo se deshace). No se ejecutan rutas que consuman la
-- secuencia de pedidos (next_order_number): solo se prueban sus rechazos.
-- Sujeto: un perfil interno real con tenant (si no hay ninguno se omiten los casos que lo
-- necesitan, no los de rechazo).
-- -----------------------------------------------------------------------------
DO $verify_behavior$
DECLARE
  v_fail     text := '';
  v_sub      uuid;
  v_ptenant  uuid;
  v_rand     uuid := gen_random_uuid();
  v_other    uuid := gen_random_uuid();
  v_tenant   uuid;
  v_cases    jsonb;
  v_case     jsonb;
  v_got      text;
  v_ok       boolean;
  v_n        bigint;
  v_stamp    text := 'c0-verify-' || gen_random_uuid()::text;
  c_real     text;
  c_noperm   text;
  c_nouser   text;
  c_anon     CONSTANT text := '{"role": "anon"}';
BEGIN
  SELECT p.id, p.tenant_id INTO v_sub, v_ptenant
    FROM public.user_profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.tenant_id IS NOT NULL AND coalesce(p.is_active, true)
   ORDER BY (('admin' = ANY (p.role))) DESC, p.created_at NULLS LAST
   LIMIT 1;

  v_tenant := coalesce(v_ptenant, gen_random_uuid());   -- distinto de v_other siempre

  -- Claims por escenario
  c_real   := jsonb_build_object('sub', coalesce(v_sub, v_rand), 'role', 'authenticated',
                'app_metadata', jsonb_build_object('tenant_id', v_tenant, 'roles', jsonb_build_array('admin')))::text;
  c_noperm := jsonb_build_object('sub', coalesce(v_sub, v_rand), 'role', 'authenticated',
                'app_metadata', jsonb_build_object('tenant_id', v_tenant, 'roles', jsonb_build_array('zz_c0_sin_permisos')))::text;
  -- cliente de tienda: autenticado, sin perfil, con claims/metadata hostiles apuntando al tenant real
  c_nouser := jsonb_build_object('sub', v_rand, 'role', 'authenticated',
                'app_metadata', jsonb_build_object('tenant_id', v_tenant, 'roles', jsonb_build_array('admin')),
                'user_metadata', jsonb_build_object('tenant_id', v_tenant, 'roles', jsonb_build_array('admin')))::text;

  -- (label, rol de BD, claims, sentencia, patron esperado, soft)
  --   patron NULL  => "allowed": no debe fallar con 42501 ni con c0_guard (otro error => NOTICE)
  --   patron 'x%'  => el resultado ("OK" o "SQLSTATE|mensaje") debe cumplir LIKE
  SELECT jsonb_agg(to_jsonb(t)) INTO v_cases FROM (VALUES
    -- anon: sin EXECUTE
    ('anon create_direct',      'anon', c_anon, format($q$SELECT * FROM public.create_direct_order_atomic(%L::uuid,%L::uuid,%L::uuid,0,NULL,0,0,NULL,'[]'::jsonb)$q$, v_tenant, v_rand, v_rand), '42501|%', false),
    ('anon confirm',            'anon', c_anon, format($q$SELECT public.confirm_order_atomic(%L::uuid,0,NULL,0,0,NULL,'[]'::jsonb)$q$, v_rand), '42501|%', false),
    ('anon reportes',           'anon', c_anon, format($q$SELECT public.get_report_sellers(%L::uuid, now(), now())$q$, v_tenant), '42501|%', false),
    ('anon dashboard',          'anon', c_anon, format($q$SELECT public.get_dashboard_metrics(%L::uuid,%L::uuid,ARRAY['admin'],now(),now(),now(),now())$q$, v_tenant, v_rand), '42501|%', false),
    ('anon sync_inventory',     'anon', c_anon, format($q$SELECT public.sync_inventory_catalog(%L::uuid,%L::uuid)$q$, v_tenant, v_rand), '42501|%', false),
    ('anon next_order_number',  'anon', c_anon, $q$SELECT public.next_order_number()$q$, '42501|%', false),
    ('anon fn_crear_notificacion','anon', c_anon, format($q$SELECT public.fn_crear_notificacion(%L::uuid,%L::uuid,'zz','t','m',NULL)$q$, v_tenant, v_rand), '42501|%', false),
    ('anon increment_error_metrics','anon', c_anon, format($q$SELECT public.increment_error_metrics(%L::uuid)$q$, v_tenant), '42501|%', false),

    -- authenticated sin sub (token sin usuario): rechazado por el helper
    ('sin sub create_direct',   'authenticated', '{"role": "authenticated"}', format($q$SELECT * FROM public.create_direct_order_atomic(%L::uuid,%L::uuid,%L::uuid,0,NULL,0,0,NULL,'[]'::jsonb)$q$, v_tenant, v_rand, v_rand), '42501|c0_guard: sesion requerida', false),

    -- cliente de tienda (authenticated sin perfil, claims hostiles): rechazado por el helper
    ('cliente create_direct',   'authenticated', c_nouser, format($q$SELECT * FROM public.create_direct_order_atomic(%L::uuid,%L::uuid,%L::uuid,0,NULL,0,0,NULL,'[]'::jsonb)$q$, v_tenant, v_rand, v_rand), '42501|c0_guard%', false),
    ('cliente confirm',         'authenticated', c_nouser, format($q$SELECT public.confirm_order_atomic(%L::uuid,0,NULL,0,0,NULL,'[]'::jsonb)$q$, v_rand), '42501|c0_guard%', false),
    ('cliente get_report_sellers','authenticated', c_nouser, format($q$SELECT public.get_report_sellers(%L::uuid, now(), now())$q$, v_tenant), '42501|c0_guard%', false),
    ('cliente get_report_products','authenticated', c_nouser, format($q$SELECT public.get_report_products(%L::uuid, now(), now())$q$, v_tenant), '42501|c0_guard%', false),
    ('cliente get_report_customers','authenticated', c_nouser, format($q$SELECT public.get_report_customers(%L::uuid, now(), now())$q$, v_tenant), '42501|c0_guard%', false),
    ('cliente dashboard',       'authenticated', c_nouser, format($q$SELECT public.get_dashboard_metrics(%L::uuid,%L::uuid,ARRAY['admin'],now(),now(),now(),now())$q$, v_tenant, v_rand), '42501|c0_guard%', false),
    ('cliente sales_trend',     'authenticated', c_nouser, format($q$SELECT public.get_sales_trend(%L::uuid,%L::uuid,ARRAY['admin'],7)$q$, v_tenant, v_rand), '42501|c0_guard%', false),
    ('cliente sync_inventory',  'authenticated', c_nouser, format($q$SELECT public.sync_inventory_catalog(%L::uuid,%L::uuid)$q$, v_tenant, v_rand), '42501|c0_guard%', false),
    ('cliente next_order_number','authenticated', c_nouser, $q$SELECT public.next_order_number()$q$, '42501|c0_guard%', false),
    ('cliente fn_crear_notificacion','authenticated', c_nouser, format($q$SELECT public.fn_crear_notificacion(%L::uuid,%L::uuid,'zz','t','m',NULL)$q$, v_tenant, v_rand), '42501|%', false),
    ('cliente fn_notificar_preparador','authenticated', c_nouser, format($q$SELECT public.fn_notificar_preparador_y_admins_planilla(%L::uuid,%L::uuid,'zz','t','m',NULL)$q$, v_tenant, v_rand), '42501|%', false),
    ('cliente fn_notificar_aprobadores','authenticated', c_nouser, format($q$SELECT public.fn_notificar_aprobadores_planilla(%L::uuid,'zz','t','m',NULL)$q$, v_other), '42501|c0_guard%', false),
    ('cliente seed_default_permissions','authenticated', c_nouser, format($q$SELECT public.seed_default_permissions(%L::uuid)$q$, v_tenant), '42501|%', false),
    ('cliente revoke_user_sessions','authenticated', c_nouser, format($q$SELECT public.revoke_user_sessions(%L::uuid)$q$, v_rand), '42501|%', false),
    ('cliente assert_internal_user','authenticated', c_nouser, $q$SELECT public.assert_internal_user()$q$, '42501|%', false)
  ) AS t(label, role_, claims, stmt, expect_like, soft);

  -- Casos que necesitan un perfil interno real
  IF v_sub IS NOT NULL THEN
    v_cases := v_cases || (SELECT jsonb_agg(to_jsonb(t)) FROM (VALUES
      -- tenant ajeno por parametro: rechazado aunque el usuario sea admin
      ('admin create_direct tenant ajeno', 'authenticated', c_real, format($q$SELECT * FROM public.create_direct_order_atomic(%L::uuid,%L::uuid,%L::uuid,0,NULL,0,0,NULL,'[]'::jsonb)$q$, v_other, v_rand, v_sub), '42501|c0_guard: tenant%', false),
      ('admin reportes tenant ajeno',      'authenticated', c_real, format($q$SELECT public.get_report_customers(%L::uuid, now(), now())$q$, v_other), '42501|c0_guard: tenant%', false),
      ('admin dashboard tenant ajeno',     'authenticated', c_real, format($q$SELECT public.get_dashboard_metrics(%L::uuid,%L::uuid,ARRAY['admin'],now(),now(),now(),now())$q$, v_other, v_sub), '42501|c0_guard: tenant%', false),
      ('admin sales_trend tenant ajeno',   'authenticated', c_real, format($q$SELECT public.get_sales_trend(%L::uuid,%L::uuid,ARRAY['admin'],7)$q$, v_other, v_sub), '42501|c0_guard: tenant%', false),
      ('admin sync_inventory tenant ajeno','authenticated', c_real, format($q$SELECT public.sync_inventory_catalog(%L::uuid,%L::uuid)$q$, v_other, v_rand), '42501|c0_guard: tenant%', false),
      ('admin fn_notificar_aprobadores otro tenant', 'authenticated', c_real, format($q$SELECT public.fn_notificar_aprobadores_planilla(%L::uuid,'zz','t','m',NULL)$q$, v_other), '42501|c0_guard: tenant%', false),
      -- claims de otro tenant con el sub de un admin real: el perfil no coincide con las claims
      ('admin con claims de otro tenant',  'authenticated', jsonb_build_object('sub', v_sub, 'role', 'authenticated', 'app_metadata', jsonb_build_object('tenant_id', v_other, 'roles', jsonb_build_array('admin')))::text,
         format($q$SELECT public.get_report_sellers(%L::uuid, now(), now())$q$, v_other), '42501|c0_guard%', false),
      -- sin permiso (rol sin matriz): rechazado
      ('sin permiso create_direct',        'authenticated', c_noperm, format($q$SELECT * FROM public.create_direct_order_atomic(%L::uuid,%L::uuid,%L::uuid,0,NULL,0,0,NULL,'[]'::jsonb)$q$, v_tenant, v_rand, v_sub), '42501|c0_guard: sin permiso pedidos.create', false),
      ('sin permiso reportes',             'authenticated', c_noperm, format($q$SELECT public.get_report_products(%L::uuid, now(), now())$q$, v_tenant), '42501|c0_guard: sin permiso reportes.view', false),
      ('sin permiso sync_inventory',       'authenticated', c_noperm, format($q$SELECT public.sync_inventory_catalog(%L::uuid,%L::uuid)$q$, v_tenant, v_rand), '42501|c0_guard: sin permiso inventario.edit', false),
      -- create_direct: cliente/vendedor ajenos al tenant
      ('admin create_direct vendedor ajeno','authenticated', c_real, format($q$SELECT * FROM public.create_direct_order_atomic(%L::uuid,%L::uuid,%L::uuid,0,NULL,0,0,NULL,'[]'::jsonb)$q$, v_tenant, v_rand, v_rand), '42501|c0_guard: el vendedor%', false),
      ('admin create_direct cliente ajeno','authenticated', c_real, format($q$SELECT * FROM public.create_direct_order_atomic(%L::uuid,%L::uuid,%L::uuid,0,NULL,0,0,NULL,'[]'::jsonb)$q$, v_tenant, v_rand, v_sub), '42501|c0_guard: el cliente%', false),
      -- confirm: borrador inexistente/ajeno es indistinguible de uno inexistente (mensaje original)
      ('admin confirm borrador inexistente','authenticated', c_real, format($q$SELECT public.confirm_order_atomic(%L::uuid,0,NULL,0,0,NULL,'[]'::jsonb)$q$, v_rand), '%El pedido ya no es un borrador o no existe.', false),
      -- sync_inventory: pasa los guards y cae en la validacion original del import (no borra nada)
      ('admin sync_inventory import invalido','authenticated', c_real, format($q$SELECT public.sync_inventory_catalog(%L::uuid,%L::uuid)$q$, v_tenant, v_rand), '%importación inválido%', true),
      -- rutas legitimas (solo lectura / reversibles): NO deben rechazarse por los guards
      ('admin dashboard',                  'authenticated', c_real, format($q$SELECT public.get_dashboard_metrics(%L::uuid,%L::uuid,ARRAY['admin'],now()-interval '1 day',now(),now()-interval '2 day',now()-interval '1 day')$q$, v_tenant, v_sub), NULL, true),
      ('admin dashboard p_tenant NULL',    'authenticated', c_real, format($q$SELECT public.get_dashboard_metrics(NULL,%L::uuid,ARRAY['admin'],now()-interval '1 day',now(),now()-interval '2 day',now()-interval '1 day')$q$, v_sub), NULL, true),
      ('admin sales_trend',                'authenticated', c_real, format($q$SELECT public.get_sales_trend(%L::uuid,%L::uuid,ARRAY['admin'],7)$q$, v_tenant, v_sub), NULL, true),
      ('admin report sellers',             'authenticated', c_real, format($q$SELECT public.get_report_sellers(%L::uuid, now()-interval '30 day', now())$q$, v_tenant), NULL, true),
      ('admin report products',            'authenticated', c_real, format($q$SELECT public.get_report_products(%L::uuid, now()-interval '30 day', now())$q$, v_tenant), NULL, true),
      ('admin report customers',           'authenticated', c_real, format($q$SELECT public.get_report_customers(%L::uuid, now()-interval '30 day', now())$q$, v_tenant), NULL, true),
      -- el camino de notificaciones SIGUE funcionando para el usuario interno (llama a la
      -- fn_crear_notificacion revocada desde una funcion DEFINER)
      ('admin notificar aprobadores propio tenant','authenticated', c_real, format($q$SELECT public.fn_notificar_aprobadores_planilla(%L::uuid,'zz_c0','t','m',NULL)$q$, v_tenant), NULL, true),
      -- telemetria: el tenant lo manda la sesion
      ('admin log_tech_error con tenant ajeno', 'authenticated', c_real, format($q$SELECT public.log_tech_error(%L, NULL, NULL, %L::uuid)$q$, v_stamp || '-auth', v_other), NULL, true),
      ('admin increment_error_metrics tenant ajeno','authenticated', c_real, format($q$SELECT public.increment_error_metrics(%L::uuid)$q$, v_other), NULL, true)
    ) AS t(label, role_, claims, stmt, expect_like, soft));
  ELSE
    RAISE NOTICE '0c VERIFY: no hay perfiles internos con tenant; se omiten los casos con sujeto real (solo rechazos de anon/cliente)';
  END IF;

  -- anon puede registrar errores (pre-login)
  SELECT v_cases || jsonb_agg(to_jsonb(t)) INTO v_cases FROM (VALUES
    ('anon log_tech_error', 'anon', c_anon, format($q$SELECT public.log_tech_error(%L, NULL, NULL, %L::uuid)$q$, v_stamp || '-anon', v_other), NULL::text, true)
  ) AS t(label, role_, claims, stmt, expect_like, soft);

  BEGIN  -- sub-bloque revertible
    FOR v_case IN SELECT * FROM jsonb_array_elements(v_cases) LOOP
      PERFORM set_config('request.jwt.claims', v_case ->> 'claims', true);
      EXECUTE format('SET LOCAL ROLE %I', v_case ->> 'role_');
      BEGIN
        EXECUTE v_case ->> 'stmt';
        v_got := 'OK';
      EXCEPTION WHEN OTHERS THEN
        v_got := SQLSTATE || '|' || SQLERRM;
      END;
      RESET ROLE;

      IF (v_case ->> 'expect_like') IS NULL THEN
        v_ok := v_got NOT LIKE '42501|%' AND v_got NOT LIKE '%c0_guard%';
      ELSE
        v_ok := v_got LIKE (v_case ->> 'expect_like');
      END IF;

      IF NOT v_ok THEN
        v_fail := v_fail || format(E'\n - [%s] esperado "%s", obtenido "%s"',
                    v_case ->> 'label', coalesce(v_case ->> 'expect_like', 'permitido (sin 42501/c0_guard)'), left(v_got, 200));
      ELSIF (v_case ->> 'soft')::boolean AND v_got <> 'OK' AND (v_case ->> 'expect_like') IS NULL THEN
        RAISE NOTICE '0c VERIFY [%]: paso los guards pero fallo por otra causa: %', v_case ->> 'label', left(v_got, 200);
      END IF;
    END LOOP;
    PERFORM set_config('request.jwt.claims', '', true);

    -- Telemetria: el tenant guardado sale de las claims (o NULL para anon), nunca del parametro
    IF v_sub IS NOT NULL THEN
      SELECT count(*) INTO v_n FROM public.tech_errors WHERE message = v_stamp || '-auth';
      IF v_n = 1 THEN
        SELECT count(*) INTO v_n FROM public.tech_errors
         WHERE message = v_stamp || '-auth' AND tenant_id IS NOT DISTINCT FROM v_tenant;
        IF v_n <> 1 THEN
          v_fail := v_fail || E'\n - [log_tech_error] el tenant guardado no es el de las claims';
        END IF;
      ELSE
        RAISE NOTICE '0c VERIFY: log_tech_error autenticado no dejo fila (%): se omite la comprobacion de tenant', v_n;
      END IF;
    END IF;
    SELECT count(*) INTO v_n FROM public.tech_errors WHERE message = v_stamp || '-anon' AND tenant_id IS NULL;
    IF v_n <> 1 THEN
      RAISE NOTICE '0c VERIFY: log_tech_error anon: filas con tenant NULL = % (esperado 1)', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM public.tech_errors WHERE message = v_stamp || '-anon' AND tenant_id IS NOT NULL;
    IF v_n <> 0 THEN
      v_fail := v_fail || E'\n - [log_tech_error] anon guardo un tenant tomado del parametro';
    END IF;

    -- increment_error_metrics: nunca se creo una fila para el tenant pasado por parametro
    SELECT count(*) INTO v_n FROM public.error_stats WHERE tenant_id = v_other;
    IF v_n <> 0 THEN
      v_fail := v_fail || E'\n - [increment_error_metrics] se contamino la metrica de un tenant ajeno';
    END IF;

    -- Centinela: deshace filas de prueba, GUCs y roles
    RAISE EXCEPTION 'c0_sentinel' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    NULL;
  END;

  IF v_fail <> '' THEN
    RAISE EXCEPTION E'0c VERIFY FAIL (comportamiento):%', v_fail;
  END IF;
END
$verify_behavior$;

COMMIT;
