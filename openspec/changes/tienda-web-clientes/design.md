# Design: Tienda web para clientes finales

> Actualizado 2026-11-27: flujo de despliegue solo por repo (push a main aplica `supabase/migrations`, sin staging ni SQL editor), migraciones autoverificables, fallback de transición B (lookup en `user_profiles`, nunca `user_metadata`) y auditoría estática de funciones DEFINER (A0.4).

> Nota de tamaño: este documento excede el presupuesto de 800 palabras de la skill. El orquestador pidió explícitamente SQL, diagramas, la lista de cambios archivo por archivo y el rollback. Todo lo que cabe en tabla va en tabla.

## Enfoque técnico

Hay 4 fases desplegables por separado (F0→F3). La seguridad vive en Postgres: las claims salen solo de `app_metadata`, y todo acceso público o de cliente pasa por RPCs `SECURITY DEFINER` que devuelven columnas mínimas. No se agrega ninguna policy anon ni de cliente sobre tablas admin. En el front, `App.tsx` queda como router delgado: `PublicApp` (lazy) atiende `/`, `/tienda/*` y `/cuenta/*`, y `AdminApp` (lazy, que es el `AppContent` actual) atiende el resto. Cada shell tiene su propio cliente Supabase.

## Hallazgos que cambian el diseño (verificados en el código)

| # | Hallazgo | Dónde | Consecuencia |
|---|----------|-------|--------------|
| H1 | `get_auth_roles()` devuelve `'vendedor'` cuando no hay rol | `20260317085921_critical_rl_recovery.sql` | La nueva versión devuelve `'{}'` |
| H2 | La policy `user_profiles_select_policy_v3` lee `user_metadata` directo | idem | Se reescribe con `get_auth_tenant_id()` |
| H3 | Un usuario puede cambiar su propio `user_profiles.role`: el guard se dropeó en `20260228031311` y la policy permite `auth.uid()=id` | robust_permission_system | Trigger guard antes de sincronizar el rol a `app_metadata` |
| H4 | `create_direct_order_atomic` confía en `p_tenant_id`/`p_seller_id`; `confirm_order_atomic` no valida el tenant; `fn_crear_notificacion` es DEFINER con EXECUTE por defecto | migraciones de pedidos y notificaciones | Hay que blindarlas en F0: un cliente de tienda autenticado podría abusar de ellas |
| H5 | El cliente admin (`detectSessionInUrl:true`) se instancia en TODA ruta. Cadena: `main→ErrorBoundary→logger→monitoringService→authService→supabaseClient` | `src/config/supabaseClient.ts` | Sin guard, capturaría el token de confirmación de la tienda |
| H6 | `inviteUserByEmail` no acepta `app_metadata`, e `invited_at` se setea DESPUÉS del INSERT | GoTrue | El trigger no puede distinguir una invitación de un signup público por metadata. Se resuelve con una tabla `staff_invitations` + nonce |
| H7 | El stock negativo está permitido (`check_stock_positive` se dropeó) | `20260317160000` | La aprobación valida el stock por su cuenta, con `FOR UPDATE` |

## Decisiones de arquitectura

| Decisión | Elegido | Descartado | Por qué |
|----------|---------|------------|---------|
| Fuente de claims | `raw_app_meta_data`, sincronizado desde `user_profiles` por trigger | Custom Access Token Hook | El hook depende de configurar el dashboard (no versionable en migraciones remotas), un fallo del hook bloquea TODOS los logins y suma latencia a cada refresh. El trigger es SQL versionado, testeable y reversible, y deja `user_profiles` como única fuente de verdad |
| Invitación vs signup | Tabla `staff_invitations` (email + nonce secreto, expira en 1 h) escrita por la edge function con service_role. El trigger exige email+nonce | Confiar en `user_metadata`; usar `invited_at` | `user_metadata` lo puede escribir cualquiera en un signUp. `invited_at` llega tarde (H6). El nonce no lo conoce un atacante |
| Signup de tienda | Por defecto, todo alta sin invitación válida es de tienda: crea un `customers` en el ÚNICO tenant con `store_enabled` y no crea `user_profiles` | Flag `signup_source` del cliente | El cliente no decide nada. En el peor caso obtiene un `customers` sin privilegios |
| Tenant de tienda | Índice único parcial: como máximo 1 tenant con `store_enabled=true` (v1) | Slug multi-tienda | El trigger resuelve el tenant sin ambigüedad. El multi-tienda está fuera de alcance |
| Acceso del cliente a sus datos | Solo RPCs (`store_get_my_account`, `store_list_my_orders`) | Policies `auth_user_id=auth.uid()` en tablas | Expone columnas mínimas y no toca las policies admin |
| Bandeja web para vendedores `own` | Policy SELECT específica `origin='web' AND status='Pending' AND seller_id IS NULL` + RPC `list_pending_web_orders()` con los datos de contacto | Ampliar las policies de `customers` | El vendedor `own` no ve un `customers` sin asignar. La RPC le da solo el contacto necesario. Al aprobar, se asigna `assigned_seller_id` |
| Lote del pedido (actualizado C1) | Reparto FIFO: la cantidad se parte entre los lotes activos del grupo con stock >= 1 y precio > 0, del mas antiguo (`entry_date NULLS LAST, created_at, id`) al siguiente; **un `order_items` por lote, al precio de ese lote**. Stock total del grupo < cantidad => se RECHAZA todo el pedido con un mensaje generico (SQLSTATE `SW001`, sin cantidades en mensaje/detalle/hint) | Un solo lote por producto; crear igual con el remanente en el ultimo lote | Decision final del usuario: el cliente nunca ve cuanto hay; la aprobacion (D2, con `FOR UPDATE`) sigue validando el stock real. `approve_web_order` suma por `product_id`, sirve sin cambio |
| Identificador público del producto | `product_key = md5(lower(name)\|caliber\|quality)` | El id del lote | El spec prohíbe exponer IDs de lote |
| Descuento de stock | Extender el trigger: `Draft→Approved` OR (`Pending→Approved` AND `origin='web'`) | Cualquier `Pending→Approved` | Puede haber pedidos legacy `Pending` internos (migrados de 'pendiente'), y no deben empezar a descontar |
| Notificación | Trigger `AFTER INSERT ON orders WHEN origin='web'` (F3) | Llamada dentro de la RPC | F2 y F3 se despliegan por separado; el trigger desacopla |
| Prefijo de chunks admin | `output.chunkFileNames` como función (`admin-[name]-[hash].js`) | `manualChunks` | `manualChunks` fusionaría todas las vistas admin en un solo chunk y rompería el lazy por vista. Es el mismo resultado ("prefijo + globIgnores") por un mecanismo más fino. **Se desvía del mecanismo literal aprobado** |
| Sesión de tienda | `storeSupabase`: `storageKey:'sb-teknergy-store'`, `flowType:'pkce'`, `detectSessionInUrl` solo en `/cuenta*`. El cliente admin pone `detectSessionInUrl:false` en `/cuenta*` | Un único cliente | Aísla las sesiones (H5). Con PKCE, el verifier vive solo en el storage de la tienda |
| Customer existente del admin con el mismo email | Siempre se crea uno nuevo (default aceptado), sin buscar por email | Vincular por email | Buscar por email filtraría la existencia y los datos de clientes internos |

