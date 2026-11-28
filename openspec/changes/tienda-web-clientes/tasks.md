# Tasks: Tienda web para clientes finales

> Nota de tamano: excede el presupuesto de 530 palabras. El orquestador pidio batches, archivos, criterios y pasos manuales. Cada batch = una corrida de sdd-apply.
> Actualizado 2026-11-27: el equipo NO usa el SQL editor, no hay staging ni Supabase local. Todo cambio de BD viaja por el repo: push a `main` aplica `supabase/migrations`. Por eso cada migracion es AUTOVERIFICABLE (BEGIN...COMMIT con bloques DO de assertions que hacen `RAISE EXCEPTION` y revierten todo) y el rollback es una migracion hacia adelante preparada en `supabase/rollback/`. Trabajo en la rama `feat/tienda-web-clientes`, merge a `main` por fase. Los `supabase/tests/sql/*.test.sql` quedan como referencia/documentacion de escenarios. Strict TDD: RED (assertions escritas / test falla) -> GREEN -> REFACTOR; para SQL la prueba vive dentro de la migracion. Runner JS: `npx vitest run`.
> Post-merge manual de cada fase con migraciones: entrar a la demo como admin y comprobar que ve el menu completo.
> Leyenda: [MANUAL] = paso del usuario (ya NO incluye correr SQL en el editor: solo deploys, dashboards, Vercel y el smoke check post-merge). Escenarios entre parentesis = spec (ACH auth-claims-hardening, PI product-images, PSR public-storefront-routing, SCA store-customer-accounts, SPC store-public-catalog, SWO store-web-orders, WOA web-order-approval).

## Ajustes al spec/design por decisiones finales

- **FIFO split**: `store_create_order` parte la cantidad entre lotes (mas antiguo primero) y genera 1 `order_items` por lote. Ajustar design (tabla "Lote del pedido" y sketch) y spec SWO "Lote mas antiguo": agregar escenario "Cantidad parte lotes" (lote viejo 3, pedido 5 -> items 3 + 2 en lotes distintos). Si el stock total < cantidad, PENDIENTE de decidir (propuesta: crear igual con el remanente en el ultimo lote; la aprobacion valida). `approve_web_order` ya suma por `product_id`, sirve sin cambio; el test debe cubrir multi-lote.
- **Aprobacion**: solo admin y supervisor (`pedidos.can_approve`); sin seed para vendedor.
- **Contacto**: placeholders en un unico lugar (`brand.ts` `CONTACT`).
- **PWA**: `chunkFileNames` con prefijo `admin-` (no `manualChunks`).
- **Dependencia dura**: NO habilitar signup de tienda (F2: `store_enabled=true`, "Confirm email", deploy del front de cuenta) hasta aplicar la migracion 0d. (Actualizado 2026-11-27: 0d ya no es una espera de seguridad de >=1 h; el fallback es a `user_profiles`, nunca a `user_metadata`. 0d es limpieza y gate.)
- **Fallback B (2026-11-27)**: `get_auth_tenant_id/roles` leen `app_metadata` y, si esta vacio, `user_profiles` por `auth.uid()` (DEFINER, `search_path` fijo). 0a incluye el guard BEFORE UPDATE de `user_profiles` (H3).
- **Cambio de orden (2026-11-27, aprobado)**: F1 (batches B) se despliega ANTES de terminar F0 (0b/0c/0d). F2 (signup) sigue bloqueado hasta F0 completo (0d). Los commits de B1 se llevan a `main` por cherry-pick SIN 0b.
- **Orden de migraciones (gotcha)**: 0b (`20261127100000`) y 0c (`20261127110000`) tienen timestamp ANTERIOR a las migraciones B1 (`20261128090000`, `20261128100000`) que se aplican antes. Supabase rechaza migraciones fuera de orden. **Antes de mergear 0b (y 0c) a `main`, renombrarlas (y sus `.down.sql`) con un timestamp posterior a la ultima migracion aplicada** (ver A2.0). No renombrar ahora.
- **Independencia de B1 respecto de 0b**: B1.3 crea `tenants.store_enabled` + `uq_tenants_single_store_enabled` con `IF NOT EXISTS` y la misma definicion que 0b; 0b es un no-op sobre esas piezas (verificado en ambos ordenes, con y sin tienda habilitada).
- **Acoplamiento 0b/edge functions**: tras 0b, `invite-employee` deja de crear el perfil (lo hacia el trigger con metadata) hasta A2.4. Mergear 0b junto con A2.4 o asumir la ruptura de esa funcion en la demo. `manage-users` no se afecta (hace upsert propio).

