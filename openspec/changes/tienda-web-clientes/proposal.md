# Proposal: Tienda web para clientes finales (landing + catálogo + pedidos)

## Intent

Abrir un canal de venta público en la misma SPA: landing, catálogo y pedidos de clientes registrados con pago contra entrega, que entran al flujo de Pedidos existente. Antes hay que cerrar la escalada de privilegios: hoy `get_auth_*` lee `user_metadata`, que el propio usuario puede editar.

## Scope (fases entregables por separado)

| Fase | Entrega |
|------|---------|
| **F0 Hardening auth (bloquea F2)** | `get_auth_tenant_id/get_auth_roles` leen `app_metadata`. Backfill desde `user_profiles`. `manage-users`/`invite-employee` escriben `app_metadata`. `handle_new_user` ignora roles/tenant del cliente y ramifica el signup de tienda a `customers`, sin fila en `user_profiles`. |
| **F1 Landing + catálogo** | `/` landing, `/tienda` catálogo (anon). Dashboard pasa a `/inicio`. `PublicApp` lazy, sin bootstrap admin. RPCs anon `store_list_products/store_get_product`, agrupadas por nombre+calibre+calidad, solo Disponible/Agotado. `products.image_url` + bucket público `product_images` + upload en Inventario. Ajustes PWA. |
| **F2 Cuentas + carrito + pedido** | `/cuenta` (registro con confirmación de email, login, mis pedidos). `customers.auth_user_id`. Carrito local. RPC `store_create_order`: deriva tenant/cliente de `auth.uid()`, recalcula `products.price`, toma el lote activo más antiguo, crea la orden `Pending` con `origin='web'`. |
| **F3 Aprobación + avisos** | Bandeja de pedidos web en Pedidos. RPC de aprobación. Trigger de stock extendido a `Pending→Approved`. Fan-out a `notificaciones` (tipo `pedido_web`). `NotificationBell` enruta según el tipo. |

### Out of Scope
Pago online, costo de envío, multi-tienda por slug, prefijo `/app`, facturación/CCF, reserva de stock en Pending, captcha (queda preparado, no se activa).

## Capabilities

### New Capabilities
- `auth-claims-hardening`: claims de autorización solo desde `app_metadata`; signup seguro.
- `public-storefront-routing`: shell público vs admin, `/inicio`, comportamiento de la PWA.
- `store-public-catalog`: RPCs anon, agrupación, disponibilidad, imágenes.
- `product-images`: columna, bucket y upload desde el admin.
- `store-customer-accounts`: registro, vínculo con `customers`, mis pedidos.
- `store-web-orders`: carrito y `store_create_order`.
- `web-order-approval`: bandeja, aprobación, stock y notificaciones.

### Modified Capabilities
Ninguna (`openspec/specs/` está vacío).

## Approach (decisiones propias, a confirmar)

- **seller_id**: se relaja a `NULL` y se agrega `orders.origin` ('interno'|'web'). Al aprobar, `seller_id` pasa a ser el aprobador. Descarto el "vendedor sistema": exigiría un auth user + `user_profiles` falso que ensucia Equipo, conteos y el kill-switch.
- **Tenant**: `VITE_STORE_TENANT_ID` más `tenants.store_enabled`. Las RPCs rechazan tenants que no estén habilitados. El signup resuelve el tenant en servidor, nunca desde la metadata.
- **PWA**: los chunks admin se nombran con prefijo (`manualChunks`). `globIgnores` los saca del precache y entran por runtime caching. El manifest pasa a `start_url:'/inicio'`. Se apaga `devOptions`.
- **Sesión**: cliente Supabase de tienda con `storageKey` propia, para que cliente y vendedor no se pisen la sesión en el mismo navegador.
- **Abuso**: confirmación de email, límites de ítems/cantidad en el RPC, columnas mínimas. Captcha de Supabase Auth como opción.
- **brand.ts**: sacar el email y teléfono personales de la landing y reemplazarlos por contacto comercial.

## Affected Areas (incluye migraciones y RLS multi-tenant)

| Área | Impacto |
|------|---------|
| `supabase/migrations/` | Nuevas: claims, trigger, `customers.auth_user_id`, `orders.origin`/`seller_id`, `image_url`, bucket, RPCs, trigger de stock, policies de cliente |
| `supabase/functions/manage-users`, `invite-employee` | Modificadas |
| `src/App.tsx`, `src/main.tsx`, `ProtectedRoute`, `MainLayout`, `NotificationBell` | Split de shells, `/inicio` |
| `vite.config.ts`, `index.html`, `src/config/brand.ts` | PWA/SEO/contacto |
| `src/ui/features/store/*`, `storeService`, `cartStore`, `public/locales` | Nuevos |
| Inventario (form), Pedidos (bandeja) | Modificados |

## Risks

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| F0 deja al admin sin datos (RLS) | Med | Fallback temporal a `user_metadata` solo si `app_metadata` está vacío, backfill previo, refresh forzado de JWT, pruebas por rol |
| Un error en `handle_new_user` bloquea todo signup | Med | Bloque `EXCEPTION` y tests de invitación + signup de tienda |
| Sobreventa (sin reserva) | Med | La aprobación valida stock con `FOR UPDATE` y rechaza si no alcanza |
| Vendedores con scope `own` no ven órdenes con seller `NULL` | Alta | Policy específica para `origin='web' AND status='Pending'` |
| Spam/abuso anon | Med | Límites en RPC, confirmación de email, captcha opcional |

## Rollback Plan

Cada fase trae su migración `down`. F0: restaurar las definiciones previas de `get_auth_*` y `handle_new_user` (se conserva `user_metadata`) y revertir las edge functions. F1–F3: revertir el deploy del frontend. Las migraciones son aditivas (columnas nullable, RPCs nuevas), así que se pueden dejar o hacer `DROP` sin pérdida. Si se revierte el `NOT NULL` de `seller_id`, antes se asignan los pendientes web.

## Dependencies
Acceso al dashboard de Supabase (signups, confirmación de email, deploy de edge functions).

## Success Criteria
- [ ] `updateUser({data:{roles:['admin']}})` no cambia los permisos
- [ ] Un visitante anon ve el catálogo sin stock exacto ni columnas internas
- [ ] Un cliente crea un pedido `Pending` con precio recalculado en servidor
- [ ] La aprobación descuenta stock y notifica al equipo
- [ ] Las rutas admin existentes siguen funcionando (e2e verde)
