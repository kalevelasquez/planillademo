# Blueprint Técnico: Ejecución Sprint 2

## 1. Análisis de Brechas (Gap Analysis)
La arquitectura actual (Sprint 1) cubre la base de autenticación y estructura de proyecto. Para soportar el Sprint 2 necesitamos las siguientes adiciones críticas:
- **Base de Datos:**
  - Tablas necesarias: `customers`, `products` (con control de versión/stock), `orders`, `order_items`, `inventory_imports` (para logs de auditoría general).
  - Políticas RLS: Todas las nuevas tablas requieren políticas que filtren estrictamente por `tenant_id` y por roles estipulados (ADMIN, SUPERVISOR, VENDEDOR).
  - Integridad Referencial: Las transacciones de pedido requieren constraints Postgres (`stock_quantity >= 0`) para bloquear la reserva de unidades en negativo.
- **Storage:**
  - Bucket `inventory_documents` para alojar tanto los Excels originales de carga masiva como copias de seguridad de versionado.
- **Frontend / Rendimiento:**
  - La carga de `SheetJS` (pesada) violaría el tech-stack si se hace global. Requiere *Dynamic Imports* y manejo de estado asíncrono robusto para no congelar la UI de React al leer archivos grandes.

## 2. Definición de Infraestructura y Ramas
La estrategia se ajusta a `tech-stack.md` (rama productiva `main`, rama de integración `develop`).

**Rama Base del Sprint 2:**
Nomenclatura: `develop` (Las features se originarán a partir de esta).

**Estrategia de Branching (Concurrencia y Prioridad):**
1.  `feature/sp2-inventory-core`: **BLOQUEANTE**. Implementa base de datos, tipos y crud de inventario. Debe completarse (o al menos definir y mockear los contratos DTOs en `/services`) antes del Motor de Pedidos.
2.  `feature/sp2-customers`: **INDEPENDIENTE**. Puede correr en paralelo desde el inicio (US-CLI-01, US-CLI-02).
3.  `feature/sp2-orders-engine`: **DEPENDIENTE**. Requiere los tipos base del inventario para la validación de stock y armado de los ítems.
4.  `feature/sp2-lifecycle-dispatch`: **DEPENDIENTE**. Requiere la tabla, estructura y estados definidos por el Motor de Pedidos.

## 3. Fases de Implementación (Instrucciones Mandatorias)

### Fase 0: Preparación (Instrucciones para @operador)
**Objetivo:** Establecer la infraestructura subyacente mediante migraciones (Zero-click DB changes).
1.  **Migraciones de DB (Archivos `.sql`):**
    *   Crear tabla `customers` (`tenant_id`, `name`, `contact`, `status`).
    *   Crear tabla `products` (`tenant_id`, `sku`, `name`, `stock_quantity`, `version`).
    *   Crear tabla `orders` (`tenant_id`, `customer_id`, `status` [Draft, Pending, Approved, Delivered], `notes`).
    *   Crear tabla `order_items` con Foreign Key estricta a `orders` y `products`.
    *   Crear tabla `inventory_imports` para mantener el historial de las acciones masivas.
2.  **Seguridad (RLS):**
    *   Implementar `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;` y políticas de selección/inserción/modificación que fuercen la correspondencia de `auth.uid()` / `tenant_id` en TODAS las tablas.
3.  **Storage:**
    *   Configurar el Bucket Supabase `inventory_documents` con RLS acorde al tenant.
4.  **Entorno:**
    *   Asegurar que el entorno de desarrollo apunte a `develop` y estructurar las ramas base.

### Fase 1: Núcleo de Inventario (Instrucciones para @programador)
**Epics:** US-INV-01, US-INV-02, US-INV-03, US-INV-04, US-INT-02, US-SEC-06, US-PER-02.
*   **Contención de UI:** Todos los listados deben regirse por el Layout Blindado (`w-full max-w-[100vw] overflow-x-clip min-w-0`).
*   **Carga Excel (SheetJS + Zod):**
    *   *Regla de Importación:* `import('xlsx')` debe ejecutarse ÚNICAMENTE al invocar el handler de carga de archivo. Prohibido top-level imports.
    *   *Asincronía (No Bloqueo):* La lectura con SheetJS y la validación cruzada con Zod (para US-SEC-06) DEBE procesarse en chunks (segmentando el array asíncronamente o vía un pequeño Web Worker) para no disparar alertas de inactividad de react/browser si supera miles de filas. La UI mostrará spinner y bloqueará botones durante la ejecución.
    *   *Bidireccional y Versionado (US-INT-02, US-INV-02):* Interfaz estricta en los retornos. Enviar el array analizado al backend a través de la capa aislada `/services`.

### Fase 2: Motor de Pedidos (Instrucciones para @programador)
**Epics:** US-ORD-03, US-ORD-05, US-ORD-07, US-ORD-08.
*   **Autosave/Drafts (US-ORD-07):**
    *   Se requiere un **Custom Hook** (`useOrderDraft`) que controle un mecanismo de "debounce" (ej: 1 segundo). Guardará los cambios tempranos asíncronamente contra Supabase como status `Draft`.
*   **Filtros de Stock y Prevención de Mutaciones Cruzadas (US-ORD-03):**
    *   Evitar el optimismo directo: cuando se consolida la orden ("Procesar"), el backend evaluará atómicamente la disponibilidad de stock o dependerá de una Edge Function. Si devuelve Error, el formulario tratará el error tipado (`unknown`, luego interpretado) y repintará el problema de los ítems. No se asume el éxito sin confirmación del servidor.
*   **Bloqueo de Interfaz:** Deshabilitar obligatoriamente todos los submit buttons en estado de carga.

### Fase 3: Ciclo de Vida y Despacho (Instrucciones para @programador)
**Epics:** US-HIS-01, US-HIS-02, US-HIS-03, US-HIS-05.
*   **Máquina de Estados:** Formulario puramente declarativo. El custom hook controlará que las transiciones de estatus (`Draft` -> `Pending` -> `Approved` -> `Delivered`) no tengan saltos irreconocibles (según lógica administrativa).
*   **Vista Despachador (US-HIS-03) y Filtros (US-HIS-01):** Componente aislado de la lista normal de órdenes, apuntando a vistas filtradas (`status = Approved`) mediante la delegación al servicio correspondiente. Se incluirá paginación nativa o lazy load por chunks (US-PER-02).
*   **Compartir WhatsApp (US-HIS-05):** Aplicar sanitización ("Safe-Text") con un helper format. Cortará caracteres extraños, truncará variables si es excesivamente largo el pedido y utilizará links profundos a la API de WhatsApp, manejado a nivel cliente puro.