## F0: secuencia de migraciones (bloquea F2)

| Orden | Archivo | Contenido |
|-------|---------|-----------|
| 0a | `20261127090000_endurecer_claims_app_metadata.sql` | (1) Tabla `staff_invitations` (RLS ON, sin policies, `REVOKE ALL` a anon/authenticated). (2) Trigger `guard_user_profiles_privileged_cols` BEFORE UPDATE: si cambia `role`, `tenant_id`, `is_active` o `status` y `auth.role()<>'service_role'` y (`NEW.id=auth.uid()` OR NOT `has_permission('usuarios','edit')`) → RAISE. (3) Trigger `sync_user_claims` AFTER INSERT/UPDATE OF role, tenant_id ON user_profiles → `UPDATE auth.users SET raw_app_meta_data = coalesce(..)\|\|{tenant_id, roles}`. (4) **Backfill**: `UPDATE auth.users u SET raw_app_meta_data = … FROM user_profiles p WHERE p.id=u.id AND p.tenant_id IS NOT NULL`. (5) `get_auth_tenant_id/get_auth_roles` leen `app_metadata`; si está vacío, **fallback B**: lookup en `public.user_profiles` por `auth.uid()`. NUNCA leen `user_metadata`. Roles sin default `'vendedor'` (devuelven `'{}'`). Son `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `STABLE`. (6) Reescribir `user_profiles_select_policy_v3` con `get_auth_tenant_id()`. (7) Bloques DO de **autoverificación** (ver Estrategia de testing): catálogo + comportamiento con JWT simulados; cualquier fallo hace `RAISE EXCEPTION` y revierte toda la migración |
| 0b | `20261127100000_handle_new_user_ramificado.sql` | `tenants.store_enabled bool default false` + `UNIQUE INDEX … ((true)) WHERE store_enabled`. `customers.auth_user_id uuid UNIQUE NULL REFERENCES auth.users ON DELETE SET NULL`, `customers.email text`. Nuevo `handle_new_user` (ver abajo) |
| 0c | `20261129090000_blindar_rpcs_definer.sql` (timestamp movido: 0b ya estaba aplicada; implementada en A2, ver tasks) | Helper `assert_internal_user()`: RAISE si `get_auth_tenant_id()` es NULL o si no hay `user_profiles` activo. Se aplica a `create_direct_order_atomic` (además: `p_tenant_id=get_auth_tenant_id()`, `has_permission('pedidos','create')`) y a `confirm_order_atomic` (el pedido debe ser del tenant del caller). `REVOKE EXECUTE ON fn_crear_notificacion FROM PUBLIC, anon, authenticated`. Incluye la query de auditoría de DEFINER ejecutables por `authenticated`; su salida queda triada como checklist en tasks |
| 0d | `<timestamp posterior a 20261129090000>_retirar_fallback_user_profiles.sql` | Limpieza: elimina el fallback a `user_profiles` una vez que todos los usuarios internos tienen `app_metadata` (autoverificado en la propia migración). Ya no es una medida de seguridad (el hueco se cierra desde 0a), pero se mantiene como **gate de F2** para dejar las claims solo en el JWT |

**Fallback B (actualizado 2026-11-27)**: el fallback consulta `user_profiles` (fuente de verdad, solo editable por service_role o por un admin con `usuarios.edit`), NO la metadata que el usuario puede reescribir con `updateUser`. Por eso el hueco queda cerrado desde el minuto cero de 0a y no hace falta esperar ≥1 h. Cubre los access tokens emitidos antes del backfill (sin `app_metadata`) y cualquier usuario cuyo trigger de sync falle.

**Recursión de RLS**: las policies de `user_profiles` llaman a `get_auth_*`; si estas funciones consultaran `user_profiles` como INVOKER, dispararían esas mismas policies (recursión infinita). Por eso son `SECURITY DEFINER` (el dueño `postgres` tiene BYPASSRLS) con `search_path` fijo. El guard BEFORE UPDATE (H3) es lo que hace seguro confiar en `user_profiles`: sin él, un usuario podría escribir su propio `role` y el fallback se lo creería. El guard solo actúa con un JWT de usuario (`auth.uid() IS NOT NULL` y rol distinto de `service_role`); service_role, migraciones y GoTrue pasan.

**Edge functions**:
- `manage-users CREATE_USER` e `invite-employee`: insertan `staff_invitations` → reciben el `nonce` → `inviteUserByEmail(email,{data:{full_name, needs_password_change, invitation_nonce}})`. Si falla, borran la invitación. Luego hacen `updateUserById(id,{app_metadata:{tenant_id, roles}})` (redundante con el trigger, lo pide el spec). Se mantiene el upsert de `user_profiles`.
- `UPDATE_USER`: actualiza `user_profiles` (el trigger sincroniza) y además `app_metadata`. Deja de escribir roles en `user_metadata`.
- El retry de `invite-employee` (delete + re-invite) crea una invitación nueva.

**JWT y logout**: un cambio de rol se ve en el próximo refresh (≤1 h, igual que hoy). Para que sea inmediato, el listener `central-profile-sync` de `AdminApp` llama a `supabase.auth.refreshSession()` cuando cambia `role`. El kill-switch no cambia. El logout de la tienda usa `signOut({scope:'local'})` sobre `storeSupabase`, así que no toca la sesión admin. Riesgo detectado: `auth.admin.signOut(id,'global')` en `TOGGLE_ACTIVE` recibe un id donde la API espera un JWT. Hay que verificarlo; el baneo sí funciona.

### handle_new_user (sketch)

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_inv staff_invitations; v_store uuid;
BEGIN
  BEGIN
    UPDATE staff_invitations SET consumed_at = now(), consumed_by = NEW.id
     WHERE lower(email) = lower(NEW.email)
       AND nonce::text = NEW.raw_user_meta_data->>'invitation_nonce'
       AND consumed_at IS NULL AND expires_at > now()
    RETURNING * INTO v_inv;
    IF v_inv.id IS NOT NULL THEN            -- rama interna: datos de la invitación, NUNCA de la metadata
      INSERT INTO user_profiles(id, full_name, role, tenant_id, email, is_active, status)
      VALUES (NEW.id, v_inv.full_name, v_inv.roles, v_inv.tenant_id, NEW.email, true, 'PENDING')
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, tenant_id = EXCLUDED.tenant_id;
      -- sync_user_claims escribe app_metadata
    ELSE                                    -- rama tienda
      SELECT id INTO v_store FROM tenants WHERE store_enabled AND is_active;
      IF v_store IS NOT NULL THEN
        INSERT INTO customers(tenant_id, auth_user_id, email, business_name, contact_name, phone, address, department, municipality, status)
        VALUES (v_store, NEW.id, NEW.email,
          left(coalesce(nullif(btrim(NEW.raw_user_meta_data->>'full_name'),''), NEW.email),120),
          left(NEW.raw_user_meta_data->>'full_name',120), left(NEW.raw_user_meta_data->>'phone',20),
          left(NEW.raw_user_meta_data->>'address',300), left(NEW.raw_user_meta_data->>'department',60),
          left(NEW.raw_user_meta_data->>'municipality',60), 'activo')
        ON CONFLICT (auth_user_id) DO NOTHING;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user % : %', NEW.id, SQLERRM;  -- nunca bloquea el alta
  END;
  RETURN NEW;
END $$;
```

