## Exploration: tienda-web-clientes (landing + tienda web para clientes finales en la misma SPA)

### Current State

**Datos (verificado en supabase/migrations)**
- `tenants(id, name, created_at, is_active)` — SIN slug/dominio/config. RLS activado, sin policy para anon. Resolver tenant publico requiere columna nueva (slug) o env var.
- `customers`: id, tenant_id, assigned_seller_id (NULL permitido), business_name, contact_name, phone, address, department, municipality, identification_number, internal_code, notes, status ('activo'/'inactivo'), price_type ('empleado'|'cliente'|'mayoreo', default 'cliente'), deleted_at. NO tiene vinculo con auth.users (ni user_id, ni email).
- `products` = UN LOTE/EMBARQUE por fila: UNIQUE(tenant_id, name, caliber, brand, quality, shipment_number); `available_quantity DECIMAL`, `status` ('active'|'incomplete'|'unavailable'), `category_id` -> product_categories, `entry_date`, `last_import_id`. **PRECIO UNICO: columna `price`** (price_empleado/price_mayoreo fueron DROPeadas en 20260226175703; price_cliente renombrada a `price`). No existen "listas de precio" por producto: `customers.price_type` es solo una etiqueta; en el frontend el unit_price viene de `products.price` (editable por linea). => decision 4 ("todos ven precio Cliente") = `products.price` tal cual.
- Imagenes: NO hay columna de imagen ni bucket de productos. Buckets existentes: `pedidos_publicos` (publico, solo PDF), `planilla_*` (privados), `inventory_documents`. Hay que decidir si se agregan fotos (columna `image_url` + bucket publico, o placeholder por categoria).
- `orders`: id, tenant_id, order_number (UNIQUE por tenant), customer_id NOT NULL, **seller_id NOT NULL FK user_profiles** (ninguna migracion lo relaja), status CHECK ('Draft','Pending','Approved','In Preparation','Delivered','Cancelled'), subtotal, discount_type/amount, total_amount, notes, handled_by, shipped_at, delivered_at. NO existe columna origin/source. `order_items`: order_id, product_id, quantity, unit_price, total_price, notes, discount_type/amount.
- Numeracion: `next_order_number()` (SECURITY DEFINER, secuencia global `order_number_seq`) -> 'PED-YYYYMMDD-NNNN'; el frontend crea drafts con prefijo 'DRAFT-' y `confirm_order_atomic` (ultima: 20260625000000, FOR UPDATE) hace Draft->Approved reemplazando DRAFT- por PED-. `create_direct_order_atomic(p_tenant_id, p_customer_id, p_seller_id, ...)` crea directo en 'Approved' (SECURITY DEFINER, GRANT authenticated, NO valida que p_tenant_id/p_seller_id correspondan al caller).
- Stock: trigger `on_order_item_created` descuenta solo si el pedido padre esta 'Approved'; trigger `on_order_approved` (AFTER UPDATE OF status) descuenta SOLO en transicion **Draft -> Approved**; `on_order_cancelled` devuelve stock si estaba Approved/In Preparation/Delivered; hay triggers de update/delete de items. => Un pedido web en 'Pending' NO descuenta stock y su paso Pending->Approved NO descontaria stock con el trigger actual. Un pedido web en 'Draft' si encaja en el flujo existente (aprobacion = confirm_order_atomic), pero la UI de Draft esta pensada para "retomar borrador" del vendedor (findExistingDraft filtra por seller_id salvo admin/supervisor; indice unico parcial (seller_id, customer_id) WHERE Draft).
- No hay triggers de notificacion/WhatsApp en insert de orders. WhatsApp es manual desde OrderSummaryView (wa.me). `notificaciones` es de Planilla (quincenas) — no sirve para avisar pedidos web sin trabajo extra.

