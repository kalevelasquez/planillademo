-- =============================================================================
-- REFERENCIA / PRUEBA LOCAL de 0c (20261129090000_blindar_rpcs_definer.sql)
--
-- NO es el mecanismo de verificacion en produccion (esa es la autoverificacion DENTRO de la
-- migracion). Este archivo documenta escenarios que requieren DOS tenants con datos
-- (que la autoverificacion no puede fabricar en la BD real sin riesgo) y se corre contra un
-- Postgres 16 desechable (podman) con stubs de auth/storage DESPUES de aplicar 0a, 0b, B1 y 0c.
-- Todo ocurre en una transaccion que termina en ROLLBACK.
--
-- Escenarios (id -> que prueba):
--   H1  admin de OTRO tenant no puede confirmar un borrador ajeno (indistinguible de inexistente)
--   H2  vendedor que falsifica p_user_id/p_roles en el dashboard solo ve SUS pedidos
--   H3  create_direct_order_atomic rechaza productos de otro tenant y clientes de otro tenant
--   H4  create_direct_order_atomic legitimo funciona (tenant sale de las claims, no del parametro)
--   H5  enviar_a_aprobacion (INVOKER) sigue notificando: fn_notificar_aprobadores_planilla vive
--   H6  rechazar_quincena (DEFINER) sigue notificando via fn_notificar_preparador/fn_crear
--   H7  increment_error_metrics ignora p_tenant_id ajeno (cuenta en el tenant de la sesion)
--   H8  sync_inventory_catalog: import de otro tenant rechazado; tenant ajeno por parametro rechazado
--   H9  get_report_* con tenant ajeno rechazado; el propio funciona
--   H10 log_tech_error: con sesion guarda el tenant de las claims; anon guarda NULL
--   H11 revoke_user_sessions solo service_role; borra las sesiones del usuario
--   H12 confirm_order_atomic legitimo (dueno) funciona
-- =============================================================================

BEGIN;