Si `customers.price_type` tiene un CHECK, el insert usa el default `'cliente'`. Un usuario creado a mano desde el dashboard sin invitación queda como cliente de tienda: los internos se crean SOLO por las edge functions (queda documentado).

## Auditoría estática de funciones SECURITY DEFINER (A0.4, 2026-11-27)

El equipo no puede correr `supabase/tests/sql/audit_definer_exec.sql` (no usa el SQL editor), así que la auditoría se hizo escaneando `supabase/migrations` (última definición de cada función con `SECURITY DEFINER`, 46 funciones). Limitaciones: no ve objetos creados fuera del repo ni privilegios cambiados en vivo; como Postgres da `EXECUTE` a `PUBLIC` por defecto y el repo casi no hace `REVOKE`, se asume que toda función DEFINER es invocable por `authenticated` (y `anon` donde no hay `REVOKE`). Las funciones `RETURNS trigger` no son invocables vía RPC.

| Función | Última migración | Riesgo | Acción en 0c |
|---------|------------------|--------|--------------|
| `create_direct_order_atomic` | `20260612100000_sequential_order_numbers` | ALTO: confía en `p_tenant_id`/`p_seller_id`/`p_customer_id`, sin permiso ni `search_path`. Crea pedidos `Approved` y borra Drafts en cualquier tenant | `assert_internal_user()`, `p_tenant_id = get_auth_tenant_id()`, `has_permission('pedidos','create')`, `search_path` |
| `confirm_order_atomic` | `20260625000000_confirm_order_for_update_lock` | ALTO: no valida tenant ni dueño del Draft; cualquier autenticado confirma Drafts ajenos | El pedido debe ser del tenant del caller + `assert_internal_user()` |
| `get_report_sellers` / `get_report_products` / `get_report_customers` | `20260504160000_...`, `20260318233600_...`, `20260318225000_...` | ALTO: `p_tenant_id` del caller, sin chequeo: lectura cross-tenant de BI | Forzar `p_tenant_id = get_auth_tenant_id()` y `has_permission('reportes','view')` |
| `get_dashboard_metrics` / `get_sales_trend` | `20260318200000_dashboard_rpc`, `20260318201000_sales_trend_rpc` | ALTO: `p_tenant_id`, `p_user_id` y `p_roles` vienen del caller (incluso decide la visibilidad admin) | Derivar tenant/rol/usuario de claims; rechazar si los parámetros difieren |
| `sync_inventory_catalog` | `20260331074000_inventory_replace_logic` | ALTO: valida el import contra `p_tenant_id` pero no contra el caller; borra/desactiva productos; sin `search_path` | `p_tenant_id = get_auth_tenant_id()` + `has_permission('inventario','edit')` + `search_path` |
| `fn_crear_notificacion` | `20260907170000_create_notificaciones` | ALTO: escribe notificaciones para cualquier `p_tenant_id`/`p_usuario_id`; `EXECUTE` por defecto | `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` (la llaman funciones DEFINER) |
| `fn_notificar_aprobadores_planilla` / `fn_notificar_preparador_y_admins_planilla` | `20260907380000_admin_copia_notificaciones_...` | ALTO: fan-out de notificaciones a un tenant arbitrario | Mismo `REVOKE` |
| `seed_default_permissions` | `20260716120100_planilla_roles_and_permissions` | MEDIO/ALTO: `p_tenant_id` del caller; puede resembrar `permission_matrix` de otro tenant (según su `ON CONFLICT`) | `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` (la llama el trigger de tenants) |
| `log_tech_error` | `20260324123345_add_tech_telemetry` | MEDIO: concedida a `anon`; acepta `p_tenant_id` arbitrario (spam/contaminación de telemetría) | Ignorar `p_tenant_id` si hay sesión; para `anon` guardar `NULL` |
| `increment_error_metrics` | `20260320231500_add_system_metrics` | BAJO/MEDIO: concedida a `authenticated`, sin `search_path`; contaminación de métricas de otro tenant | Usar el tenant de claims o restringir a `service_role` |
| `next_order_number` | `20260612100000_sequential_order_numbers` | BAJO: cualquier autenticado consume la secuencia (huecos de numeración) | `assert_internal_user()` |
| `check_access`, `check_order_access_v3`, `check_order_item_access(_v2)`, `check_access_to_order_items` | varias (`2026031x`) | BAJO: helpers de RLS que devuelven booleanos; `check_access` toma `p_owner_id` pero no filtra por tenant | Sin acción; se benefician de 0a. Revisar `check_access` si se expone |
| `has_permission`, `get_permission_scope`, `get_auth_role`, `get_user_tenant`, `get_bootstrap_data` | `20261124090000_...`, `20260316000004_...`, `20260221000001_...`, `20260324104821_...` | OK: derivan de `auth.uid()`/claims | 0a endurece las claims de las que dependen |
| `aprobar_y_cerrar_quincena`, `reabrir_quincena`, `rechazar_quincena`, `enviar_a_aprobacion` | `20260929100000_...`, `20260907210000_...`, `20260907380000_...` | OK: usan `auth.uid()`, `get_auth_tenant_id()` y roles | Sin acción; se benefician de 0a |
| `handle_new_user` | `20260504173000_...` | CRÍTICO (H6): confía en `raw_user_meta_data` | Resuelto en 0b |
| Triggers: `deduct_inventory_on_approval/_on_order`, `handle_order_item_inventory_change`, `handle_product_stock_update`, `recover_inventory_*`, `fn_capture_audit`, `fn_on_tenant_created`, `auto_assign_seller`, `protect_customer_reassignment`, `check_admin_profile_update`, `sync_user_status(_and_login)`, `log_auth_audit`, `log_custom_audit` | varias | BAJO: no invocables por RPC; algunos sin `search_path` | Opcional: `SET search_path`. `log_custom_audit` es función invocable con `auth.uid()`/tenant de claims: sin acción |

