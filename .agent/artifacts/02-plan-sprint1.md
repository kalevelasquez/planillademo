# Plan Maestro - Sprint 1 (Core) ImporFrut
*Documento de Arquitectura y Negocio - Teknergy Inc.*

Este documento establece la base arquitectónica, el modelo de datos y los criterios de éxito para el **Sprint 1** del sistema ImporFrut, asegurando el cumplimiento estricto del *Tech Stack* (Arquitectura Multi-Tenant) y el *Design System*.

---

## 1. Modelo de Datos Multi-Tenant (Arquitecto)

El Sprint 1 requiere cimentar las bases para la Autenticación (Login), la gestión de Clientes, el Inventario básico y la Toma de Pedidos. Dada la regla estricta de arquitectura Multi-Tenant, **todas las tablas** llevarán el campo `tenant_id`.

### 1.1 Esquema de Tablas (PostgreSQL / Supabase)

**1. Tabla `tenants` (Catálogo Global)**
* `id` (UUID, Primary Key)
* `name` (VARCHAR, ej: "ImporFrut El Salvador")
* `created_at` (TIMESTAMPTZ)
* `is_active` (BOOLEAN, default: true)

**2. Tabla `user_profiles`**
*Extiende la tabla auth.users nativa de Supabase*
* `id` (UUID, Primary Key, Foreign Key a `auth.users`)
* `tenant_id` (UUID, Foreign Key a `tenants`, Indexed)
* `role` (VARCHAR: 'admin', 'supervisor', 'vendedor', 'despachador')
* `full_name` (VARCHAR)
* `phone` (VARCHAR)
* `created_at` (TIMESTAMPTZ)
* `is_active` (BOOLEAN, default: true)

**3. Tabla `customers` (Clientes)**
* `id` (UUID, Primary Key)
* `tenant_id` (UUID, Foreign Key a `tenants`, Indexed)
* `assigned_seller_id` (UUID, Foreign Key a `user_profiles`, Nullable)
* `business_name` (VARCHAR)
* `contact_name` (VARCHAR)
* `phone` (VARCHAR)
* `price_list` (VARCHAR: 'empleado', 'cliente', 'mayoreo')
* `created_at` (TIMESTAMPTZ)
* `deleted_at` (TIMESTAMPTZ, Nullable - *Soft Delete Rule*)

**4. Tabla `products` (Catálogo/Inventario)**
* `id` (UUID, Primary Key)
* `tenant_id` (UUID, Foreign Key a `tenants`, Indexed)
* `name` (VARCHAR)
* `category` (VARCHAR)
* `brand` (VARCHAR)
* `caliber` (VARCHAR)
* `quality` (VARCHAR)
* `available_quantity` (INTEGER, check >= 0)
* `price_empleado` (DECIMAL)
* `price_cliente` (DECIMAL)
* `price_mayoreo` (DECIMAL)
* `created_at` (TIMESTAMPTZ)

**5. Tabla `orders` (Pedidos)**
* `id` (UUID, Primary Key)
* `tenant_id` (UUID, Foreign Key a `tenants`, Indexed)
* `order_number` (VARCHAR, Unique por Tenant)
* `customer_id` (UUID, Foreign Key a `customers`)
* `seller_id` (UUID, Foreign Key a `user_profiles`)
* `status` (VARCHAR: 'borrador', 'pendiente', 'aprobado', 'entregado', 'cancelado')
* `total_amount` (DECIMAL)
* `notes` (TEXT)
* `created_at` (TIMESTAMPTZ)

**6. Tabla `order_items` (Detalle de Pedidos)**
* `id` (UUID, Primary Key)
* `order_id` (UUID, Foreign Key a `orders`, On Delete Cascade)
* `product_id` (UUID, Foreign Key a `products`)
* `quantity` (INTEGER, check > 0)
* `unit_price` (DECIMAL)
* `total_price` (DECIMAL)

### 1.2 Estrategia de Row Level Security (RLS)

La seguridad se aplicará a nivel de base de datos interceptando el token JWT nativo de Supabase, que debe incluir un claim personalizado con el `tenant_id` del usuario.

**Estrategia de Aislamiento Tenant (Ejemplo de Política):**
```sql
-- Política aplicada a la tabla `customers` (repetible para orders, products, etc.)
CREATE POLICY "Tenant Isolation Policy" ON customers
AS RESTRICTIVE FOR ALL
TO authenticated
USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
```
Adicionalmente, se añadirán políticas aditivas (PERMISSIVE) basadas en el rol (`auth.jwt() ->> 'role'`) para aislar datos entre vendedores (ej. *un vendedor solo ve orders donde seller_id coincide con su auth.uid()*).