## F0 - Claims y signup seguros

### Batch A0 - Preparacion y SQL tests RED (4 tareas)
- [x] A0.1 [MANUAL] Permiso del usuario para `npm install` (node_modules no esta instalado); ejecutar y confirmar `npx vitest run` arranca.
- [x] A0.2 Crear `supabase/tests/sql/f0_claims.test.sql` (RED): escalada por updateUser (roles/tenant), app_metadata prevalece, fallback solo con app_metadata vacio, cliente sin claims -> NULL, guard de `user_profiles.role`, ramas de `handle_new_user` (invitacion valida, nonce incorrecto, metadata maliciosa, fallo -> alta OK). (ACH todos)
- [x] A0.3 Crear `supabase/rollback/` con convencion `NNNN.down.sql` y plantilla; guardar el texto ORIGINAL de `get_auth_tenant_id`, `get_auth_roles`, `user_profiles_select_policy_v3`, `handle_new_user`, `create_direct_order_atomic`, `confirm_order_atomic` copiado de las migraciones previas.
- [x] A0.4 (Convertida 2026-11-27: el usuario no puede correr la query) Auditoria ESTATICA de `supabase/migrations`: funciones SECURITY DEFINER que confian en ids de tenant/vendedor/usuario del caller o sin chequeo de tenant. Hallazgos (funcion, migracion, riesgo, accion 0c) en `design.md` > "Auditoria estatica de funciones SECURITY DEFINER". `supabase/tests/sql/audit_definer_exec.sql` se conserva solo como referencia.

### Batch A1 - Migraciones 0a/0b (3 tareas)
- [x] A1.1 `supabase/migrations/20261127090000_endurecer_claims_app_metadata.sql` (staff_invitations, guard trigger, sync_user_claims, backfill, get_auth_* con fallback B a `user_profiles` y sin default 'vendedor', policy v3, bloques DO de autoverificacion catalogo + comportamiento) + `supabase/rollback/20261127090000_endurecer_claims_app_metadata.down.sql` (autoverificable).
- [x] A1.2 `supabase/migrations/20261127100000_handle_new_user_ramificado.sql` (store_enabled + indice unico parcial, customers.auth_user_id/email, handle_new_user con EXCEPTION, autoverificacion de las ramas invitacion/tienda/hostil/fallo) + `supabase/rollback/20261127100000_handle_new_user_ramificado.down.sql`. CHECK de `customers.price_type` verificado: el insert usa el default 'cliente'.
- [ ] A1.3 [MANUAL] Merge a `main` (el push aplica 0a y 0b solas; si una autoverificacion falla no se aplica nada). Smoke check: entrar como admin y ver el menu completo. Ver el acoplamiento 0b/`invite-employee` arriba: considerar mergear solo 0a ahora y 0b con A2.4.