El script del scanner usado (heurístico) no se versiona; el resultado es esta tabla. La salida alimenta el alcance de 0c (tasks A2.2).

## Cambios de schema (F1–F3)

| Migración | Cambios |
|-----------|---------|
| `20261128090000_imagenes_productos.sql` (aplicada, B1.2; timestamp movido por el cambio de orden F1 antes de F0) | `products.image_url text NULL`. Bucket `product_images` (public, 2 MB, `image/jpeg,png,webp`). Policies en `storage.objects` (todas `TO authenticated`, acotadas a `bucket_id='product_images'` y a la carpeta `get_auth_tenant_id()`): INSERT con `has_permission('inventario','create') OR 'edit'`; UPDATE/DELETE con `'edit'`; SELECT solo del propio tenant (para upsert). **Desviación**: no hay policy SELECT para anon (la URL pública de un bucket público no pasa por RLS; así no se puede listar el bucket). Ruta: `{tenant_id}/{product_id}-{ts}.webp` |
| `20261128100000_rpcs_catalogo_tienda.sql` (B1.3) | `store_list_products`, `store_get_product` + función interna `store_catalog_groups(uuid)` (sin EXECUTE para anon/authenticated; evita el tope de 100 al buscar por `product_key`). Crea `tenants.store_enabled` + índice único parcial con `IF NOT EXISTS` (independiente de 0b). El estado es `Disponible` si `sum(available_quantity) > 0` sobre los lotes activos del grupo; precio/imagen del lote activo más antiguo con stock (o el más reciente si está agotado). `products` guarda un lote por fila (sin columna de costo en el esquema) |
| `20261208090000_pedidos_web_origen.sql` | `orders.origin text NOT NULL DEFAULT 'interno' CHECK (origin IN ('interno','web'))`. `ALTER seller_id DROP NOT NULL` + `CHECK (seller_id IS NOT NULL OR (origin='web' AND status IN ('Pending','Cancelled')))`. `orders.rejection_reason text`. Índice parcial `(tenant_id, created_at) WHERE origin='web' AND status='Pending'` |
| `20261208100000_rpc_store_create_order.sql` | `store_create_order`, `store_get_my_account`, `store_list_my_orders` |
| `20261215090000_aprobacion_pedidos_web.sql` | Trigger de stock extendido, `approve_web_order`, `reject_web_order`, `list_pending_web_orders`, policy `orders_select_web_pending`, trigger `trg_notificar_pedido_web`, seed `can_approve` de pedidos para admin/supervisor |

