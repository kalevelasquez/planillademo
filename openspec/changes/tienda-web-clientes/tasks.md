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

### Batch A2 - Blindaje RPC 0c + edge functions + front auth (6 tareas)
- [ ] A2.1 RED: escribir las assertions (dentro de 0c, bloque DO de autoverificacion) para `assert_internal_user`, `create_direct_order_atomic` con tenant ajeno, `confirm_order_atomic` cross-tenant, `fn_crear_notificacion` no ejecutable por authenticated; documentar los escenarios en `f0_claims.test.sql`.
- [ ] A2.2 `supabase/migrations/20261127110000_blindar_rpcs_definer.sql` + `.down.sql` autoverificables + las funciones de la tabla de auditoria estatica en `design.md` (reportes BI, dashboard/sales_trend, sync_inventory_catalog, fn_notificar_*, seed_default_permissions, log_tech_error, increment_error_metrics, next_order_number).
- [ ] A2.3 RED->GREEN vitest `src/services/authService.test.ts`: `getBootstrapData` devuelve `null` si `data.error`; modificar `src/services/authService.ts`.
- [ ] A2.4 RED->GREEN: helper puro `buildInvitePayload` (test + modulo) y modificar `supabase/functions/manage-users/index.ts` (CREATE_USER, UPDATE_USER) e `invite-employee/index.ts`: insert `staff_invitations` -> nonce -> `inviteUserByEmail` -> `updateUserById(app_metadata)`; limpiar invitacion si falla; UPDATE_USER sin escribir roles en `user_metadata`. (ACH Invitar empleado, Cambio de rol)
- [ ] A2.5 Verificar/anotar el riesgo `auth.admin.signOut(id,'global')` en `TOGGLE_ACTIVE` (espera JWT); corregir solo si se confirma.
- [ ] A2.6 [MANUAL] Merge a `main` (aplica 0c); deploy de edge functions (`supabase functions deploy manage-users invite-employee`); probar invitar empleado real; cerrar sesion y volver a entrar con cada usuario interno (refresca JWT y toma `app_metadata`).

### Batch A3 - Migracion 0d (2 tareas) - GATE de F2
- [ ] A3.1 `supabase/migrations/20261128090000_retirar_fallback_user_profiles.sql` + `.down.sql` (renombrada: el fallback ya es a `user_profiles`, no a `user_metadata`) autoverificables: con el fallback retirado, un JWT sin claims no da tenant y todos los usuarios internos tienen `app_metadata`.
- [ ] A3.2 [MANUAL] Merge a `main` (aplica 0d; ya no hay espera de >=1 h por seguridad, la propia migracion verifica que todos los internos tienen `app_metadata`). Smoke check admin. **No avanzar a F2 sin esto.**

## F1 - Catalogo publico, imagenes, shell publico y PWA

### Batch B1 - Imagenes y RPCs de catalogo SQL (4 tareas)
- [ ] B1.1 RED `supabase/tests/sql/f1_catalog.test.sql`: payload sin cost/stock/lote/proveedor, agrupacion, Agotado, inactivo, tienda deshabilitada/inexistente, anon SELECT directo = 0, `store_get_product` inexistente, storage escritura anon/cliente/cross-tenant rechazada. (SPC todos, PI Lectura/Escritura)
- [ ] B1.2 `supabase/migrations/20261201090000_imagenes_productos.sql` (+down): `products.image_url`, bucket `product_images`, policies de storage.
- [ ] B1.3 `supabase/migrations/20261201100000_rpcs_catalogo_tienda.sql` (+down): `store_list_products`, `store_get_product` (DEFINER, search_path, REVOKE/GRANT a anon+authenticated, limit 1..100).
- [ ] B1.4 [MANUAL] Merge a `main` (aplica ambas; autoverificacion con `f1_catalog.test.sql` como referencia). Smoke check admin.