**RLS / exposicion anonima**
- Politicas finales (20260318000000_robust_permission_system.sql): orders/customers/products/user_profiles usan `tenant_id = get_auth_tenant_id()` + `check_access(resource, action, owner)` / `has_permission`. Todas `FOR ... USING` sin rol anon explicito, pero dependen de auth.uid()/JWT => anon no lee nada. CONFIRMADO: ninguna policy `TO anon`; unica excepcion `TO public` es storage.objects de `pedidos_publicos` (PDFs, publico a proposito). Hoy nada de datos de negocio esta expuesto a anon (salvo que Supabase default privileges + RLS lo permitieran; con RLS ON y sin policy, 0 filas).
- **HALLAZGO CRITICO PREEXISTENTE**: `get_auth_tenant_id()` y `get_auth_roles()` (ultima def. 20260317085921_critical_rl_recovery.sql) leen `auth.jwt()->'user_metadata'`. `user_metadata` es editable por el propio usuario con `supabase.auth.updateUser({data:{roles:['admin'], tenant_id:'<uuid>'}})`. Cualquier usuario autenticado (incluido un cliente de tienda) podria autoascenderse a admin y/o cruzar de tenant. Hoy el riesgo existe para usuarios internos; con registro publico pasa a ser explotable por cualquiera. **Bloqueante: debe corregirse ANTES de abrir cuentas de cliente.**
- Si el "Enable email signups" de Supabase Auth esta activo hoy, cualquiera ya puede hacer `signUp({data:{roles:['admin'], tenant_id}})` y el trigger lo convierte en admin (handle_new_user lee raw_user_meta_data.roles/tenant_id). No se pudo verificar (supabase/config.toml no declara [auth]; el ajuste vive en el dashboard remoto). Preguntar/verificar.

**Auth y perfil**
- `handle_new_user()` (20260504173000): AFTER INSERT en auth.users -> upsert en user_profiles con roles/tenant_id/full_name tomados de raw_user_meta_data (default rol 'vendedor', status 'PENDING', is_active TRUE). Un signUp publico hoy crea un VENDEDOR interno.
- Frontend: App.tsx `initAuth` -> `authService.getBootstrapData()` -> RPC `get_bootstrap_data` (retorna `{error:'Profile not found'}` si no hay fila en user_profiles, NO error PG) -> el front hace `data.profile.roles` -> TypeError -> catch -> fallback `getCurrentSession` -> `getProfile` null -> `logout()`. O sea: un usuario SIN fila en user_profiles que entre al shell admin es deslogueado (comportamiento accidental, no deliberado). Un usuario CON fila (todo signup la tiene por el trigger) entra como interno. `login()` muestra "No se encontro un perfil asociado" si falta la fila.
- Kill-switch realtime y canal `central-profile-sync` se montan para cualquier `profile`.
- `supabase` client unico en src/config/supabaseClient.ts (`detectSessionInUrl: true`, persistSession localStorage) — una tienda y el admin comparten la misma sesion/localStorage del origen: un cliente logueado en /cuenta y un vendedor logueado en /app en el mismo navegador se pisarian la sesion (una sola sesion por origen).
- Edge functions que crean usuarios (manage-users, invite-employee) setean `user_metadata: { roles, full_name }` e invitan con redirectTo `${PUBLIC_SITE_URL}/login`; reset password usa `${origin}/reset-password`. Links de email de quincena: `${PUBLIC_SITE_URL}/planilla/historial/:id`; NotificationBell navega a `/planilla/historial/:id`.