**Regla para todas las funciones nuevas**: `SECURITY DEFINER SET search_path = public, pg_temp`, después `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated` y `GRANT EXECUTE` explícito. El catálogo va a `anon, authenticated`; el resto solo a `authenticated`.

## Contratos RPC

```sql
store_list_products(p_tenant_id uuid, p_search text DEFAULT NULL, p_limit int DEFAULT 48, p_offset int DEFAULT 0)
  RETURNS TABLE(product_key text, name text, caliber text, quality text, price numeric, image_url text, availability text)
-- WHERE t.store_enabled AND p.status='active' GROUP BY name,caliber,quality;
-- price/image de la fila más antigua con stock>0 (o la más reciente si está agotado);
-- availability = CASE WHEN sum(available_quantity)>0 THEN 'Disponible' ELSE 'Agotado' END; limit acotado a 1..100
store_get_product(p_tenant_id uuid, p_product_key text) RETURNS same row (0 filas si no existe o la tienda está deshabilitada)

store_create_order(p_items jsonb, p_notes text DEFAULT NULL) RETURNS TABLE(order_id uuid, order_number text, total numeric)
store_get_my_account() RETURNS TABLE(contact_name text, phone text, address text, department text, municipality text, email text)
store_list_my_orders() RETURNS TABLE(order_number text, status text, total_amount numeric, created_at timestamptz, items jsonb)
list_pending_web_orders() RETURNS jsonb      -- has_permission('pedidos','view'); incluye contacto e ítems
approve_web_order(p_order_id uuid) RETURNS text
reject_web_order(p_order_id uuid, p_reason text) RETURNS void
```

### store_create_order (implementado en C1, `20261208100000_rpc_store_create_order.sql`)

```sql
-- SECURITY DEFINER, search_path fijo, EXECUTE solo authenticated (anon/PUBLIC sin EXECUTE)
-- 1. auth.uid() NULL                    -> 42501 auth_required
-- 2. existe user_profiles(auth.uid())   -> 42501 forbidden            (personal interno no compra por la tienda)
-- 3. customers.auth_user_id=auth.uid(), activo, no borrado, tenant store_enabled e is_active
--                                       -> si no, SW008 store_unavailable   (tenant y cliente salen de ESA fila)
-- 4. auth.users.email_confirmed_at      -> si no, SW007 email_unconfirmed
-- 5. pg_advisory_xact_lock(cliente); >= 3 pedidos Pending web del cliente -> SW006 too_many_pending
-- 6. payload: array 1..30 (SW005 vacio/no-array/NULL/elemento no objeto/product_key vacio o repetido; SW004 > 30);
--    quantity numerica entera 1..500 (SW003). Solo se leen product_key y quantity; price/tenant/cliente/vendedor se ignoran
-- 7. por item, FIFO sobre products (tenant del cliente, status='active', price>0, available_quantity>=1,
--    md5(lower(name)|caliber|quality)=product_key, ORDER BY entry_date NULLS LAST, created_at, id):
--    toma min(restante, floor(stock)) de cada lote al precio del lote. Si queda restante:
--      grupo inexistente/inactivo/otro tenant -> SW002 product_unavailable
--      stock total insuficiente               -> SW001 'No hay suficiente disponibilidad de <producto>, probá con una cantidad menor'
--                                                (DETAIL = solo el nombre; sin cantidades; se rechaza TODO el pedido)
-- 8. recien validado todo: nextval('order_number_seq') (formato PED-YYYYMMDD-NNNN, el de next_order_number; esa funcion exige
--    personal interno, por eso la RPC usa la secuencia directa). Los rechazos no consumen numero.
-- 9. INSERT orders (Pending, origin 'web', seller_id NULL, total calculado en servidor, notas <= 500) + 1 order_items por lote.
--    NO descuenta stock: el trigger solo actua con Approved. RETURNS (order_id, order_number, total)
```

**Codigos de error** (el front mapea por SQLSTATE a `store.errors.*`; el mensaje de la base nunca se muestra salvo SW001, que es generico): `42501` auth_required / forbidden, `SW001` insufficient_availability, `SW002` product_unavailable, `SW003` invalid_quantity, `SW004` too_many_items, `SW005` invalid_items, `SW006` too_many_pending, `SW007` email_unconfirmed, `SW008` store_unavailable.

`store_get_my_account()` y `store_list_my_orders()` leen solo la fila ligada a `auth.uid()` (42501 para anon/personal; 0 filas si no hay cliente). Los items del pedido se agrupan por producto (nombre, calibre, calidad, cantidad, precio unitario promedio, total de linea): no se exponen lotes ni ids.

### approve_web_order (sketch)

```sql
  IF get_auth_tenant_id() IS NULL OR NOT has_permission('pedidos','approve') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_o FROM orders WHERE id=p_order_id AND tenant_id=get_auth_tenant_id() FOR UPDATE;   -- evita la doble aprobación
  IF NOT FOUND OR v_o.origin<>'web' OR v_o.status<>'Pending' THEN RAISE EXCEPTION 'invalid_state'; END IF;
  PERFORM 1 FROM products WHERE id IN (SELECT product_id FROM order_items WHERE order_id=p_order_id)
    ORDER BY id FOR UPDATE;                                   -- orden determinístico, sin deadlocks
  IF EXISTS (SELECT 1 FROM (SELECT product_id, sum(quantity) q FROM order_items WHERE order_id=p_order_id GROUP BY 1) i
             JOIN products p ON p.id=i.product_id WHERE p.available_quantity < i.q OR p.status<>'active')
    THEN RAISE EXCEPTION 'insufficient_stock'; END IF;        -- toda la transacción se revierte, sin cambios parciales
  UPDATE orders SET status='Approved', seller_id=auth.uid() WHERE id=p_order_id;   -- el trigger descuenta
  UPDATE customers SET assigned_seller_id=auth.uid() WHERE id=v_o.customer_id AND assigned_seller_id IS NULL;
```