### Batch B2 - Config, PWA y routing base (7 tareas)
- [ ] B2.1 RED->GREEN `src/config/storePaths.ts` + test (`isStorePath`, constantes de rutas).
- [ ] B2.2 RED->GREEN `pwa.config.ts` + test (`isAdminModule`, `globIgnores`, `start_url:'/inicio'`, `devOptions.enabled=false`); modificar `vite.config.ts` con `chunkFileNames` (prefijo `admin-`). (PSR PWA)
- [ ] B2.3 Modificar `src/config/brand.ts`: `CONTACT {SALES_EMAIL:'ventas@teknergy.com', SALES_PHONE:'50300000000'}` marcados PLACEHOLDER, unico lugar de contacto. Test: la landing no usa `SUPPORT_EMAIL`/`PHONE_BODEGA`. (PSR Contacto)
- [ ] B2.4 Crear `src/config/env.ts` (`VITE_STORE_TENANT_ID`, `VITE_STORE_CAPTCHA_ENABLED=false`) y `src/config/storeSupabaseClient.ts` (storageKey `sb-teknergy-store`, pkce, detectSessionInUrl solo `/cuenta*`); modificar `src/config/supabaseClient.ts` (`detectSessionInUrl: !isStorePath(...)`). Test: storageKeys distintos. (PSR Aislamiento)
- [ ] B2.5 RED->GREEN: mover `AppContent` a `src/AdminApp.tsx` (+ `/inicio`, fallbacks y `Navigate` a `/inicio`, `LoginView` respeta `location.state.from`, `refreshSession` al cambiar rol); modificar `MainLayout.tsx`, `ProtectedRoute.tsx`, `e2e/auth.spec.ts` (`/inicio`). (PSR Dashboard movido, Admin sin sesion, Cliente en ruta admin)
- [ ] B2.6 RED->GREEN: `src/App.tsx` router delgado (PublicApp/AdminApp lazy, ReloadPrompt global). Test RTL: `/` no llama `getBootstrapData`; `/inventario` monta AdminApp. (PSR Landing, Sin bootstrap admin, Rutas admin intactas)
- [ ] B2.7 Modificar `index.html` (`lang="es"`, titulo/descripcion landing) y `public/locales/{es,en}/common.json` (claves `store.*` para esta fase, `inventory.image.*`).

### Batch B3 - Imagen en inventario (3 tareas)
- [ ] B3.1 RED->GREEN `uploadProductImage(file)` en `storageService.ts` + `productService.ts` (valida tipo jpg/png/webp y 2 MB, ruta `{tenant}/{product}-{ts}.webp`, guarda `image_url`). Test vitest con supabase mockeado. (PI Subir valida, Archivo invalido)
- [ ] B3.2 Modificar `AddProductModal.tsx`: campo imagen con preview y mensajes i18n es/en.
- [ ] B3.3 Crear `ProductImage` (placeholder) en `src/ui/features/store/components/` con test. (PI Producto sin imagen)

### Batch B4 - Paginas publicas (catalogo y landing) (6 tareas)
- [ ] B4.1 RED->GREEN `storeService.ts` (`listProducts`, `getProduct`, mapeo de errores) + test.
- [ ] B4.2 RED->GREEN presentacionales `AvailabilityBadge`, `ProductCard`, `ProductGrid`, `HeroSection`, `ContactSection` (usa solo `CONTACT`), `StoreHeader`, `StoreFooter` con tests.
- [ ] B4.3 Hooks `useCatalog`, `useProduct` + containers `LandingPage`, `CatalogPage`, `ProductDetailPage`.
- [ ] B4.4 `PublicApp.tsx` (shell: header + Outlet + footer, sin bootstrap admin) y cableado de rutas `/`, `/tienda`, `/tienda/p/:productKey`.
- [ ] B4.5 `e2e/store.spec.ts`: landing anon, catalogo, anon en `/inicio` -> `/login`.
- [ ] B4.6 [MANUAL] Setear en Vercel `VITE_STORE_TENANT_ID` (y `VITE_STORE_CAPTCHA_ENABLED=false`); `UPDATE tenants SET store_enabled=true` SOLO del tenant (puede hacerse en F1 porque el signup aun no existe, pero el front de cuenta no se despliega); desplegar; probar `/`, `/tienda`, PWA instalada arranca en `/inicio`; limpiar SW antiguo.

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