### Batch A2 - Blindaje RPC 0c + edge functions + front auth (7 tareas)
- [x] A2.0 [OBSOLETA 2026-11-27] 0b (`20261127100000`) ya se aplico en `main` (PR #2 del repo la arrastro antes de lo planeado), asi que NO se renombra: renombrar una migracion aplicada rompe el historial. Solo 0c se renombro de plan: `20261127110000_blindar_rpcs_definer` -> `20261129090000_blindar_rpcs_definer` (posterior a `20261128100000`, la ultima aplicada; 0d debe usar un timestamp POSTERIOR a `20261129090000`). Consecuencia conocida: entre el merge de 0b y el deploy de las edge functions de A2.4, `invite-employee` no crea perfil (ver A2.6).
- [x] A2.1 RED: assertions de 0c escritas ANTES que la implementacion (bloques DO de catalogo + comportamiento al final de la migracion; corridas solas contra la BD previa fallan con `no existe public.assert_internal_user`). Escenarios documentados en `f0_claims.test.sql` (ACH-24..31) y en `supabase/tests/sql/f0_rpc_hardening.test.sql` (H1..H12, dos tenants, prueba local en Postgres desechable).
- [x] A2.2 `supabase/migrations/20261129090000_blindar_rpcs_definer.sql` + `supabase/rollback/20261129090000_blindar_rpcs_definer.down.sql` autoverificables: `assert_internal_user(p_tenant_id)`; `create_direct_order_atomic`, `confirm_order_atomic`, `get_report_*`, `get_dashboard_metrics`, `get_sales_trend`, `sync_inventory_catalog`, `next_order_number` con tenant de las claims + permisos; `fn_crear_notificacion`, `fn_notificar_preparador_y_admins_planilla`, `seed_default_permissions` REVOKE (sin llamadores INVOKER, verificado dentro de la migracion); `fn_notificar_aprobadores_planilla` con guard de tenant (la llama `enviar_a_aprobacion`, INVOKER: se conserva EXECUTE a authenticated); `log_tech_error`/`increment_error_metrics` ignoran el tenant del parametro; nueva `revoke_user_sessions(uuid)` solo service_role. Mismas firmas: el front no cambia.
- [x] A2.3 RED->GREEN vitest `src/services/authService.test.ts` (6 tests): `getBootstrapData` devuelve `null` si `data.error`/sin `data`/sin `profile` (sin caer al fallback); `src/services/authService.ts` modificado.
- [x] A2.4 RED->GREEN: `supabase/functions/_shared/invitePayload.ts` (`buildInvitePayload`, `normalizeRoles`, `isAdminOrSupervisor`, `canAssignRoles`) y `_shared/userAdmin.ts` (`inviteWithInvitation`, `revokeUserSessions`, cliente inyectado) con 24 tests; `manage-users` (CREATE_USER, UPDATE_USER, TOGGLE_ACTIVE) e `invite-employee` usan: insert `staff_invitations` -> nonce -> `inviteUserByEmail` (metadata sin roles/tenant) -> `updateUserById(app_metadata)`; limpia la invitacion si falla; UPDATE_USER sin roles en `user_metadata`. Ademas `invite-employee` corrige el chequeo de rol (`role` es text[]: `!== 'admin'` rechazaba a todos) y agrega anti-escalacion. (ACH Invitar empleado, Cambio de rol)
- [x] A2.5 `auth.admin.signOut(id,'global')` en `TOGGLE_ACTIVE` CONFIRMADO como incorrecto: `GoTrueAdminApi.signOut(jwt: string, scope)` (auth-js 2.97.0, `.d.ts` y `.js`) recibe un JWT, no un user id; la llamada nunca podia funcionar (solo logueaba WARN). Corregido con `revokeUserSessions` -> RPC `revoke_user_sessions` (DELETE de `auth.sessions`, solo service_role) y test que garantiza que nunca se llama `signOut` con un id. El baneo (`ban_duration`) ya impedia renovar el token; un access token ya emitido vive hasta su expiracion (<=1 h). El `signOut()` del front admin (`authService.logout`) usa el scope global por defecto de supabase-js: sin cambios.
- [ ] A2.6 [MANUAL] Merge a `main` (aplica 0c; las edge functions declaradas en `supabase/config.toml` se despliegan por la integracion GitHub de Supabase con "Deploy to production" activo, NO hace falta `supabase functions deploy`: verificar en el dashboard > Edge Functions que `manage-users` e `invite-employee` muestran version/fecha nuevas); probar invitar empleado real (ambas funciones); desactivar y reactivar un usuario de prueba; cerrar sesion y volver a entrar con cada usuario interno (refresca JWT y toma `app_metadata`).

### Batch A3 - Migracion 0d (2 tareas) - GATE de F2
- [x] A3.1 (HECHO: `20261130090000_retirar_fallback_user_profiles.sql` + `rollback/20261130090000_retirar_fallback_user_profiles.down.sql`; gate anti-lockout + prueba con el JWT real de cada interno activo; validado RED/GREEN/mutantes/ida-vuelta en PG16 podman) `supabase/migrations/<timestamp posterior a 20261129090000 (0c)>_retirar_fallback_user_profiles.sql` (el `20261128090000` ya lo usa B1.2 y el `20261129090000` 0c) + `.down.sql` (renombrada: el fallback ya es a `user_profiles`, no a `user_metadata`) autoverificables: con el fallback retirado, un JWT sin claims no da tenant y todos los usuarios internos tienen `app_metadata`.
- [ ] A3.2 [MANUAL] Merge a `main` (aplica 0d; ya no hay espera de >=1 h por seguridad, la propia migracion verifica que todos los internos tienen `app_metadata`). Smoke check admin. **No avanzar a F2 sin esto.**

## F1 - Catalogo publico, imagenes, shell publico y PWA

### Batch B1 - Imagenes y RPCs de catalogo SQL (4 tareas)
- [x] B1.1 RED `supabase/tests/sql/f1_catalog.test.sql` (referencia: mapea cada escenario SPC/PI a su assertion C1..C12 / I1..I7 dentro de las migraciones): payload sin cost/stock/lote/proveedor, agrupacion, Agotado, inactivo, tienda deshabilitada/inexistente, anon SELECT directo = 0, `store_get_product` inexistente, storage escritura anon/cliente/cross-tenant rechazada. (SPC todos, PI Lectura/Escritura)
- [x] B1.2 `supabase/migrations/20261128090000_imagenes_productos.sql` + `supabase/rollback/20261128090000_imagenes_productos.down.sql` (timestamp movido de 20261201 a 20261128 por el cambio de orden): `products.image_url`, bucket `product_images` (public, 2 MB, jpeg/png/webp), policies de storage (INSERT create|edit, UPDATE/DELETE edit, SELECT solo authenticated del tenant; anon sin policies). Autoverificable (catalogo + fixtures I1..I7).
- [x] B1.3 `supabase/migrations/20261128100000_rpcs_catalogo_tienda.sql` + `supabase/rollback/20261128100000_rpcs_catalogo_tienda.down.sql`: `store_catalog_groups` (interna, sin EXECUTE a anon/authenticated), `store_list_products`, `store_get_product` (DEFINER, search_path, REVOKE PUBLIC/GRANT a anon+authenticated, limit 1..100). Crea `tenants.store_enabled` + indice unico parcial idempotentes (independiente de 0b). Autoverificable (catalogo + fixtures C1..C12).
- [ ] B1.4 [MANUAL] Merge a `main` por cherry-pick de los commits de B1 SIN 0b (el push aplica ambas; si una autoverificacion falla no se aplica nada). Smoke check admin (menu completo, inventario y productos cargan) + subir una imagen cuando exista B3. NOTA: el `UPDATE tenants SET store_enabled=true` NO va en B1 (va en B4.6, ver abajo).

### Batch B2 - Config, PWA y routing base (7 tareas)
- [x] B2.1 RED->GREEN `src/config/storePaths.ts` + test (`isStorePath`, constantes de rutas).
- [x] B2.2 RED->GREEN `pwa.config.ts` + test (`isAdminModule`, `globIgnores`, `start_url:'/inicio'`, `devOptions.enabled=false`); modificar `vite.config.ts` con `chunkFileNames` (prefijo `admin-`). (PSR PWA)
- [x] B2.3 Modificar `src/config/brand.ts`: `CONTACT {SALES_EMAIL:'ventas@teknergy.com', SALES_PHONE:'50300000000'}` marcados PLACEHOLDER, unico lugar de contacto. Test: la landing no usa `SUPPORT_EMAIL`/`PHONE_BODEGA`. (PSR Contacto)
- [x] B2.4 Crear `src/config/env.ts` (`VITE_STORE_TENANT_ID`, `VITE_STORE_CAPTCHA_ENABLED=false`) y `src/config/storeSupabaseClient.ts` (storageKey `sb-teknergy-store`, pkce, detectSessionInUrl solo `/cuenta*`); modificar `src/config/supabaseClient.ts` (`detectSessionInUrl: !isStorePath(...)`). Test: storageKeys distintos. (PSR Aislamiento)
- [x] B2.5 RED->GREEN: mover `AppContent` a `src/AdminApp.tsx` (+ `/inicio`, fallbacks y `Navigate` a `/inicio`, `LoginView` respeta `location.state.from`, `refreshSession` al cambiar rol); modificar `MainLayout.tsx`, `ProtectedRoute.tsx`, `e2e/auth.spec.ts` (`/inicio`). (PSR Dashboard movido, Admin sin sesion, Cliente en ruta admin)
- [x] B2.6 RED->GREEN: `src/App.tsx` router delgado (PublicApp/AdminApp lazy, ReloadPrompt global). Test RTL: `/` no llama `getBootstrapData`; `/inventario` monta AdminApp. (PSR Landing, Sin bootstrap admin, Rutas admin intactas)
- [x] B2.7 Modificar `index.html` (`lang="es"`, titulo/descripcion landing) y `public/locales/{es,en}/common.json` (claves `store.*` para esta fase, `inventory.image.*`).

> Nota B2 (implementado): `PublicApp` aun no existe, asi que `App.tsx` usa un gate interino `RootGate` en `/` (sesion -> `/inicio`, sin sesion -> `/login`, conserva search/hash; sin bootstrap admin). B4.4 lo reemplaza por la landing. `isStorePath` cubre solo `/tienda*` y `/cuenta*` ("/" excluido a proposito: el Site URL de Supabase puede traer tokens admin). `lazyWithRetry` se extrajo a `src/utils/lazyWithRetry.ts`. `src/test/setup.ts` suma un shim de `localStorage` (Node >= 25 lo rompe en jsdom).

### Batch B3 - Imagen en inventario (3 tareas)
- [x] B3.1 RED->GREEN `uploadProductImage(file)` en `storageService.ts` + `productService.ts` (valida tipo jpg/png/webp y 2 MB, ruta `{tenant}/{product}-{ts}.webp`, guarda `image_url`). Test vitest con supabase mockeado. (PI Subir valida, Archivo invalido)
- [x] B3.2 Modificar `AddProductModal.tsx`: campo imagen con preview y mensajes i18n es/en.
- [x] B3.3 Crear `ProductImage` (placeholder) en `src/ui/features/store/components/` con test. (PI Producto sin imagen)

> Nota B3 (implementado): la imagen es POR GRUPO de catalogo (tenant + lower(nombre) + calibre + calidad): `productService.setProductImage` sube un objeto `{tenant}/{product}-{ts}.{ext}` (ext real segun mime; upsert=false, cacheControl 1 anio; el timestamp hace la URL unica = cache busting) y hace UPDATE de `image_url` en TODOS los lotes del grupo; si el UPDATE falla o afecta 0 filas borra el objeto subido; tras el UPDATE borra los objetos viejos que ya nadie referencia. `removeProductImage` pone NULL en el grupo. UI: `ProductImageControl` (miniatura + camara + quitar) en cada fila/tarjeta de Inventario y campo de imagen en `AddProductModal`, ambos solo con `inventario.can_edit`. Claves nuevas `inventory.image.{hint,remove,updated,removed,uploadAfterCreate}`.

### Batch B4 - Paginas publicas (catalogo y landing) (6 tareas)
- [x] B4.1 RED->GREEN `storeService.ts` (`listProducts`, `getProduct`, mapeo de errores) + test.
- [x] B4.2 RED->GREEN presentacionales `AvailabilityBadge`, `ProductCard`, `ProductGrid`, `HeroSection`, `ContactSection` (usa solo `CONTACT`), `StoreHeader`, `StoreFooter` con tests.
- [x] B4.3 Hooks `useCatalog`, `useProduct` + containers `LandingPage`, `CatalogPage`, `ProductDetailPage`.
- [x] B4.4 `PublicApp.tsx` (shell: header + Outlet + footer, sin bootstrap admin) y cableado de rutas `/`, `/tienda`, `/tienda/p/:productKey`.
- [x] B4.5 `e2e/store.spec.ts`: landing anon, catalogo, anon en `/inicio` -> `/login`.
- [ ] B4.6 [MANUAL] Setear en Vercel `VITE_STORE_TENANT_ID` (y `VITE_STORE_CAPTCHA_ENABLED=false`); habilitar la tienda del tenant demo VIA MIGRACION (no SQL editor): `supabase/migrations/<ts>_habilitar_tienda_demo.sql` autoverificable que hace `UPDATE tenants SET store_enabled=true` SOLO si existe exactamente UN tenant activo (si no, `RAISE NOTICE` y no-op) y asserta el resultado (hasta F2 no hay signup, pero ojo: si 0b ya esta aplicada, `store_enabled=true` activa la rama tienda de `handle_new_user`; por eso no habilitar antes de A3); desplegar; probar `/`, `/tienda`, PWA instalada arranca en `/inicio`; limpiar SW antiguo.

> Nota B4 (implementado, sin commitear): `PublicApp` (shell lazy: header + `<main id="contenido">` + footer) con rutas `/`, `/tienda`, `/tienda/p/:productKey` en `App.tsx` (paginas lazy; `PublicShell` es el layout). `/` con enlace de email de Supabase (`hasAuthLinkParams`: access_token/refresh_token/token_hash/error*/type=invite|recovery|signup|magiclink|email_change en search o hash) NO muestra la landing: usa `RootGate` (con sesion -> /inicio, sin sesion -> /login, conservando search+hash). Usuario interno con sesion en `/`: ve la landing + boton "Ir al panel" (`useStaffSession` lee solo `getSession` local; sin bootstrap admin). `ErrorBoundary` "Inicio" ahora usa `homePathFor` (admin -> /inicio, publico -> /). Landing: hero navy + CTA, 4 propuestas de valor, destacados (RPC anon; se oculta si no hay tienda/vacio/error), "Como pedir" (4 pasos, pasos 1-2 "Proximamente", sin botones), contacto (`CONTACT`), footer con "Acceso empleados" -> /login. Catalogo: busqueda con debounce 300 ms (RPC), tope 100 grupos (limite del RPC), estados cargando/vacio/sin resultados/"Catalogo no disponible" (sin `VITE_STORE_TENANT_ID`)/error con reintento. Detalle: boton "Pedir (proximamente)" deshabilitado. `/cuenta` sigue sin pagina (lo atiende AdminApp hasta C2). `VITE_STORE_CAPTCHA_ENABLED` sin consumidores en B4 (CaptchaSlot es C2). Migracion `20261201090000_habilitar_tienda_demo.sql` (+ rollback) autoverificable; `store_enabled` solo si hay EXACTAMENTE 1 tenant activo (imprime el id en un NOTICE = `VITE_STORE_TENANT_ID`). Fix colateral: `ProductImage` sin setState en efecto (lint react-hooks).

> Nota: el signup de tienda queda deshabilitado en F1 (sin paginas de registro) y el trigger 0b ya esta activo; 0d debe estar aplicado antes de F2.

## F2 - Cuentas de cliente y pedidos web (requiere 0d aplicado)

### Batch C1 - SQL de pedidos web (5 tareas)
- [ ] C1.1 RED `supabase/tests/sql/f2_web_orders.test.sql`: vacio, 0/-1/1.5, maximos, duplicado, otro tenant, agotado, precio manipulado, tenant/customer falsificado, tienda deshabilitada, no confirmado, limite de Pending, sin descuento de stock, **split FIFO entre lotes (items multiples)**, anon rechazado, origin interno intacto. (SWO todos, SCA Ver solo lo propio/Acceso a otro cliente)
- [ ] C1.2 `supabase/migrations/20261208090000_pedidos_web_origen.sql` (+down): `orders.origin`, `seller_id` nullable + CHECK, `rejection_reason`, indice parcial.
- [ ] C1.3 `supabase/migrations/20261208100000_rpc_store_create_order.sql` (+down): `store_create_order` con split FIFO (ordena lotes `entry_date NULLS LAST, created_at`, un `order_items` por lote, precio del lote), `store_get_my_account`, `store_list_my_orders`; REVOKE/GRANT solo authenticated.
- [ ] C1.4 Actualizar `design.md` y `specs/store-web-orders/spec.md` con el split FIFO y la regla de stock total insuficiente.
- [ ] C1.5 [MANUAL] Merge a `main` (aplica y autoverifica; `f2_web_orders.test.sql` como referencia). Smoke check admin. Aun NO habilitar el front de cuenta.

### Batch C2 - Auth de tienda y carrito (6 tareas)
- [ ] C2.1 RED->GREEN `src/store/cartStore.ts` (zustand persist `teknergy-cart-v1`, version+migrate, bloquea Agotado, total estimado) + test. (SWO Carrito local)
- [ ] C2.2 RED->GREEN `storeAuthService.ts` (usa `storeSupabase`, logout `scope:'local'`, `captchaToken` opcional) + `storeSessionStore.ts` + tests. (SCA Login/logout aislado)
- [ ] C2.3 RED->GREEN `storeService.createOrder` y mapeo de errores a claves i18n (`too_many_pending`, `email_unconfirmed`, etc.).
- [ ] C2.4 Presentacionales `QuantityStepper`, `CartLine`, `CartSummary`, `LoginForm`, `RegisterForm`, `OrderStatusList`, `CaptchaSlot` (no-op) con tests.
- [ ] C2.5 Containers `CartPage`, `CheckoutPage` (pago contra entrega), `AccountPage`, `RegisterPage`, `EmailConfirmedPage`, `MyOrdersPage`, hook `useMyOrders`, `StoreAuthGuard`; rutas `/tienda/carrito`, `/tienda/checkout`, `/cuenta*`. (SCA Registro, Email duplicado, Mis pedidos, Sesion requerida)
- [ ] C2.6 i18n completo `store.*` (es/en); modificar `e2e/store.spec.ts`.

### Batch C3 - Habilitacion de signup (3 tareas, todos manuales)
- [ ] C3.1 [MANUAL] Confirmar que 0d esta aplicado (gate).
- [ ] C3.2 [MANUAL] Dashboard Supabase: "Confirm email" ON; Redirect URLs `+/cuenta/confirmado` (prod y preview); SMTP si aplica. Deploy del front.
- [ ] C3.3 [MANUAL] Probar: registro -> email -> `/cuenta/confirmado`; email duplicado; pedido; cliente y vendedor en el mismo navegador; logout aislado.

## F3 - Aprobacion y notificaciones

### Batch D1 - SQL de aprobacion (4 tareas)
- [ ] D1.1 RED `supabase/tests/sql/f3_approval.test.sql`: aprobacion OK (incluye pedido multi-lote), stock insuficiente sin cambios, doble aprobacion, sin permiso/cliente, vendedor sin `can_approve`, Draft->Approved sin cambios, Pending interno legacy no descuenta, policy `own` vs cross-tenant, fan-out 3 de 4, aislamiento de tenant, rechazo sin tocar stock. (WOA todos)
- [ ] D1.2 `supabase/migrations/20261215090000_aprobacion_pedidos_web.sql` (+down): trigger de stock extendido, `approve_web_order`, `reject_web_order`, `list_pending_web_orders`, policy `orders_select_web_pending`, trigger `trg_notificar_pedido_web`, seed `can_approve` solo admin y supervisor.
- [ ] D1.3 Cubrir la concurrencia (`FOR UPDATE`, doble aprobacion) con una prueba dentro de la migracion (dblink/advisory lock no disponible: documentar el razonamiento y verificar la presencia de `FOR UPDATE` en el cuerpo de la funcion via `pg_proc`) y documentar en el test de referencia el procedimiento manual de dos sesiones.
- [ ] D1.4 [MANUAL] Merge a `main` (aplica y autoverifica). Smoke check admin y prueba de punta a punta con un pedido web de prueba.

### Batch D2 - Front de aprobacion (5 tareas)
- [ ] D2.1 RED->GREEN `orderService.ts`: `origin:'interno'` explicito en inserts, `approveWebOrder`, `rejectWebOrder`, `listPendingWebOrders`.
- [ ] D2.2 RED->GREEN `src/ui/features/orders/WebOrdersInbox.tsx` + ruta `/pedidos/web` (Aprobar/Rechazar con `ConfirmModal`, error de stock insuficiente). (WOA Aprobacion, Rechazar)
- [ ] D2.3 Modificar `OrderListView.tsx` (link a bandeja + chip "Web") y claves `orders.web.*`.
- [ ] D2.4 RED->GREEN `NotificationBell.tsx`: `pedido_web` -> `/pedidos/web`, resto igual; clave `notifications.pedido_web.title`. (WOA Navegacion)
- [ ] D2.5 Regresion: `npx vitest run` completo y e2e admin. [MANUAL] logout/login de admin y supervisor para probar; ajustar `can_approve` en RoleMatrix si se quiere otro rol; test E2E manual de pedido de punta a punta.

## Pasos manuales (resumen)
1. Permitir `npm install` (A0.1).
2. Mergear a `main` por fase (A1.3, A2.6, A3.2, B1.4, C1.5, D1.4): el push aplica las migraciones y cada una se autoverifica. Smoke check post-merge: admin ve el menu completo. Nada de SQL editor ni esperas de >=1 h.
3. Deploy de edge functions `manage-users` e `invite-employee` (A2.6).
4. Logout/login de todos los usuarios internos tras 0a/0c y tras cambios de rol.
5. Vercel: `VITE_STORE_TENANT_ID`, `VITE_STORE_CAPTCHA_ENABLED=false` (B4.6).
6. Dashboard Supabase: "Confirm email" ON y Redirect URLs `+/cuenta/confirmado` (C3.2), solo despues de 0d.
7. `store_enabled=true` para el tenant (B4.6/C3).
8. Reemplazar placeholders de `CONTACT` en `brand.ts` con valores reales.
9. Decidir stock total insuficiente al crear pedido (C1.4).
