# Artifact: @arquitecto — US-HIS-01: Lista de Pedidos con Filtros
**ImporFrut | Teknergy Inc.**
**Fecha:** 2026-03-10
**Sprint:** S2 | **Puntos:** 5 | **Prioridad:** Alta

---

## 1. Análisis de Estado Actual (Pre-condiciones)

### Código existente revisado:
- `src/services/orderService.ts` — `getOrders()` filtra por `tenant_id`, `order_number` y nombre de cliente. ✅
- `src/store/orderStore.ts` — Solo gestiona el carrito activo. No aplica para esta US.
- `src/ui/features/orders/OrderListView.tsx` — Lista base con búsqueda y paginación. Falta filtros de estado y fecha. ✅ base
- `supabase/migrations/20260221000000_init_schema.sql` — RLS `orders_tenant_isolation` filtra por `tenant_id` solamente.
- `src/config/constants.ts` — **BUG DETECTADO**: `ORDER_STATUS` usa claves y valores en inglés (`APPROVED`, `'Approved'`) pero la BD usa español minúscula (`aprobado`). `OrderListView` referencia claves inexistentes (`ORDER_STATUS.APROBADO`).

---

## 2. Diagrama de Arquitectura

```
US-HIS-01
│
├── Capa de Base de Datos (Supabase)
│   ├── Tabla: orders (sin cambios estructurales)
│   ├── Tabla: order_items (nueva consulta de JOIN)
│   └── RLS: Nuevas políticas diferenciadas por rol ← NUEVA MIGRACIÓN
│
├── Capa de Servicios (/services)
│   └── orderService.ts
│       ├── getOrders(tenantId, page, searchQuery, filters?, limit) ← MODIFICAR (agregar filters)
│       └── getOrderDetail(orderId) ← NUEVO MÉTODO
│
└── Capa de UI (/ui/features/orders)
    ├── OrderListView.tsx ← MODIFICAR (agregar chips de estado + filtros de fecha)
    └── OrderDetailView.tsx ← NUEVO COMPONENTE
```

---

## 3. Modelo de Datos

### 3.1 Tabla `orders` — Sin cambios de columnas
La tabla existente ya tiene todos los campos necesarios:
- `id`, `tenant_id`, `order_number`, `customer_id`, `seller_id`, `status`, `total_amount`, `notes`, `created_at`

### 3.2 Tabla `order_items` — Solo lectura (JOIN)
Columnas relevantes para `OrderDetailView`:
- `id`, `order_id`, `product_id`, `quantity`, `unit_price`, `total_price`
- JOIN con `products(name, category, caliber, brand)`

---

## 4. Nueva Migración RLS — Políticas Diferenciadas por Rol

**Archivo a crear:** `supabase/migrations/20260310000000_orders_role_based_rls.sql`

```sql
-- Migración: RLS diferenciado por rol en tabla orders
-- Autor: @arquitecto
-- Fecha: 2026-03-10
-- US: US-HIS-01 — Lista de Pedidos con Filtros (CA5)
-- Propósito: Vendedores solo ven sus propios pedidos. Supervisores ven los de su equipo (tenant).

-- 1. Eliminar la política genérica anterior (solo filtraba por tenant_id sin discriminar rol)
DROP POLICY IF EXISTS "orders_tenant_isolation" ON orders;

-- 2. Política SELECT diferenciada por rol:
--    - vendedor: solo ve sus propios pedidos (seller_id = auth.uid())
--    - supervisor, admin, despachador: ven todos los pedidos del tenant
CREATE POLICY "orders_select_by_role" ON orders
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    AND (
      (SELECT role FROM public.user_profiles WHERE id = auth.uid()) <> 'vendedor'
      OR seller_id = auth.uid()
    )
  );

-- 3. Política INSERT: Solo el propio usuario puede crear pedidos de su tenant
CREATE POLICY "orders_insert_own_tenant" ON orders
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
  );

-- 4. Política UPDATE: Vendedor puede editar sus propios pedidos.
--    Supervisor y Admin pueden editar cualquier pedido de su tenant.
--    Regla de negocio: pedidos 'entregado' NO son editables (se protege a nivel de service/UI).
CREATE POLICY "orders_update_by_role" ON orders
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    AND (
      (SELECT role FROM public.user_profiles WHERE id = auth.uid()) <> 'vendedor'
      OR seller_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
  );

-- 5. Política DELETE: Prohibida para todos (soft delete mediante status='cancelado')
--    Ningún rol puede hacer DELETE físico en orders.
CREATE POLICY "orders_no_delete" ON orders
  FOR DELETE USING (false);
```