CREATE FUNCTION public.zz_try(p_role text, p_claims text, p_stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text; r text;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_stmt INTO r;
    v := 'OK|' || coalesce(r, '');
  EXCEPTION WHEN OTHERS THEN
    v := SQLSTATE || '|' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
END $$;

CREATE FUNCTION public.zz_claims(p_uid uuid, p_tenant uuid, p_roles text[]) RETURNS text LANGUAGE sql AS $$
  SELECT jsonb_build_object('sub', p_uid, 'role', 'authenticated',
         'app_metadata', jsonb_build_object('tenant_id', p_tenant, 'roles', to_jsonb(p_roles)))::text $$;

CREATE FUNCTION public.zz_expect(p_label text, p_got text, p_like text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_got NOT LIKE p_like THEN
    RAISE EXCEPTION 'FAIL [%]: esperado LIKE "%", obtenido "%"', p_label, p_like, left(p_got, 300);
  END IF;
  RAISE NOTICE 'PASS [%]', p_label;
END $$;

-- ---------------------------- fixtures (como owner) ---------------------------
INSERT INTO tenants (id, name) VALUES ('bbbbbbbb-0000-0000-0000-00000000000b', 'Otro tenant');
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
VALUES ('22222222-0000-0000-0000-00000000000b', 'adminb@otro', '{}', '{}');
INSERT INTO user_profiles (id, tenant_id, role, full_name, email, is_active, status)
VALUES ('22222222-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-00000000000b', ARRAY['admin'], 'Admin B', 'adminb@otro', true, 'ACTIVE');
INSERT INTO permission_matrix (tenant_id, role_name, resource, can_view, can_create, can_edit, can_delete, can_export, can_approve) VALUES
 ('bbbbbbbb-0000-0000-0000-00000000000b','admin','pedidos',true,true,true,true,true,true),
 ('bbbbbbbb-0000-0000-0000-00000000000b','admin','reportes',true,true,true,true,true,true),
 ('bbbbbbbb-0000-0000-0000-00000000000b','admin','inventario',true,true,true,true,true,true)
ON CONFLICT (tenant_id, role_name, resource) DO NOTHING;

INSERT INTO customers (id, tenant_id, business_name) VALUES
 ('c0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Cliente A'),
 ('c0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-00000000000b', 'Cliente B');
INSERT INTO products (id, tenant_id, name, available_quantity, price) VALUES
 ('d0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Producto A', 10, 5),
 ('d0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-00000000000b', 'Producto B', 10, 5);
INSERT INTO inventory_imports (id, tenant_id) VALUES ('e0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000000a');
-- pedidos de hoy: admin A 100, vendedor A 10; un borrador del vendedor A
INSERT INTO orders (id, tenant_id, order_number, customer_id, seller_id, status, subtotal, total_amount) VALUES
 ('f0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'PED-X1', 'c0000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000001', 'Approved', 100, 100),
 ('f0000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-00000000000a', 'PED-X2', 'c0000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000002', 'Approved', 10, 10),
 ('f0000000-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'DRAFT-X3', 'c0000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000002', 'Draft', 0, 0);
INSERT INTO auth.sessions (id, user_id) VALUES (gen_random_uuid(), '11111111-0000-0000-0000-000000000002'), (gen_random_uuid(), '11111111-0000-0000-0000-000000000002');

DO $t$
DECLARE
  tA constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  tB constant uuid := 'bbbbbbbb-0000-0000-0000-00000000000b';
  adminA constant uuid := '11111111-0000-0000-0000-000000000001';
  vendA  constant uuid := '11111111-0000-0000-0000-000000000002';
  adminB constant uuid := '22222222-0000-0000-0000-00000000000b';
  cA constant text := public.zz_claims('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', ARRAY['admin']);
  cV constant text := public.zz_claims('11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a', ARRAY['vendedor']);
  cB constant text := public.zz_claims('22222222-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-00000000000b', ARRAY['admin']);
  g text; n bigint; v jsonb;
BEGIN
  -- H1
  g := public.zz_try('authenticated', cB, format($q$SELECT public.confirm_order_atomic('f0000000-0000-0000-0000-0000000000d1'::uuid,0,NULL,0,0,NULL,'[]'::jsonb)$q$));
  PERFORM public.zz_expect('H1 confirm cross-tenant', g, '%El pedido ya no es un borrador o no existe.');
  SELECT count(*) INTO n FROM orders WHERE id = 'f0000000-0000-0000-0000-0000000000d1' AND status = 'Draft';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL [H1]: el borrador ajeno cambio de estado'; END IF;

  -- H2: el vendedor se hace pasar por admin en los parametros: solo ve lo suyo (10)
  g := public.zz_try('authenticated', cV, format($q$SELECT public.get_dashboard_metrics('aaaaaaaa-0000-0000-0000-00000000000a'::uuid, '11111111-0000-0000-0000-000000000001'::uuid, ARRAY['admin'], now()-interval '1 hour', now()+interval '1 hour', now()-interval '2 day', now()-interval '1 day')$q$));
  PERFORM public.zz_expect('H2 dashboard OK', g, 'OK|%');
  v := substr(g, 4)::jsonb;
  IF (v -> 'today' ->> 'total_sales')::numeric <> 10 THEN RAISE EXCEPTION 'FAIL [H2]: vendedor con parametros falsificados ve ventas = % (esperado 10)', v -> 'today' ->> 'total_sales'; END IF;
  g := public.zz_try('authenticated', cA, format($q$SELECT public.get_dashboard_metrics('aaaaaaaa-0000-0000-0000-00000000000a'::uuid, '11111111-0000-0000-0000-000000000002'::uuid, ARRAY['vendedor'], now()-interval '1 hour', now()+interval '1 hour', now()-interval '2 day', now()-interval '1 day')$q$));
  v := substr(g, 4)::jsonb;
  IF (v -> 'today' ->> 'total_sales')::numeric <> 110 THEN RAISE EXCEPTION 'FAIL [H2]: admin con parametros de vendedor ve % (esperado 110, manda la claim)', v -> 'today' ->> 'total_sales'; END IF;
  RAISE NOTICE 'PASS [H2 dashboard deriva usuario y roles de las claims]';

  -- H3
  g := public.zz_try('authenticated', cA, format($q$SELECT * FROM public.create_direct_order_atomic(%L::uuid,%L::uuid,%L::uuid,5,NULL,0,5,NULL,%L::jsonb)$q$, tA, 'c0000000-0000-0000-0000-0000000000a1', adminA,
       '[{"product_id":"d0000000-0000-0000-0000-0000000000b1","quantity":1,"unit_price":5,"total_price":5}]'));
  PERFORM public.zz_expect('H3 producto de otro tenant', g, '42501|c0_guard: hay productos%');
  g := public.zz_try('authenticated', cA, format($q$SELECT * FROM public.create_direct_order_atomic(%L::uuid,%L::uuid,%L::uuid,5,NULL,0,5,NULL,'[]'::jsonb)$q$, tA, 'c0000000-0000-0000-0000-0000000000b1', adminA));
  PERFORM public.zz_expect('H3 cliente de otro tenant', g, '42501|c0_guard: el cliente%');

  -- H4
  g := public.zz_try('authenticated', cA, format($q$SELECT order_id::text FROM public.create_direct_order_atomic(%L::uuid,%L::uuid,%L::uuid,5,NULL,0,5,'prueba',%L::jsonb)$q$, tA, 'c0000000-0000-0000-0000-0000000000a1', adminA,
       '[{"product_id":"d0000000-0000-0000-0000-0000000000a1","quantity":1,"unit_price":5,"total_price":5}]'));
  PERFORM public.zz_expect('H4 create_direct legitimo', g, 'OK|%');
  SELECT count(*) INTO n FROM orders WHERE tenant_id = tA AND notes = 'prueba' AND status = 'Approved' AND order_number LIKE 'PED-%';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL [H4]: no se creo el pedido en el tenant de la sesion (%)', n; END IF;
  SELECT count(*) INTO n FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.notes = 'prueba';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL [H4]: items = %', n; END IF;

  -- H12: el dueno confirma su borrador
  g := public.zz_try('authenticated', cV, format($q$SELECT public.confirm_order_atomic('f0000000-0000-0000-0000-0000000000d1'::uuid,5,NULL,0,5,NULL,%L::jsonb)$q$,
       '[{"product_id":"d0000000-0000-0000-0000-0000000000a1","quantity":1,"unit_price":5,"total_price":5}]'));
  PERFORM public.zz_expect('H12 confirm legitimo', g, 'OK|PED-%');

  -- H5: enviar_a_aprobacion (INVOKER) como vendedor: notifica a admin A (via fn_notificar_aprobadores, EXECUTE authenticated)
  g := public.zz_try('authenticated', cV, $q$SELECT public.enviar_a_aprobacion(gen_random_uuid())$q$);
  PERFORM public.zz_expect('H5 enviar_a_aprobacion INVOKER', g, 'OK|%');
  SELECT count(*) INTO n FROM notificaciones WHERE tipo = 'zz_envio' AND tenant_id = tA;
  IF n < 1 THEN RAISE EXCEPTION 'FAIL [H5]: no se genero la notificacion de envio'; END IF;

  -- H6: rechazar_quincena (DEFINER) -> fn_notificar_preparador + fn_crear_notificacion (revocadas para authenticated)
  g := public.zz_try('authenticated', cA, $q$SELECT public.rechazar_quincena(gen_random_uuid())$q$);
  PERFORM public.zz_expect('H6 rechazar_quincena DEFINER', g, 'OK|%');
  SELECT count(*) INTO n FROM notificaciones WHERE tipo IN ('zz_rech', 'zz_rech2') AND tenant_id = tA;
  IF n < 2 THEN RAISE EXCEPTION 'FAIL [H6]: notificaciones de rechazo = % (esperado >= 2)', n; END IF;

  -- H7
  g := public.zz_try('authenticated', cA, format($q$SELECT public.increment_error_metrics(%L::uuid)$q$, tB));
  PERFORM public.zz_expect('H7 increment ejecuta', g, 'OK|%');
  SELECT count(*) INTO n FROM error_stats WHERE tenant_id = tB;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL [H7]: se contamino la metrica del tenant B'; END IF;
  SELECT count(*) INTO n FROM error_stats WHERE tenant_id = tA;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL [H7]: no se conto en el tenant de la sesion (%)', n; END IF;

  -- H8
  g := public.zz_try('authenticated', cB, format($q$SELECT public.sync_inventory_catalog(%L::uuid,%L::uuid)$q$, tA, 'e0000000-0000-0000-0000-0000000000a1'));
  PERFORM public.zz_expect('H8 tenant ajeno por parametro', g, '42501|c0_guard: tenant%');
  g := public.zz_try('authenticated', cB, format($q$SELECT public.sync_inventory_catalog(%L::uuid,%L::uuid)$q$, tB, 'e0000000-0000-0000-0000-0000000000a1'));
  PERFORM public.zz_expect('H8 import de otro tenant', g, '%importación inválido%');
  SELECT count(*) INTO n FROM products WHERE tenant_id = tA AND status = 'active';
  IF n < 1 THEN RAISE EXCEPTION 'FAIL [H8]: el barrido ajeno afecto productos del tenant A'; END IF;
  g := public.zz_try('authenticated', cA, format($q$SELECT public.sync_inventory_catalog(%L::uuid,%L::uuid)$q$, tA, 'e0000000-0000-0000-0000-0000000000a1'));
  PERFORM public.zz_expect('H8 sync legitimo', g, 'OK|%');

  -- H9
  g := public.zz_try('authenticated', cB, format($q$SELECT public.get_report_customers(%L::uuid, now()-interval '1 day', now())$q$, tA));
  PERFORM public.zz_expect('H9 reportes tenant ajeno', g, '42501|c0_guard: tenant%');
  g := public.zz_try('authenticated', cB, format($q$SELECT public.get_report_customers(%L::uuid, now()-interval '1 day', now())::text$q$, tB));
  PERFORM public.zz_expect('H9 reporte propio sin filtrar clientes de A', g, 'OK|%Cliente B%');
  IF g LIKE '%Cliente A%' THEN RAISE EXCEPTION 'FAIL [H9]: el reporte de B incluye clientes de A'; END IF;
  g := public.zz_try('authenticated', cV, format($q$SELECT public.get_report_sellers(%L::uuid, now()-interval '1 day', now())::text$q$, tA));
  PERFORM public.zz_expect('H9 vendedor con reportes.view', g, 'OK|%');

  -- H10
  PERFORM public.zz_try('authenticated', cA, format($q$SELECT public.log_tech_error('zz-h10-auth', NULL, NULL, %L::uuid)$q$, tB));
  PERFORM public.zz_try('anon', '{"role":"anon"}', format($q$SELECT public.log_tech_error('zz-h10-anon', NULL, NULL, %L::uuid)$q$, tB));
  SELECT count(*) INTO n FROM tech_errors WHERE message = 'zz-h10-auth' AND tenant_id = tA;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL [H10]: con sesion debe guardar el tenant de las claims'; END IF;
  SELECT count(*) INTO n FROM tech_errors WHERE message = 'zz-h10-anon' AND tenant_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL [H10]: anon debe guardar NULL'; END IF;
  RAISE NOTICE 'PASS [H10 log_tech_error]';

  -- H11
  g := public.zz_try('authenticated', cA, format($q$SELECT public.revoke_user_sessions(%L::uuid)$q$, vendA));
  PERFORM public.zz_expect('H11 authenticated no puede', g, '42501|%');
  g := public.zz_try('service_role', '{"role":"service_role"}', format($q$SELECT public.revoke_user_sessions(%L::uuid)$q$, vendA));
  PERFORM public.zz_expect('H11 service_role borra 2 sesiones', g, 'OK|2');
  SELECT count(*) INTO n FROM auth.sessions WHERE user_id = vendA;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL [H11]: quedaron sesiones'; END IF;
END
$t$;

ROLLBACK;
