# Blueprint Técnico Definitivo: Ejecución Sprint 2 (v3.0)

El objetivo de este Sprint es expandir la arquitectura base existente (las tablas y vistas de `customers`, `products`, `orders` consolidadas en el Sprint 1) para satisfacer las 18 Historias de Usuario (HUs) pendientes con foco en: **Inventario Masivo, Motor de Pedidos y Ciclo de Vida del Despacho**.

> [!CAUTION]
> Queda estrictamente prohibido el desarrollo directo en `develop` o `main`. Cada fase define su propia rama `feature/...` aislada. 
> Todos los layouts de tablas/listas DEBEN mantener el bloque contenedor: `w-full max-w-[100vw] overflow-x-clip min-w-0`.

---

## Fase 0: Infraestructura & Datos
**Asignado a:** `@operador`
**Rama Base:** `feature/02-core-infrastructure`
**Objetivo:** Evolucionar las tablas actuales mediante migraciones SQL sin destruir datos.

### 1. Migraciones de Base de Datos (`.sql`)
Crear archivos de migración independientes por cada tabla afectada:

*   **Inventario (US-INV-02) - Versionado:**
    *   *Opción Delineada:* No alterar la tabla `products` en tiempo real para mantener el historial. Se debe crear una nueva tabla `inventory_versions` (id, product_id, previous_quantity, new_quantity, updated_by, created_at) y un TRIGGER que escuche `UPDATE` sobre `products.available_quantity` e inserte el registro automático. 
    *   Asegurar que `products.available_quantity` tenga el CHECK transaccional explícito `CHECK (available_quantity >= 0)`.

*   **Clientes (US-CLI-02) - Asignación:**
    *   Ejecutar `ALTER TABLE customers ADD COLUMN IF NOT EXISTS assigned_seller_id UUID REFERENCES user_profiles(id);`.

*   **Pedidos (US-HIS-02) - Máquina de Estados:**
    *   Si `status` en la tabla `orders` se generó como un `CHECK IN ('borrador', 'pendiente', ...)`, ejecutar un `ALTER TABLE orders DROP CONSTRAINT ...` y reemplazarlo por la nueva validación: `CHECK (status IN ('Draft', 'Pending', 'Approved', 'Delivered', 'Cancelled'))`. Adaptar registros existentes si aplica para evitar conflictos relacionales.

*   **Auditoría de Cargas Masivas (Nueva Tabla):**
    *   Crear `inventory_imports` (id, tenant_id, file_name, row_count, success_count, error_count, created_by, created_at).

### 2. Políticas RLS
Ajustar las políticas de seguridad en base al rol de quien consulta (usando `user_profiles`):
*   `customers`: El perfil *Vendedor* SOLO puede ver sus clientes `assigned_seller_id = auth.uid()` O donde `assigned_seller_id IS NULL` (públicos del tenant). *Admin/Supervisor* pueden ver todos.

### 3. Storage
*   Instanciar y configurar el bucket privado `inventory_documents` con RLS por Tenant.

---

## Fase 1: Motor de Inventario
**Asignado a:** `@programador`
**Rama Base:** `feature/sp2-inventory-engine`
**Depende de:** Finalización total de `feature/02-core-infrastructure`.

Esta fase amplía la vista `ProductListView.tsx` actualmente funcional.

1.  **Carga Masiva Excel (US-INV-01, US-SEC-06):**
    *   **Botón de Importar:** Agregar el componente visual a la cabecera actual.
    *   **Dynamic Import (Obligatorio):** `import { read, utils } from 'xlsx'` debe invocarse DENTRO del handler transaccional del `onDrop`/`onChange` del input file.
    *   **Validación Zod:** Aplicar un schema estricto que mapee las columnas del Excel (SKU, PRODUCTO, CATEGORÍA, STOCK) contra el DTO esperado por `ProductService`.
    *   **Worker Strategy:** Para no detonar el Thread principal del navegador procesando Excels grandes, usar la API de `requestIdleCallback` procesando arreglos en *chunks* de 100-250 filas, o en su defecto, envolver la lógica SheetJS en un Web Worker puro. Excepcionar "Background Throttling".