---

## 5. Contratos TypeScript

### 5.1 Corrección de `ORDER_STATUS` en `constants.ts`

**ACCIÓN REQUERIDA:** Reemplazar completamente el bloque `ORDER_STATUS` con los valores correctos que coinciden con el CHECK constraint de la BD y agregar labels de display:

```typescript
// En src/config/constants.ts — REEMPLAZAR el bloque ORDER_STATUS existente

export const ORDER_STATUS = {
  BORRADOR:  'borrador',
  PENDIENTE: 'pendiente',
  APROBADO:  'aprobado',
  ENTREGADO: 'entregado',
  CANCELADO: 'cancelado',
} as const;

export type OrderStatusValue = typeof ORDER_STATUS[keyof typeof ORDER_STATUS];

// Labels visuales y colores para badges — fuente de verdad del design-system
export const ORDER_STATUS_CONFIG: Record<string, { label: string; bgClass: string; textClass: string }> = {
  borrador:  { label: 'Borrador',  bgClass: 'bg-[#9E9E9E]/10', textClass: 'text-[#616161]' },
  pendiente: { label: 'Pendiente', bgClass: 'bg-[#FCAA18]/10', textClass: 'text-[#b37a00]' },
  aprobado:  { label: 'Aprobado',  bgClass: 'bg-[#1976D2]/10', textClass: 'text-[#1565C0]' },
  entregado: { label: 'Entregado', bgClass: 'bg-[#02B446]/10', textClass: 'text-[#028A36]' },
  cancelado: { label: 'Cancelado', bgClass: 'bg-[#FC1C27]/10', textClass: 'text-[#c41018]' },
};

// Nuevos mensajes de error para agregar a MESSAGES.ERROR:
// FETCH_ORDER_DETAIL: 'Error al cargar el detalle del pedido.'
```

### 5.2 Interfaz `OrderFilters`

```typescript
// En src/services/orderService.ts — AGREGAR

export interface OrderFilters {
  status?: string;      // Valor exacto del enum: 'borrador' | 'pendiente' | 'aprobado' | 'entregado' | 'cancelado'
  dateFrom?: string;    // ISO date string: 'YYYY-MM-DD' — filtro gte en created_at
  dateTo?: string;      // ISO date string: 'YYYY-MM-DD' — filtro lte en created_at (se agrega T23:59:59)
  customerId?: string;  // UUID — filtro exacto por customer_id
}
```

### 5.3 Interfaz `OrderDetailDTO`

```typescript
// En src/services/orderService.ts — AGREGAR

export interface OrderItemDTO {
  id: string;
  product_id: string;
  product_name: string;   // JOIN con products.name
  category?: string;      // JOIN con products.category
  caliber?: string;       // JOIN con products.caliber
  brand?: string;         // JOIN con products.brand
  quantity: number;
  unit_price: number;
  total_price: number;
}

export interface OrderDetailDTO {
  id: string;
  order_number: string;
  created_at: string;
  updated_at?: string;
  status: string;
  total_amount: number;
  notes?: string;
  customers: { business_name: string; contact_name?: string; phone?: string } | null;
  user_profiles: { full_name: string } | null;
  items: OrderItemDTO[];
}
```

### 5.4 Firma del método `getOrderDetail`

```typescript
// Método a AGREGAR en src/services/orderService.ts
async getOrderDetail(orderId: string): Promise<OrderDetailDTO>
```