Trigger de stock: `IF NEW.status='Approved' AND (OLD.status='Draft' OR (OLD.status='Pending' AND NEW.origin='web'))`, más `SET search_path`. Notificación: el trigger hace fan-out con `fn_crear_notificacion(tenant, up.id, 'pedido_web', …, NEW.id)` a cada `user_profiles` activo del tenant que cumpla `EXISTS permission_matrix(role_name = ANY(up.role), resource='pedidos', can_view)`.

## Flujos

```
Signup tienda
Visitante → RegisterForm → storeSupabase.auth.signUp({email,pw, options:{data:{full_name,phone,address…}, emailRedirectTo:/cuenta/confirmado}})
  GoTrue INSERT auth.users ─→ handle_new_user: sin invitación → customers(tenant store, auth_user_id)
  GoTrue → email de confirmación (si el email ya existe: respuesta ofuscada, sin INSERT ni segundo customer)
Click en el link → /cuenta/confirmado?code=… → PublicApp → storeSupabase (PKCE) exchangeCode → sesión 'sb-teknergy-store'
  (cliente admin: detectSessionInUrl=false en /cuenta* → no toca la URL; si el verifier no existe [otro dispositivo] → "Email confirmado, iniciá sesión")

Pedido
CartPage → CheckoutPage → storeService.createOrder(items{product_key,quantity}, notes)
  → rpc store_create_order (JWT del cliente) → valida/recalcula → orders Pending web + items
  → [F3] trg_notificar_pedido_web → notificaciones × usuarios con pedidos.view → Realtime → NotificationBell
Vendedor → /pedidos?origen=web (bandeja) → list_pending_web_orders → approve_web_order
  → lock order+lotes → check stock → Approved, seller=approver → trigger descuenta → cliente lo ve en /cuenta/pedidos
```

## Front

**Rutas** (`App.tsx`): `<Route element={<PublicApp/>}>` con `/`, `/tienda`, `/tienda/p/:productKey`, `/tienda/carrito`, `/tienda/checkout`, `/cuenta`, `/cuenta/registro`, `/cuenta/confirmado`, `/cuenta/pedidos` + `<Route path="*" element={<AdminApp/>}/>`. En `AdminApp`: el layout pierde `path="/"` y pasa a ser pathless; `index` se reemplaza por `/inicio`; los fallbacks y `Navigate to="/"` pasan a `/inicio`; `LoginView` respeta `location.state.from`. **Guards**: `StoreAuthGuard` (sin sesión de tienda → `/cuenta`). El `ProtectedRoute` actual no cambia: un cliente no tiene `user_profiles`, así que `getBootstrapData` devuelve `null` de forma explícita (hoy pasa por un TypeError accidental) → `/login`.

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `src/App.tsx` | Modify | Router delgado: PublicApp/AdminApp lazy, ReloadPrompt global |
| `src/AdminApp.tsx` | Create | El `AppContent` actual movido tal cual + `/inicio` + `refreshSession` cuando cambia el rol |
| `src/config/supabaseClient.ts` | Modify | `detectSessionInUrl: !isStorePath(location.pathname)` |
| `src/config/storeSupabaseClient.ts` | Create | Cliente de tienda (storageKey propia, pkce) |
| `src/config/storePaths.ts` | Create | `isStorePath()`, constantes de rutas |
| `src/config/brand.ts` | Modify | `CONTACT: { SALES_EMAIL:'ventas@teknergy.com' /* PLACEHOLDER */, SALES_PHONE:'50300000000' /* PLACEHOLDER */ }`. La landing usa solo `CONTACT`. `SUPPORT_EMAIL`/`PHONE_BODEGA` quedan para uso interno (PDF/WA) |
| `src/config/env.ts` (o en `storeService`) | Create | `VITE_STORE_TENANT_ID`, `VITE_STORE_CAPTCHA_ENABLED=false` |
| `src/services/storeService.ts` | Create | Wrappers de RPC + mapeo de errores (`too_many_pending`→clave i18n) |
| `src/services/storeAuthService.ts` | Create | signUp/signIn/signOut/session con `storeSupabase`; `captchaToken` opcional |
| `src/services/authService.ts` | Modify | `getBootstrapData` devuelve `null` si `data.error` |
| `src/services/orderService.ts` | Modify | Inserts con `origin:'interno'` explícito; `approveWebOrder`, `rejectWebOrder`, `listPendingWebOrders` |
| `src/services/productService.ts` + `storageService.ts` | Modify | `uploadProductImage(file)` (validación tipo/tamaño) + guardar `image_url` |
| `src/store/cartStore.ts` | Create | zustand + `persist` (`localStorage 'teknergy-cart-v1'`, version + migrate). Guarda `{productKey,name,price,imageUrl,qty}`. El precio es solo estimado |
| `src/store/storeSessionStore.ts` | Create | Sesión del cliente (onAuthStateChange de `storeSupabase`) |
| `src/ui/features/store/PublicApp.tsx` | Create | Shell: `StoreHeader` + `<Outlet/>` + `StoreFooter`, sin bootstrap admin |
| `src/ui/features/store/pages/*` | Create | `LandingPage`, `CatalogPage`, `ProductDetailPage`, `CartPage`, `CheckoutPage`, `AccountPage` (login), `RegisterPage`, `EmailConfirmedPage`, `MyOrdersPage` (containers) |
| `src/ui/features/store/components/*` | Create | Presentacionales: `ProductCard`, `ProductGrid`, `AvailabilityBadge`, `ProductImage` (placeholder), `QuantityStepper`, `CartLine`, `CartSummary`, `StoreHeader`, `StoreFooter`, `HeroSection`, `ContactSection`, `LoginForm`, `RegisterForm`, `OrderStatusList`, `CaptchaSlot` (no-op en v1) |
| `src/ui/features/store/hooks/*` | Create | `useCatalog`, `useProduct`, `useMyOrders` |
| `src/ui/features/orders/WebOrdersInbox.tsx` (+ ruta `/pedidos/web`) | Create | Bandeja con Aprobar/Rechazar (`ConfirmModal`) |
| `src/ui/features/orders/OrderListView.tsx` | Modify | Tab/link a la bandeja web + chip "Web" por `origin` |
| `src/ui/features/products/components/AddProductModal.tsx` | Modify | Campo de imagen (preview + placeholder) |
| `src/ui/layout/NotificationBell.tsx` | Modify | `pedido_web` → `/pedidos/web` (los demás tipos no cambian) |
| `src/ui/layout/MainLayout.tsx` | Modify | "Inicio" → `/inicio` |
| `src/ui/components/ProtectedRoute.tsx` | Modify | `Navigate to="/inicio"` |
| `vite.config.ts` + `pwa.config.ts` (nuevo) | Modify/Create | Opciones PWA extraídas para poder testearlas |
| `index.html` | Modify | `lang="es"`, título y descripción neutros/landing |
| `public/locales/{es,en}/common.json` | Modify | Namespace `store.*` + `orders.web.*` + `inventory.image.*` |
| `supabase/functions/manage-users/index.ts`, `invite-employee/index.ts` | Modify | Invitación + nonce + `app_metadata` |
| `supabase/rollback/*.down.sql` | Create | Un down por migración (convención nueva, se aplica a mano) |
| `supabase/tests/sql/*.test.sql` | Create | Verificación SQL (ver Testing) |
| `e2e/auth.spec.ts` | Modify | `toHaveURL(/\/inicio$/)` |
| `e2e/store.spec.ts` | Create | Landing anon, catálogo, redirect admin |

