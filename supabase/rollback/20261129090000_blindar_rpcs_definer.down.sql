-- =============================================================================
-- ROLLBACK de 0c (20261129090000_blindar_rpcs_definer.sql)  -- NO RECOMENDADO
--
-- Restaura el texto ORIGINAL de las funciones (copiado de las migraciones previas, ver cada
-- bloque) y la exposicion previa (EXECUTE a PUBLIC/anon/authenticated/service_role). Elimina
-- assert_internal_user y revoke_user_sessions. Es una migracion HACIA ADELANTE preparada:
-- copiar a supabase/migrations/ con un timestamp nuevo SOLO si hace falta.
--
-- ATENCION: volver atras reabre los huecos H4 (RPCs que confian en p_tenant_id, notificaciones
-- invocables por cualquier autenticado, etc.). Si las edge functions nuevas ya estan
-- desplegadas, manage-users (TOGGLE_ACTIVE) seguira funcionando: la llamada a
-- revoke_user_sessions falla y solo queda un WARN (el baneo se aplica igual).
--
-- Autoverificable: si algo no queda como antes, RAISE EXCEPTION y se revierte todo.
-- =============================================================================

BEGIN;

-- next_order_number  (origen: 20260612100000_sequential_order_numbers.sql)
CREATE OR REPLACE FUNCTION public.next_order_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_seq BIGINT;
BEGIN
    v_seq := nextval('public.order_number_seq');
    -- lpad garantiza mínimo 4 dígitos; si supera 9999 crece naturalmente (0001→9999→10000)
    RETURN 'PED-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' || lpad(v_seq::TEXT, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_order_number() TO PUBLIC, anon, authenticated, service_role;

-- create_direct_order_atomic  (origen: 20260612100000_sequential_order_numbers.sql)
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

GRANT EXECUTE ON FUNCTION public.create_direct_order_atomic(UUID, UUID, UUID, DECIMAL, TEXT, DECIMAL, DECIMAL, TEXT, JSONB) TO PUBLIC, anon, authenticated, service_role;

-- confirm_order_atomic  (origen: 20260625000000_confirm_order_for_update_lock.sql)
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

GRANT EXECUTE ON FUNCTION public.confirm_order_atomic(UUID, DECIMAL, TEXT, DECIMAL, DECIMAL, TEXT, JSONB) TO PUBLIC, anon, authenticated, service_role;

-- get_dashboard_metrics  (origen: 20260318200000_dashboard_rpc.sql)
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
SET search_path = public
AS $$
DECLARE
    v_is_admin BOOLEAN := ('admin' = ANY(p_roles)) OR ('supervisor' = ANY(p_roles));
    v_t_sales NUMERIC := 0; v_t_count INT := 0;
    v_y_sales NUMERIC := 0; v_y_count INT := 0;
    v_pending INT := 0;
    v_top_prod JSONB; v_top_cust JSONB;
BEGIN
    -- 1. Métricas de Hoy
    SELECT COALESCE(SUM(total_amount), 0), COUNT(id)
    INTO v_t_sales, v_t_count
    FROM public.orders
    WHERE tenant_id = p_tenant_id AND created_at BETWEEN p_start_today AND p_end_today
      AND status != 'Draft' AND (v_is_admin OR seller_id = p_user_id);

    -- 2. Métricas de Ayer (Comparativa)
    SELECT COALESCE(SUM(total_amount), 0), COUNT(id)
    INTO v_y_sales, v_y_count
    FROM public.orders
    WHERE tenant_id = p_tenant_id AND created_at BETWEEN p_start_yesterday AND p_end_yesterday
      AND status != 'Draft' AND (v_is_admin OR seller_id = p_user_id);

    -- 3. Pedidos Pendientes (Snapshot actual)
    SELECT COUNT(id) INTO v_pending FROM public.orders
    WHERE tenant_id = p_tenant_id AND status IN ('Approved', 'In Preparation')
      AND (v_is_admin OR seller_id = p_user_id);

    -- 4. Top 5 Productos Hoy
    SELECT jsonb_agg(t) INTO v_top_prod FROM (
        SELECT p.name, SUM(oi.quantity) as quantity, SUM(oi.total_price) as total
        FROM public.order_items oi
        JOIN public.products p ON oi.product_id = p.id
        JOIN public.orders o ON oi.order_id = o.id
        WHERE o.tenant_id = p_tenant_id AND o.created_at BETWEEN p_start_today AND p_end_today
          AND o.status != 'Draft' AND (v_is_admin OR o.seller_id = p_user_id)
        GROUP BY p.name ORDER BY total DESC LIMIT 5
    ) t;

    -- 5. Top 5 Clientes Hoy
    SELECT jsonb_agg(t) INTO v_top_cust FROM (
        SELECT c.business_name as name, SUM(o.total_amount) as total, COUNT(o.id) as orders_count
        FROM public.orders o
        JOIN public.customers c ON o.customer_id = c.id
        WHERE o.tenant_id = p_tenant_id AND o.created_at BETWEEN p_start_today AND p_end_today
          AND o.status != 'Draft' AND (v_is_admin OR o.seller_id = p_user_id)
        GROUP BY c.business_name ORDER BY total DESC LIMIT 5
    ) t;

    -- 6. Construcción del resultado con cálculo de tendencia normalizado
    -- Si el periodo anterior es 0 y hoy hay datos, marcamos 100% como "crecimiento infinito/inicial"
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

GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics(UUID, UUID, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) TO PUBLIC, anon, authenticated, service_role;

-- get_sales_trend  (origen: 20260318201000_sales_trend_rpc.sql)
CREATE OR REPLACE FUNCTION public.get_sales_trend(
    p_tenant_id UUID,
    p_user_id UUID,
    p_roles TEXT[],
    p_days INT -- Generalmente 7, 30 o 90
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_admin BOOLEAN := ('admin' = ANY(p_roles)) OR ('supervisor' = ANY(p_roles));
    v_timezone TEXT := '-06:00'; -- Zona horaria de El Salvador/Centroamérica
    v_result JSONB;
BEGIN
    WITH RECURSIVE day_series AS (
        -- Generamos la serie de fechas para el periodo actual
        SELECT (CURRENT_DATE AT TIME ZONE v_timezone)::date - (p_days - 1) as day_date, 0 as idx
        UNION ALL
        SELECT (day_date + 1)::date, idx + 1
        FROM day_series
        WHERE idx < (p_days - 1)
    ),
    orders_data AS (
        -- Obtenemos pedidos de ambos periodos (Actual y Espejo) de una sola vez
        SELECT 
            (created_at AT TIME ZONE 'UTC' AT TIME ZONE v_timezone)::date as order_date,
            total_amount
        FROM public.orders
        WHERE tenant_id = p_tenant_id
          AND status NOT IN ('Draft', 'Cancelled')
          AND created_at >= (CURRENT_DATE AT TIME ZONE 'UTC' AT TIME ZONE v_timezone)::date - (2 * p_days - 1)
          AND (v_is_admin OR seller_id = p_user_id)
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

GRANT EXECUTE ON FUNCTION public.get_sales_trend(UUID, UUID, TEXT[], INT) TO PUBLIC, anon, authenticated, service_role;

-- get_report_sellers  (origen: 20260504160000_fix_role_constraints_and_dynamic_reporting.sql)
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

GRANT EXECUTE ON FUNCTION public.get_report_sellers(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO PUBLIC, anon, authenticated, service_role;

-- get_report_products  (origen: 20260318233600_fix_bi_products_schema.sql)
CREATE OR REPLACE FUNCTION public.get_report_products(
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
        WHERE p.tenant_id = p_tenant_id
        GROUP BY p.id, p.name, pc.name
        ORDER BY total_quantity DESC
    ) t;
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_report_products(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO PUBLIC, anon, authenticated, service_role;

-- get_report_customers  (origen: 20260318225000_bi_reports_rpcs.sql)
CREATE OR REPLACE FUNCTION public.get_report_customers(
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
        WHERE c.tenant_id = p_tenant_id AND c.deleted_at IS NULL
        GROUP BY c.id, c.business_name
        ORDER BY accumulated_amount DESC
    ) t;
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_report_customers(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO PUBLIC, anon, authenticated, service_role;

-- sync_inventory_catalog  (origen: 20260331074000_inventory_replace_logic.sql)
CREATE OR REPLACE FUNCTION public.sync_inventory_catalog(
    p_tenant_id UUID, 
    p_import_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Ejecuta con privilegios administrativos para permitir DELETE donde RLS sea restrictivo
AS $$
DECLARE
    v_deleted_count INTEGER := 0;
    v_deactivated_count INTEGER := 0;
BEGIN
    -- Validar integridad: El import debe pertenecer al tenant solicitado
    IF NOT EXISTS (SELECT 1 FROM inventory_imports WHERE id = p_import_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Operación no autorizada: ID de importación inválido para este Tenant.';
    END IF;

    -- A. DELETE: Borrado físico de productos sin historial (Evita basura en la DB)
    -- Solo borra si no existe en order_items para proteger integridad referencial
    DELETE FROM public.products
    WHERE tenant_id = p_tenant_id
      AND status = 'active'
      AND (last_import_id IS NULL OR last_import_id != p_import_id)
      AND id NOT IN (SELECT DISTINCT product_id FROM public.order_items);
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    -- B. SOFT DELETE: Marcado como 'unavailable' para productos con historial
    -- Así los pedidos viejos mantienen su relación, pero el producto sale del catálogo activo
    UPDATE public.products
    SET status = 'unavailable'
    WHERE tenant_id = p_tenant_id
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

GRANT EXECUTE ON FUNCTION public.sync_inventory_catalog(UUID, UUID) TO PUBLIC, anon, authenticated, service_role;

-- fn_notificar_aprobadores_planilla  (origen: 20260907380000_admin_copia_notificaciones_y_restaurar_guard_reapertura.sql)
CREATE OR REPLACE FUNCTION public.fn_notificar_aprobadores_planilla(
    p_tenant_id UUID, p_tipo TEXT, p_titulo TEXT, p_mensaje TEXT, p_referencia_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usuario_id UUID;
BEGIN
    -- CA2: Aprobadores + Admin (copia), una sola query — dedup natural si un usuario tiene
    -- ambos roles.
    FOR v_usuario_id IN
        SELECT id FROM public.user_profiles
        WHERE tenant_id = p_tenant_id AND is_active
          AND (role && ARRAY['aprobador_planilla', 'admin'])
    LOOP
        PERFORM public.fn_crear_notificacion(p_tenant_id, v_usuario_id, p_tipo, p_titulo, p_mensaje, p_referencia_id);
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_notificar_aprobadores_planilla(UUID, TEXT, TEXT, TEXT, UUID) TO PUBLIC, anon, authenticated, service_role;

-- fn_notificar_preparador_y_admins_planilla  (origen: 20260907380000_admin_copia_notificaciones_y_restaurar_guard_reapertura.sql)
CREATE OR REPLACE FUNCTION public.fn_notificar_preparador_y_admins_planilla(
    p_tenant_id UUID, p_preparador_id UUID, p_tipo TEXT, p_titulo TEXT, p_mensaje TEXT, p_referencia_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usuario_id UUID;
BEGIN
    FOR v_usuario_id IN
        SELECT id FROM public.user_profiles
        WHERE tenant_id = p_tenant_id AND is_active
          AND (id = p_preparador_id OR 'admin' = ANY(role))
    LOOP
        PERFORM public.fn_crear_notificacion(p_tenant_id, v_usuario_id, p_tipo, p_titulo, p_mensaje, p_referencia_id);
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_notificar_preparador_y_admins_planilla(UUID, UUID, TEXT, TEXT, TEXT, UUID) TO PUBLIC, anon, authenticated, service_role;

-- log_tech_error  (origen: 20260324123345_add_tech_telemetry.sql)
CREATE OR REPLACE FUNCTION public.log_tech_error(
    p_message TEXT,
    p_stack TEXT DEFAULT NULL,
    p_context JSONB DEFAULT NULL,
    p_tenant_id UUID DEFAULT NULL
) 
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.tech_errors (tenant_id, user_id, message, stack, context)
    VALUES (
        COALESCE(p_tenant_id, (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())),
        auth.uid(),
        p_message,
        p_stack,
        p_context
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.log_tech_error(TEXT, TEXT, JSONB, UUID) TO PUBLIC, anon, authenticated, service_role;

-- increment_error_metrics  (origen: 20260320231500_add_system_metrics.sql)
CREATE OR REPLACE FUNCTION public.increment_error_metrics(p_tenant_id UUID)
RETURNS VOID AS $$
DECLARE
    v_hour TIMESTAMPTZ := date_trunc('hour', now());
BEGIN
    INSERT INTO public.error_stats (tenant_id, hour_timestamp, error_count)
    VALUES (p_tenant_id, v_hour, 1)
    ON CONFLICT (tenant_id, hour_timestamp)
    DO UPDATE SET 
        error_count = public.error_stats.error_count + 1,
        created_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.increment_error_metrics(UUID) TO PUBLIC, anon, authenticated, service_role;

-- fn_crear_notificacion y seed_default_permissions: el cuerpo no cambio en 0c, solo privilegios
GRANT EXECUTE ON FUNCTION public.fn_crear_notificacion(UUID, UUID, TEXT, TEXT, TEXT, UUID) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seed_default_permissions(UUID) TO PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.seed_default_permissions(UUID) RESET search_path;

-- Funciones nuevas de 0c
DROP FUNCTION IF EXISTS public.revoke_user_sessions(UUID);
DROP FUNCTION IF EXISTS public.assert_internal_user(UUID);

-- -----------------------------------------------------------------------------
-- Autoverificacion: estado previo a 0c
-- -----------------------------------------------------------------------------
DO $verify_down$
DECLARE
  r record;
BEGIN
  IF to_regprocedure('public.assert_internal_user(uuid)') IS NOT NULL
     OR to_regprocedure('public.revoke_user_sessions(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '0c DOWN VERIFY FAIL: quedan funciones de 0c';
  END IF;

  FOR r IN
    SELECT p.oid::regprocedure::text AS sig, p.prosrc, p.proname
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('next_order_number', 'create_direct_order_atomic', 'confirm_order_atomic', 'get_dashboard_metrics',
                         'get_sales_trend', 'get_report_sellers', 'get_report_products', 'get_report_customers',
                         'sync_inventory_catalog', 'fn_notificar_aprobadores_planilla',
                         'fn_notificar_preparador_y_admins_planilla', 'log_tech_error', 'increment_error_metrics')
  LOOP
    IF r.prosrc ILIKE '%assert_internal_user%' OR r.prosrc ILIKE '%c0_guard%' THEN
      RAISE EXCEPTION '0c DOWN VERIFY FAIL: % sigue con el guard de 0c', r.sig;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('authenticated', 'public.fn_crear_notificacion(uuid,uuid,text,text,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.next_order_number()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.seed_default_permissions(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0c DOWN VERIFY FAIL: no se restauro la exposicion previa';
  END IF;
END
$verify_down$;

COMMIT;