### 5.5 Firma actualizada de `getOrders`

```typescript
// Firma ACTUALIZADA — el parámetro filters es nuevo
async getOrders(
  tenantId: string,
  page?: number,
  searchQuery?: string,
  filters?: OrderFilters,
  limit?: number
): Promise<{ data: OrderDTO[], count: number }>
```

---

## 6. Plan de Implementación Secuencial para el @programador

### Paso 1 — Migración SQL (via @operador)
Ejecutar la migración `20260310000000_orders_role_based_rls.sql` en el entorno de desarrollo.

### Paso 2 — `src/config/constants.ts`
- Reemplazar `ORDER_STATUS` (claves en español, valores en español minúscula).
- Agregar `ORDER_STATUS_CONFIG` (tabla de colores y labels).
- Agregar `OrderStatusValue` type.
- Agregar en `MESSAGES.ERROR.FETCH_ORDER_DETAIL`.

### Paso 3 — `src/services/orderService.ts`
- Agregar interfaces `OrderFilters`, `OrderItemDTO`, `OrderDetailDTO`.
- Modificar `getOrders()`: añadir parámetro `filters?` y aplicar filtros con `.eq()`, `.gte()`, `.lte()`.
- Agregar método `getOrderDetail(orderId)`: seleccionar `orders` + JOIN `order_items` + JOIN `products`.

### Paso 4 — `src/ui/features/orders/OrderListView.tsx`
- Agregar estado local `selectedStatus` (string | null) y `dateFrom/dateTo` (string).
- Agregar sección de **chips de estado** usando `ORDER_STATUS_CONFIG` — scrolleable horizontal en mobile.
- Agregar botón **"Filtros"** colapsable que revela los `<input type="date">` Desde/Hasta.
- Conectar filtros al `fetchOrders()` vía `filters` prop del service.
- Al cambiar cualquier filtro → `setPage(1)` + re-fetch.
- Corregir `getStatusBadge()` usando `ORDER_STATUS_CONFIG[status]` en lugar de switch hardcodeado.
- Hacer clickeable cada fila/card para navegar a `OrderDetailView`.

### Paso 5 — `src/ui/features/orders/OrderDetailView.tsx` (nuevo)
- Recibe `orderId: string` y `onBack: () => void` como props.
- Al montar → llama `orderService.getOrderDetail(orderId)`.
- Muestra skeleton loader mientras carga.
- Layout: header con número + badges de estado, sección cliente, tabla de ítems, totales.
- Si `status === 'entregado'` → banner de solo lectura en naranja/gris arriba de la tabla.
- Botón "← Volver" llama `onBack()`.

### Paso 6 — `src/App.tsx`
- Agregar estado `selectedOrderId: string | null`.
- Agregar vista `currentView === 'order-detail'` que renderiza `<OrderDetailView orderId={selectedOrderId} onBack={() => setCurrentView('orders')} />`.
- Pasar a `OrderListView` callback `onViewDetail={(id) => { setSelectedOrderId(id); setCurrentView('order-detail'); }}`.

---

## 7. Restricciones y Reglas de Negocio

| Regla | Detalle |
|---|---|
| Solo lectura | Pedidos con `status === 'entregado'` no pueden editarse desde la UI |
| RLS Vendedor | Un vendedor solo puede SELECT sus propios pedidos (`seller_id = auth.uid()`) |
| RLS Supervisor/Admin | Puede ver todos los pedidos del tenant |
| No DELETE físico | La política `orders_no_delete` bloquea cualquier DELETE a nivel de BD |
| Constantes | Todo valor de estado debe venir de `ORDER_STATUS.*`, nunca strings literales |
| Errores | Nunca exponer errores técnicos al usuario — usar `MESSAGES.ERROR.*` |
| Estados UI | `isLoading` nunca se persiste en disco ni en Zustand |
| Fuente de verdad visual | Todos los colores de badge vienen de `ORDER_STATUS_CONFIG` del design-system |