Estilos: tokens de `index.css` (primary `#172C6B`). Nada de `max-w-xs/sm/md/lg/xl`: se usan valores arbitrarios (`max-w-[72rem]`, `max-w-[24rem]`).

**PWA (`pwa.config.ts`)**:
```ts
export const isAdminModule = (id?: string|null) => !!id && /\/src\/(AdminApp|ui\/layout|ui\/features\/(?!store\/))/.test(id);
// vite.config: rollupOptions.output.chunkFileNames = (c) => isAdminModule(c.facadeModuleId) ? 'assets/admin-[name]-[hash].js' : 'assets/[name]-[hash].js'
manifest: { name: 'Teknergy', start_url: '/inicio', scope: '/', … }
workbox: { globPatterns: ['**/*.{js,css,html,ico,png,svg}'], globIgnores: ['**/admin-*.js','**/pdf-engine-*.js'],
  runtimeCaching: [{ urlPattern: /\/assets\/(admin|pdf-engine)-.*\.js$/, handler: 'CacheFirst',
    options: { cacheName: 'admin-chunks', expiration: { maxEntries: 200, maxAgeSeconds: 2592000 } } }],
  navigateFallback: 'index.html', navigateFallbackDenylist: [/^\/api\//], cleanupOutdatedCaches: true, clientsClaim: true, skipWaiting: true }
devOptions: { enabled: false }
```

**i18n** (es/en, en ambos archivos): `store.nav.{catalog,cart,account,staffLogin}`, `store.landing.{heroTitle,heroSubtitle,cta,contactTitle}`, `store.catalog.{search,empty,available,soldOut,addToCart,price}`, `store.cart.{title,empty,estimatedTotal,priceNote,checkout,remove}`, `store.checkout.{notes,cashOnDelivery,deliveryTo,submit,success}`, `store.account.{login,register,logout,email,password,fullName,phone,address,department,municipality,checkEmail,emailConfirmed,confirmOtherDevice}`, `store.orders.{title,empty,status.{Pending,Approved,InPreparation,Delivered,Cancelled}}`, `store.errors.{auth_required,email_unconfirmed,store_unavailable,too_many_pending,product_unavailable,invalid_quantity,too_many_items,generic}`, `orders.web.{inbox,approve,reject,rejectReason,insufficientStock,originWeb}`, `inventory.image.{label,invalidType,tooLarge,uploadError}`, `notifications.pedido_web.title`.

## Estrategia de testing (Strict TDD)