2.  **Edición Inline (US-INV-04):**
    *   Convertir las celdas o filas de la vista existente en inputs debounced. Disparar el Service Patch contra backend (esto activará el Trigger de Versionado creado en Fase 0).

---

## Fase 2: Gestión de Clientes Avanzada
**Asignado a:** `@programador`
**Rama Base:** `feature/sp2-customers-advanced`
**Depende de:** `feature/02-core-infrastructure`. (Puede correr paralelo a Fase 1).

Ampliar la vista existente `CustomerListView.tsx`.

1.  **Lógica de Asignación (US-CLI-02):**
    *   Agregar columna "Vendedor Asignado".
    *   Esta columna y su `Select` de edición solo debe ser interactuable si el `role` actual en la sesión activa es `admin` o `supervisor`. Al modificarla se ejecuta el PATCH hacia la columna editada en Fase 0.
    *   Ocultar los clientes no correspondientes si el hook determina que el usuario es vendedor.

---

## Fase 3: Motor de Pedidos (Lógica Transaccional)
**Asignado a:** `@programador`
**Rama Base:** `feature/sp2-orders-logic`
**Depende de:** Fase 1 (Para que los IDs de producto y el Mock sean estables).

El desarrollo toma lugar en el hook existente `useOrderActions.ts` u otro hook conector del formulario de creación y en las vistas actuales.

1.  **Autosave/Drafts (US-ORD-07):**
    *   Implementar el custom hook `useDebounce` conectado a los campos del formulario activo de pedido. Al cambiar un ítem y calmarse el tecleo (1s), disparar un UPSERT en background contra Supabase con `status: 'Draft'`. El spinner en UI de "Guardando borrador..." no debe bloquear al usuario para seguir tipeando.
2.  **Stock Check & Double Validation (US-ORD-03):**
    *   **Optimista (React):** Bloquear el incremento en el carrito si el valor `available_quantity` de la memoria local (ProductsCache) se iguala.
    *   **Transaccional (Supabase):** En la llamada final de "Confirmar Orden", el Service DEBE apoyarse en la base de datos (Ej: Edge function de inserción transaccional o un RPC seguro). Si el stock fue consumido por otro Vendedor 1 milisegundo antes, el backend devolverá Error por constraint (revisar Fase 0), el frontend atrapará el fallo y notificará ("Items agotados"). JAMAS forzar el guardado si falla.
3.  **Duplicar Orden (US-ORD-08):**
    *   En la vista previa del pedido base, agregar el handler de "Duplicar". Mapeará en memoria todos los `order_items` de ese `order_id` excluyendo el Status viejo, inyectará un nuevo formulario y pondrá la pantalla en modo edición (`Draft`).

---

## Fase 4: Despacho y Ciclo de Vida
**Asignado a:** `@programador`
**Rama Base:** `feature/sp2-dispatch-view`
**Depende de:** Fase 3 (Para generar Data Mock).

1.  **Vista de Despachador (US-HIS-03) (Componente Nuevo):**
    *   Crear `DispatcherDashboard.tsx`. Este componente se conectará al servicio de ordenes filtrando estrictamente por `status IN ('Approved', 'Pending')`.
    *   Implementar las vistas agrupadas estilo Kanban o DataTable condensada según UX.
2.  **Máquina de Estados (US-HIS-02):**
    *   Limitar las transiciones de estado a un flujo unidireccional por seguridad:
        *   `Draft` (Vendedor) -> `Pending`
        *   `Pending` (Admin) -> `Approved`
        *   `Approved` (Despachador) -> `Delivered`
    *   Las transiciones enviarán el UPDATE con un simple botón de acción bloqueante (Loading State absoluto en el row).
3.  **Refinamiento WhatsApp (Existente `handleWhatsAppSend`):**
    *   Se asume integrado, pero verificar la validación estructural al momento de compilar el mensaje (Sanitización Safe-Text).