---

## 2. Árbol de Componentes Base (React + Tailwind)

Para garantizar la separación de UI y Lógica, y enforzar el Design System, la estructura en `src/` será:

```text
src/
├── assets/
│   └── (íconos y logos)
├── config/
│   └── supabaseClient.ts      # Cliente instanciado de Supabase
├── services/                  # CAPA AISLADA: Único lugar que toca Supabase
│   ├── authService.ts
│   ├── customerService.ts
│   └── orderService.ts
├── store/                     # Estado global (Zustand/Context) si es necesario
├── hooks/                     # Lógica rehusable de componentes
├── docs/                      # (Los docs y artifacts se quedan fuera de src/)
└── ui/                        # CAPA VISUAL
    ├── styles/
    │   └── index.css          # Inyección de las variables CSS del Design System
    ├── components/            # Componentes puros (Botones, Inputs, Badges)
    │   ├── Button.tsx         # Implementa dictados del Design System
    │   ├── InputField.tsx     
    │   └── Badge.tsx
    ├── layout/                # Estructuras maestras
    │   ├── MobileNav.tsx      # Bottom Nav
    │   ├── DesktopSidebar.tsx
    │   └── MainLayout.tsx
    └── features/              # Vistas agrupadas por dominio de negocio
        ├── auth/
        │   └── LoginView.tsx
        ├── orders/
        │   ├── NewOrderView.tsx
        │   └── OrderSummaryView.tsx
        └── customers/
            └── CustomerSelectionView.tsx
```

**Configuración Tailwind (`tailwind.config.js` estricto):**
Deberá estar mapeado 1:1 con `docs/product/design-system.md` consumiendo variables CSS. **Prohibido colores hardcoded en clases.**

---

## 3. Estrategia de Observabilidad

**Decisión Arquitectónica:** **NO** integraremos herramientas externas formales (como PostHog o Datadog) en el Sprint 1 por respeto al tamaño del MVP y a la velocidad de entrega.

**Solución Nativa y Asíncrona (Supabase Edge & DB Logging):**
1. **Frontend Error Boundary:** En React, un `GlobalErrorBoundary` capturará excepciones no controladas y los mostrará al usuario con un *Toast rojo amigable* (ej: "Error de conexión, intenta de nuevo").
2. **Troubleshooting Logging (Granular y No Bloqueante):** 
   Cualquier error capturado en la capa `/services` (ej. fallo al guardar un pedido) enviará un payload JSON estructurado mediante un llamado asíncrono y de fuego-y-olvido (fire-and-forget) a una función RPC de Supabase o un endpoint Edge Function.
3. **Persistencia de Errores:** Se guardarán en una tabla de bajo costo `system_logs` (nivel, mensaje, usuario, tenant_id, metadata JSONB, timestamp) que será pulgada periódicamente, manteniendo el flujo del usuario ininterrumpido.

---

## 4. Criterios de Éxito y Metodología Git (Gerente)

El `@programador` debe cumplir a cabalidad lo siguiente para dar por exitoso el Sprint 1:

### 4.1 Git Flow Obligatorio 🛑
1. **[CRÍTICO]** Antes de crear cualquier archivo en `src/` o modificar el `tailwind.config`, el programador **DEBE** asegurarse de estar en la rama `develop`, y a partir de ahí ejecutar:
   `git checkout -b feature/sprint1-core`
2. Todos los cambios del sprint se harán sobre esta rama.
3. Realizar commits granulares y en español (ej. *feat: configuración inicial de variables tailwind*).

### 4.2 Criterios de Aceptación Técnicos
* [ ] **Capa Aislada:** Ningún componente dentro de `src/ui/` importa a `supabase`. Todo pasa por `src/services/`.
* [ ] **Fidelidad Visual:** El Login y la pantalla base hacen uso exclusivo de las clases de Tailwind derivadas de los tokens del *Design System* (ej. `bg-primary`, `text-error`, radius, tipografía DM Sans).
* [ ] **Multi-Tenant Activo:** El JWT simulado o real inyecta/verifica el `tenant_id` en las interacciones y Supabase frena cualquier consulta sin el UUID correspondiente de contexto.
* [ ] **Prevención Visual Doble Transacción:** Todo botón (especialmente el "Iniciar Sesión" y "Confirmar Pedido") tiene un estado *isSubmitting* que lo desactiva, mostrando un spinner, hasta que el servicio resuelva.
* [ ] **Navegación Móvil:** El esqueleto principal implementa el *Bottom Nav* funcional preparativo para las vistas futuras.