| Fase | Capa | Qué | Cómo |
|------|------|-----|------|
| F0 | SQL | Claims, fallback, escalada por updateUser, guard de `role`, sync, ramas de `handle_new_user` (invitación válida, nonce incorrecto, metadata maliciosa, fallo → alta OK), RPCs blindadas | **Migraciones autoverificables** (no hay staging, ni SQL editor, ni Supabase local): cada migración va en `BEGIN; … COMMIT;` y antes del `COMMIT` un `DO` de assertions con `RAISE EXCEPTION` + mensaje claro. Parte catálogo (`pg_proc`, `pg_policies`, `pg_trigger`, privilegios) y parte comportamiento: JWT simulados con `set_config('request.jwt.claims', …, true)`, `SET LOCAL ROLE authenticated`, sobre datos reales o fixtures que viven dentro de un sub-bloque con excepción centinela (`ZZ001`) que Postgres revierte (sin dejar filas, sin side effects fuera de la transacción). Si falla algo, TODA la migración se revierte y la BD queda igual. `supabase/tests/sql/f0_claims.test.sql` se conserva como referencia/documentación de los escenarios (ACH-xx); no es el mecanismo de verificación. Además, las migraciones se validaron fuera del repo contra un Postgres 16 desechable (podman) con stubs de `auth`, incluyendo mutaciones que confirman que las assertions fallan cuando deben |
| F0 | Unit | `authService.getBootstrapData` devuelve null ante `{error}`; edge functions: helper puro `buildInvitePayload` | vitest con supabase mockeado |
| F1 | SQL | Payload sin columnas internas, agrupación, Agotado, tienda deshabilitada, anon SELECT directo = 0, storage cross-tenant | `f1_catalog.test.sql` (`SET LOCAL role anon`) |
| F1 | Unit/Integración | `isAdminModule`, opciones PWA (`globIgnores`, `start_url`, `devOptions`), `isStorePath`, ruteo (`/` → PublicApp sin llamar a `getBootstrapData`; `/inventario` → AdminApp), `ProductCard`/`AvailabilityBadge`/placeholder, validación de la imagen | vitest + RTL con lazy mockeado y `vi.mock('services/authService')` para asertar 0 llamadas |
| F2 | SQL | Todas las validaciones de `store_create_order` (vacío, 0/-1/1.5, máximos, duplicado, otro tenant, agotado, precio manipulado, lote más antiguo, sin descuento de stock, límite de Pending, no confirmado) | `f2_web_orders.test.sql` |
| F2 | Unit | `cartStore` (agregar, bloquear agotado, persistencia y migración), `storeService` (mapeo de errores), `storeAuthService` (usa `storeSupabase`, logout `local`), clientes con storageKeys distintos | vitest |
| F3 | SQL | Aprobación OK/stock insuficiente/doble aprobación/sin permiso/cliente, trigger Draft→Approved sin cambios, legacy Pending interno no descuenta, policy `own` vs cross-tenant, fan-out 3 de 4, aislamiento de tenant. Concurrencia: dos sesiones del SQL editor con `BEGIN` manual (paso documentado) | `f3_approval.test.sql` |
| F3 | Unit | `NotificationBell` enruta `pedido_web`, `WebOrdersInbox` (aprobar/rechazar/error de stock) | vitest + RTL |
| Todas | E2E | Regresión admin (los specs existentes, con `/inicio`), landing/catálogo anon, redirect de admin anon | Playwright contra el entorno `e2e.env` |

## Despliegue y rollback

Flujo (actualizado 2026-11-27): todo cambio de BD viaja por el repo; un push a `main` aplica `supabase/migrations` automáticamente (integración GitHub de Supabase). No hay staging, no hay Supabase local y el equipo no usa el SQL editor.

1. Se trabaja en la rama `feat/tienda-web-clientes`; se mergea a `main` **por fase/batch**. Nunca se edita una migración ya aplicada (se corrige hacia adelante con una nueva).
2. Cada migración es idempotente-segura (`CREATE OR REPLACE`, `IF NOT EXISTS`, `DROP … IF EXISTS`), no depende de pasos manuales y se autoverifica (si falla, no se aplica nada).
3. Rollback = migración hacia adelante preparada en `supabase/rollback/*.down.sql` (NO en `migrations/`), que se copia a `migrations/` con timestamp nuevo solo si hace falta. También autoverificable.
4. **Smoke check manual post-merge** (lo hace una persona, no es SQL): entrar a la demo como admin, ver el menú completo, abrir inventario/pedidos. Si algo falta, usar el rollback.

Orden de fases: F0 (0a → 0b → 0c, deploy de edge functions, 0d) → F1 (migraciones, luego front) → F2 (migraciones; `store_enabled=true` y "Confirm email" ON en el dashboard; Redirect URLs `+/cuenta/confirmado`; recién ahí el front) → F3.

**Acoplamiento 0b ↔ edge functions**: tras 0b, `handle_new_user` solo crea perfil con invitación en `staff_invitations`. `manage-users` (CREATE_USER) hace su propio upsert de `user_profiles` y sigue funcionando; `invite-employee` depende hoy de que el trigger cree el perfil y dejaría de crearlo hasta A2.4 (edge function actualizada y desplegada). Recomendación: mergear 0a primero y 0b junto con A2.4, o aceptar que "invitar empleado" por `invite-employee` queda roto en la demo entre ambos.

| Fase | Rollback (migración hacia adelante preparada en `supabase/rollback/*.down.sql`, se copia a `migrations/` con timestamp nuevo; ya implementados 0a/0b, autoverificables y probados en round-trip) |
|------|------------------------------------------|
| 0a | Restaurar `get_auth_*` y la policy v3 originales (texto copiado), drop de los triggers guard/sync y de `staff_invitations`. `app_metadata` se deja (inocuo) |
| 0b | Restaurar `handle_new_user` original; `store_enabled=false`; las columnas nullable pueden quedar |
| 0c | Restaurar las definiciones previas de las RPCs (no recomendado) |
| 0d | Reaplicar la versión con fallback a `user_profiles` |
| F1/F2/F3 | Revert del front en Vercel; `DROP FUNCTION` de las RPCs nuevas; restaurar el trigger de stock. Para volver `seller_id` a NOT NULL: antes aprobar/cancelar o asignar los web Pending |

## Preguntas abiertas

- [ ] ¿Partir la cantidad entre lotes cuando el lote más antiguo no alcanza? Hoy la aprobación falla y el vendedor rechaza.
- [ ] ¿Qué roles reciben `pedidos.can_approve`? El seed solo cubre admin/supervisor; vendedor queda a criterio del admin en RoleMatrix.
- [ ] Valores reales de `CONTACT` en `brand.ts` (por ahora placeholders).
- [x] ~~Verificar en staging la query de auditoría de DEFINER~~ Reemplazado: auditoría estática de `supabase/migrations` (ver sección siguiente); 0c cubre las funciones listadas. Pendiente de confirmar en vivo solo si el equipo crea objetos fuera del repo.
