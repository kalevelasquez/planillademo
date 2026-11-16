# Blueprint Técnico Definitivo: Ejecución Sprint 2 (v4.0)

El objetivo de este Sprint es expandir la arquitectura base existente para satisfacer las Historias de Usuario (HUs) con foco en: **Inventario Masivo, Motor de Pedidos y Ciclo de Vida del Despacho (Dispatcher)**.

> [!CAUTION]
> Queda estrictamente prohibido el desarrollo directo en `develop` o `main`. Cada fase define su propia rama `feature/...` aislada. 
> Todos los layouts de tablas/listas DEBEN mantener el bloque contenedor: `w-full max-w-[100vw] overflow-x-clip min-w-0`.
> TODAS las vistas (Views) deben ser "Vistas Pasivas" utilizando hooks delegados (Patrón `use[Feature]Actions`).

---

## Fase 0: Infraestructura & Datos (Actualizado a v4.0)
**Asignado a:** `@operador`
**Rama Base:** `feature/02-core-infrastructure`

### 1. Migraciones de Base de Datos (`.sql`)

*   **Auditoría de Despacho (NUEVO V4.0):**
    *   La tabla `orders` requiere las siguientes columnas para el módulo de Dispatcher:
        *   `shipped_at` (TIMESTAMP WITH TIME ZONE) - Marca de inicio de preparación.
        *   `delivered_at` (TIMESTAMP WITH TIME ZONE) - Marca final de entrega exitosa o envío.
        *   `handled_by` (UUID REFERENCES user_profiles(id)) - Qué despachador o administrador gestionó el pedido.
*   **Inventario (US-INV-02) - Versionado:**
    *   Crear la tabla `inventory_versions` y trigger sobre `UPDATE` en `products.available_quantity`.
    *   *Nota de auditoría:* Este trigger NO colapsará durante el autosave del Phase 3 (`Draft`), ya que los Drafts no descuentan el inventario físico hasta ser promovidos a `Approved`. El trigger de inventario actuará limpiamente tras confirmar la orden.
*   **Pedidos (US-HIS-02) - Máquina de Estados:**
    *   `CHECK (status IN ('Draft', 'Pending', 'Approved', 'In Preparation', 'Delivered', 'Cancelled'))`.
    *   *(Se añade 'In Preparation' en V4).*

### 2. Políticas RLS (Optimización de Despacho V4.0)
*   Las políticas actuales sobre `orders` (como `orders_tenant_isolation`) utilizan subconsultas `SELECT tenant_id FROM user_profiles`. Esto afecta gravemente el escaneo de tabla (seq scan) en un dashboard de despacho masivo.
*   **Acción Requerida:** Actualizar las políticas para usar la función `get_auth_tenant_id()` y `get_auth_role()` (introducidas en fixes previos) que leen directo desde el JWT, eliminando la latencia en las consultas `status = 'Approved'` requeridas por el Despachador.

---

## Fase 1 y Fase 2 (Completadas o Estabilizadas)
*Fase 1 (Importación Masiva XLSX) y Fase 2 (Vistas Reactivas de Clientes) se rigen bajo los parámetros de v3.0, ya finalizados.*

---

## Fase 3: Motor de Pedidos (Lógica Transaccional Optimizada)
**Asignado a:** `@programador`

*   **Autosave/Drafts (Completado):** Rehidratación nativa centralizada en Zustand (`useOrderStore.initializeDraft`).
*   **Amnesia de Sesión (Solucionada):** El resumen y catálogo observan de forma proactiva al `selectedCustomer`.
*   **Stock Check:** Evaluado limpiamente contra Supabase.

---

## Fase 4: Despacho y Ciclo de Vida (Actualizado V4.0)
**Asignado a:** `@programador`
**Rama Base:** `feature/sp2-dispatch-view`
**Depende de:** Finalización de la migración V4.0 de Dispatcher Docs por el `@operador`.

1.  **Vista de Despachador Estricta (US-HIS-03):**
    *   Crear `DispatcherDashboard.tsx`.
    *   **Arquitectura de Vistas Pasivas:** Toda conexión, filtrado y lógica transaccional debe vivir en un hook `useDispatchActions.ts`. El componente TSX solo dibuja UI.
    *   Conexión al servicio filtrando pedidos por `status IN ('Approved', 'In Preparation')`.
2.  **Máquina de Estados Realista (Añadido 'In Preparation'):**
    *   `Draft` (Vendedor) -> `Pending`
    *   `Pending` (Admin) -> `Approved`
    *   `Approved` -> `In Preparation` *(El Despachador adquiere el ticket, inyecta su UUID en `handled_by` y sella `shipped_at`)*
    *   `In Preparation` -> `Delivered` *(Cierre del flujo y sellado de `delivered_at`)*
    *   *Manejo de UI:* Las transiciones enviarán el UPDATE bloqueante (Loading State por ticket).
3.  **Filtrados Especiales por Tenant:**
    *   El dashboard manejará alto volumen diario. La paginación adoptada en el resto de la app es obligatoria para la seguridad de memoria de la app.