**Routing / PWA / deploy**
- src/App.tsx: BrowserRouter unico, `AppContent` hace bootstrap de auth en TODA ruta (incluso las publicas). Rutas publicas: /login, /forgot-password, /reset-password, /setup-account, /force-password-change. Ruta "/" = ProtectedRoute > MainLayout (lazy) con index=DashboardView; ~40 rutas hijas planas (/clientes, /catalogo, /pedidos, /inventario, /despacho, /administrar/*, /planilla/*, /equipo, /perfil, /configuracion). Fallback `*` -> `/`. Todas las vistas con `lazyWithRetry`.
- Paths hardcodeados: ~110 ocurrencias en ~28 archivos (MainLayout 31, PlanillaLayout 18, App.tsx 14, OrderDetailView 5, EmpleadoDetailView 5, ProtectedRoute, ResetPassword, NotificationBell, UserMenu, etc.) + e2e Playwright + emails (PUBLIC_SITE_URL/planilla/...). Mover admin a /app/* implica tocar todo eso (o introducir un helper `appPath()`/basename).
- vercel.json: rewrite total a /index.html (SPA). Sin headers.
- PWA (vite.config.ts): `registerType:'autoUpdate'`, workbox `globPatterns **/*.{js,css,html,ico,png,svg}` => **el service worker PRECACHEA todos los chunks (incluido el bundle del admin) en la primera visita**, con `skipWaiting`+`clientsClaim`, `navigateFallback:'index.html'`, manifest `start_url:'/'`, `scope:'/'`, nombre "Teknergy - Sistema de Planilla", `devOptions.enabled:true`. Consecuencias: (a) el objetivo "visitantes de la tienda no descargan el admin" se rompe a nivel de red en segundo plano por el precache (solo se cumple para el parseo/ejecucion); (b) la PWA se instala con la identidad del admin y abre en "/" (landing); (c) un SW que sirve index.html para todo puede cachear una landing desactualizada si no se gestiona.
- ReloadPrompt, NetworkStatusBanner y logica de chunk-retry viven en App.tsx y aplican a toda ruta.
- Tests: vitest (jsdom) + Playwright (e2e/*.spec.ts: auth, empleados, anticipos, configuracion, calculo). Strict TDD activo.

### Affected Areas
- `supabase/migrations/` — nuevas migraciones: get_auth_* via app_metadata/hook, handle_new_user endurecido, link customers<->auth, funciones publicas (RPC/vistas), RPC de creacion de pedido web, seller_id nullable u origen, columna origin, imagenes.
- `supabase/functions/manage-users`, `invite-employee` — pasar roles/tenant a `app_metadata` (hoy user_metadata); migracion de datos para usuarios existentes (backfill app_metadata desde user_profiles).
- `src/App.tsx` — dividir en shell publico y shell admin; mover AppContent/bootstrap al shell admin; proteger rutas /app.
- `src/main.tsx`, `src/store/authStore.ts`, `src/services/authService.ts` — separar sesion de interno vs cliente (rol/tipo), evitar que un cliente active el kill-switch/bootstrap del admin.
- `src/ui/layout/MainLayout.tsx`, `src/ui/features/planilla/PlanillaLayout.tsx`, `ProtectedRoute.tsx`, `NotificationBell.tsx`, `UserMenu.tsx`, y ~25 vistas con `navigate('/...')` — si el admin se mueve a /app.
- `vite.config.ts` (workbox precache/manifest/navigateFallbackDenylist), `vercel.json`, `index.html` (meta/SEO de landing; hoy titulo del admin).
- `src/config/brand.ts` — fuente de textos de marca para la landing (contiene SUPPORT_EMAIL y PHONE_BODEGA de un empleado, revisar antes de exponer publicamente).
- NUEVO: `src/ui/features/store/*` (landing, catalogo, carrito, checkout, cuenta), `src/services/storeService.ts`, `src/store/cartStore.ts`, `public/locales/{es,en}` (strings nuevos obligatorios por config.yaml).
- `src/services/orderService.ts` / `orderStore.ts` — referencia de creacion; la tienda NO debe reutilizar `createOrder` (confia en p_tenant_id/p_seller_id del cliente).

### Approaches

**A. Identidad de cliente + RLS**
1. **Cuenta Supabase Auth del cliente + `customers.auth_user_id` + app_metadata `{user_type:'store_customer', tenant_id}` + endurecer RLS (recomendado)**
   - Fix global: `get_auth_tenant_id/get_auth_roles` leen `auth.jwt()->'app_metadata'` (inmutable por el cliente); backfill app_metadata de usuarios internos; edge functions escriben app_metadata. handle_new_user deja de leer roles/tenant de raw_user_meta_data: si el signup viene marcado como tienda (clave que no otorga privilegios, ej. `signup_source='store'` NO decide el tenant ni el rol) crea fila en `customers` (+ opcional `store_accounts`) y NO en user_profiles; el tenant se resuelve en servidor (tenant "tienda" configurado en tabla/env del lado DB), no desde el cliente.
   - Cliente accede a SUS pedidos via policies/RPC con `auth_user_id = auth.uid()`; no recibe permisos de permission_matrix.
   - Pros: modelo real, historial de pedidos, no hay nuevos roles en matriz; arregla de paso la escalada de privilegios existente. Cons: toca migraciones criticas y edge functions (riesgo de regresion a todos los usuarios internos); requiere re-login/refresh de JWT para usuarios existentes tras backfill.
   - Effort: High.
2. **Cuentas de cliente como filas en `user_profiles` con rol nuevo 'cliente_tienda'** — reutiliza trigger/bootstrap/matriz.
   - Pros: minimo codigo nuevo. Cons: mezcla clientes finales con usuarios internos (aparecen en Equipo/Usuarios, kill-switch, matriz de permisos, conteos), sigue dependiendo de user_metadata para roles => escalada; el shell admin los dejaria entrar. NO recomendado.
   - Effort: Medium (pero alto riesgo).
3. **Sin Supabase Auth: "cuenta ligera" por Edge Function (email + OTP/magic link emitido por funcion con service_role, JWT propio)** — pros: aislamiento total del sistema interno; cons: reinventa auth, mas superficie de seguridad. Effort: High. Solo si no se quiere tocar el auth interno.

**B. Acceso publico al catalogo**
1. **RPCs SECURITY DEFINER (`store_list_products(p_tenant)`, `store_get_product`) con `SET search_path`, GRANT EXECUTE a anon, devolviendo solo columnas seguras (id, nombre, categoria, marca, calibre, calidad, price, disponibilidad agregada/booleana, imagen) (recomendado)**
   - Pros: superficie minima y explicita, sin policies anon sobre tablas; se puede agregar rate-limit/paginacion/filtrado de status='active' y `available_quantity>0`; oculta embarque, costo/otros campos. Cons: mas SQL a mantener; cache por Vercel/CDN no aplica (llamada a PostgREST) salvo SWR en cliente.
   - Effort: Medium.
2. **Vista `store_products_v` (security_invoker=false) + GRANT SELECT a anon** — pros: simple de consumir con PostgREST (filtros, paginacion). Cons: las vistas con owner bypassan RLS: facil filtrar de mas si se cambia la tabla; menos control de abuso. Effort: Low-Medium.
3. **Policy `FOR SELECT TO anon` directa en products** — NO recomendado: expone todas las columnas y no sabe de tenant sin JWT.

**C. Split de rutas**
1. **Mantener paths del admin tal cual; agregar shell publico para "/" , "/tienda/*", "/cuenta/*" y mover SOLO el dashboard (ej. "/inicio"); logica "si hay perfil interno en '/' redirigir a /inicio"** — pros: ~5-10 referencias a "/" a cambiar en vez de ~110; menor riesgo de regresion; links de emails/notificaciones siguen validos. Cons: URLs del admin no tienen prefijo (convencion menos limpia), colision futura de nombres (/catalogo ya existe en admin: tienda debe vivir en /tienda). Effort: Medium.
2. **Mover todo el admin a /app/* (decision original del usuario)** — pros: separacion limpia, facil reglas de cache/SW (`navigateFallbackDenylist: [/^\/app/]`), analytics. Cons: ~110 paths hardcodeados en ~28 archivos + e2e + PUBLIC_SITE_URL/emails + invitaciones + notificaciones; riesgo alto de roturas silenciosas (mitigable con helper `appPath()` + regex test que prohiba '/' absolutos). Effort: High.
3. **Dos entry points / dos builds (store.html + index.html) en el mismo repo/Vercel project** — aislamiento real de bundle y PWA/SW por scope; cons: dos SPA, doble bootstrap, rewrites en vercel.json, se pierde "una sola app". Effort: High. (Alternativa si el precache del SW es inaceptable.)

Independiente de la opcion: separar en `main.tsx`/App un `PublicApp` (sin bootstrap de auth interno) y `AdminApp` (lazy), y **excluir el admin del precache o aceptar el costo** (SW: `globIgnores`/runtime caching para chunks admin, `navigateFallbackDenylist`).

**D. Estado/entrada del pedido web**
1. **Nuevo RPC `store_create_order(p_items jsonb, p_notes, p_contact...)` SECURITY DEFINER para `authenticated` tipo cliente: deriva tenant/customer de auth.uid(), RECALCULA precios desde products.price (nunca confia en el cliente), valida stock>0 y status='active', crea la orden en estado 'Pending' con `origin='web'` y seller_id NULL (o vendedor "web" configurable), numero via `next_order_number()` (prefijo 'WEB-'? o 'PED-')** (recomendado) + extender `deduct_inventory_on_approval` para cubrir Pending->Approved (hoy solo Draft->Approved) y `confirm`/approve RPC para vendedores.
   - Pros: seguro, usa el flujo de aprobacion, `Pending` ya existe en CHECK y en ORDER_STATUS_CONFIG (label 'Pendiente'); no reserva stock hasta aprobar. Cons: hay que ajustar RLS/UI interna para que vendedores/supervisores vean y aprueben pedidos con seller NULL (check_access con owner NULL solo pasa con scope 'all') y relajar `orders.seller_id NOT NULL` (migracion).
2. **Crear como 'Draft'** (el usuario dijo Borrador/pending): reutiliza confirm_order_atomic y el trigger de stock tal cual; Cons: la UI de Draft esta orientada a "mi borrador en progreso" (autosave, retomar, borrar), se mezcla con borradores reales, numero 'DRAFT-' visible al cliente, indice unico por (seller,customer) con NULL no restringe pero confunde. Medio-bajo esfuerzo pero semantica sucia.

### Recommendation
- **Seguridad primero (fase 0, bloqueante)**: migrar `get_auth_tenant_id/get_auth_roles` a `app_metadata` (con backfill y cambio en manage-users/invite-employee) y reescribir `handle_new_user` para ignorar roles/tenant provenientes de raw_user_meta_data de signups publicos. Sin esto no se debe habilitar ningun registro publico. Verificar en el dashboard si "Enable email signups" ya esta activo.
- Identidad: **A1** (Auth + `customers.auth_user_id` + app_metadata user_type, sin fila en user_profiles).
- Catalogo publico: **B1** (RPCs SECURITY DEFINER para anon, columnas minimas, tenant resuelto por slug en tabla `tenants` nuevo campo `store_slug` / `store_enabled`; para el demo un unico tenant por env `VITE_STORE_TENANT_SLUG`).
- Pedido: **D1** con status 'Pending', origen web, precio recalculado server-side, aprobacion por vendedor/supervisor.
- Rutas: **C1 como paso 1** (shell publico separado + dashboard a /inicio, paths admin intactos) porque cumple "carga separada/lazy" con ~10x menos riesgo; si el usuario insiste en prefijo /app, hacerlo como cambio aparte DESPUES con helper `appPath()`. Para PWA: excluir chunks admin del precache o dejar documentado el trade-off, y `navigateFallbackDenylist`/scope adecuado.
- Imagenes: v1 sin fotos (placeholder por categoria/iconografia) o columna `image_url` opcional + bucket publico `product_images`; decision del usuario.
- Dividir el cambio en fases entregables: (0) hardening auth, (1) catalogo publico + landing, (2) cuentas + carrito + pedido Pending, (3) bandeja de aprobacion de pedidos web en el admin, (4) opcional /app prefix.

### Risks
- Escalada de privilegios via user_metadata (preexistente, critico): cualquier cliente registrado podria volverse admin o leer otros tenants.
- Cambiar get_auth_* afecta a TODAS las politicas RLS (cientos de migraciones apiladas, algunas con multiples definiciones historicas): regresion = admin sin datos. Requiere pruebas con roles reales y plan de rollback (mantener fallback temporal a user_metadata solo lectura mientras se hace el backfill).
- handle_new_user: un error en el trigger bloquea TODO signup (incluye invitaciones internas); ya fue "blindado" antes con EXCEPTION.
- Sesion compartida por origen: cliente y vendedor en el mismo navegador/dispositivo (demo) se pisan la sesion; considerar storageKey distinta para el cliente de la tienda o aceptar la limitacion.
- Stock: sin reserva en Pending, sobreventa posible hasta aprobar; con CHECK >=0 la aprobacion puede fallar por stock insuficiente (hay migraciones de "allow_negative_stock": verificar estado actual de la constraint). Productos son lotes por embarque: el modelo de "producto" para la tienda (agrupar por nombre/marca/calidad/calibre y mezclar embarques) no esta definido.
- Abuso/SPAM: RPC anon y signup abiertos -> rate limiting, captcha (Turnstile/hCaptcha en Supabase Auth), confirmacion de email, limites de items/cantidad por pedido.
- PWA/SW: precache del admin completo, `skipWaiting` + landing cacheada obsoleta, manifest/branding de "Sistema de Planilla" para visitantes publicos; `devOptions.enabled:true`.
- Exposicion de datos: brand.ts tiene correo y telefono personal; `price` puede ser precio negociable interno; no exponer embarque, cantidades exactas ni marcas si son sensibles.
- Mover a /app: ~110 paths + emails + e2e; links de correo ya enviados apuntan a /planilla/...
- `create_direct_order_atomic` confia en p_tenant_id/p_seller_id (cualquier authenticated puede crear pedidos para otro tenant/vendedor): no reutilizar; considerar endurecerla tambien.
- Legal/negocio: terminos, privacidad, datos personales (DUI/NIT) de clientes finales; factura/CCF y flujo de entrega a domicilio fuera de alcance.

### Open Questions (para el usuario)
1. Tenant publico: un unico tenant (demo Teknergy/ImporFrut) fijo por env var, o preparar slug por tenant (multi-tienda)?
2. Prefijo /app: es requisito duro o aceptamos mantener los paths del admin y mover solo el dashboard (C1)? Impacto ~110 referencias.
3. Fotos de producto en v1: si/no? Si si: quien las carga (UI admin nueva) y bucket publico.
4. Producto de tienda: mostrar cada lote/embarque como item separado (con calibre/marca/calidad) o agrupar? Mostrar stock exacto, "disponible/agotado" o sin stock?
5. Pedido web: Pending (recomendado) vs Draft; quien aprueba y a que vendedor se asigna (sin vendedor / vendedor "Web" por defecto / round-robin)? Debe poder editarse el pedido al aprobar (cantidades/precios)?
6. Registro: email+password con confirmacion de email? Campos obligatorios (nombre, telefono, direccion, DUI/NIT)? Se vincula a un `customers` existente (mismo telefono/email) o siempre crea uno nuevo?
7. Estado actual de "Enable email signups"/confirmacion en el dashboard de Supabase (no verificable desde el repo)?
8. Entrega: domicilio con costo de envio, retiro en bodega, zonas? Metodo "transferencia": se muestran datos bancarios y se sube comprobante?
9. Notificacion al equipo al llegar un pedido web (email/WhatsApp/campana)? Hoy no existe disparador.
10. Aceptamos que el SW precachee tambien el admin (bundle grande) o preferimos entry points separados / excluirlo del precache?
11. Dominio: seguir en planillademosv.vercel.app o dominio propio para la tienda (afecta redirectTo/PUBLIC_SITE_URL)?

### Ready for Proposal
Si, condicionado: la propuesta debe incluir explicitamente la Fase 0 de hardening (app_metadata + handle_new_user) como prerequisito, y el orquestador debe confirmar con el usuario las preguntas 1, 2, 4 y 5 (impactan alcance/diseno) antes del sdd-propose; el resto puede resolverse en diseno.
