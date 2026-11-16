# Blueprint Técnico: Ejecución Sprint 2 (Delta v2)

## Contexto Actualizado
El Sprint 1 ya estableció la base del proyecto. Ya contamos con la infraestructura básica de base de datos (`customers`, `products`, `orders`, `order_items`) y las vistas/servicios fundamentales (`CustomerListView`, `ProductListView`, `OrderListView`). 

El objetivo del Sprint 2 no es construir desde cero, sino **evolucionar y extender** la arquitectura existente para cumplir con las Historias de Usuario (HUs) del inventario masivo, validación de stock, borradores de pedidos y expedición.

---

## Fase 0: Evolución de Infraestructura (Instrucciones para @operador)
**Objetivo:** Adaptar las tablas existentes mediante migraciones e instanciar servicios de Storage.
*No se crearán tablas desde cero (salvo logs específicos), se harán operaciones `ALTER TABLE`.*

1. **Migraciones de Base de Datos (Delta):**
   * **`products`:** Verificar/Agregar soporte para versionado de lotes (si no se está usando la columna `shipment_number` para ello) y constraints estrictos (`CHECK (available_quantity >= 0)` si no existen o se omitieron).
   * **`customers`:** Verificar que exista la relación `assigned_seller_id`.
   * **`orders`:** Añadir soporte para el estado `Draft` si no existe en el constraint original, y campos para control de estados avanzados (ej. despachado).
   * **Migración Nueva:** Crear la tabla `inventory_imports` para mantener el registro de auditoría de los excels procesados y quién los subió.

2. **Storage:**
   * Crear el bucket `inventory_documents` para resguardar los archivos Excel originales subidos por los administradores.

---

## Fase 1: Núcleo de Inventario (Instrucciones para @programador)
**Afecta a:** `ProductListView.tsx` y su hook asociado (ej. `useProductManagement`).

1. **Carga Segura de Excel (SheetJS):**
   * **Integración:** En la vista **existente** `ProductListView`, agregar la acción de "Cargar Excel".
   * **Carga Diferida:** `import('xlsx')` DEBE ejecutarse únicamente dentro de la función de manejo del archivo (dynamic import).
   * **Asincronía (Web Worker / Chunks):** La lectura del blob y la validación cruzada con **Zod** debe parcelarse utilizando `requestIdleCallback` o constructos similares para que archivos con miles de filas no congelen la interfaz de React.
   * **Estado Visual:** Mientras se procesa el documento, la UI debe mostrar un Loading State global para la grilla y bloquear subidas adicionales.

2. **Edición Inline (US-INV-04):**
   * Ampliar los componentes de celda en `ProductListView` para permitir campos editables (debounce on change -> update Supabase).

---

## Fase 2: Motor de Pedidos (Instrucciones para @programador)
**Afecta a:** `useOrderActions.ts` (y los hooks de creación correspondientes).

1. **Borradores Automáticos / Autosave (US-ORD-07):**
   * Implementar en la lógica de creación de orden (formulario existente o su hook) un evento "debounce" (ej. 1s - 2s) que inserte o haga update de un registro en `orders` con `status = 'borrador'`.
   
2. **Validación de Stock (US-ORD-03):**
   * **Lado Cliente:** Deshabilitar sumatorias de cantidad en memoria si superan el `available_quantity` inyectado.
   * **Lado Servidor:** El método de "Aprobar Orden" debe ejecutar una llamada transaccional a Supabase (preferiblemente vía RPC o validación edge) para asegurar que el inventario no bajará de 0 antes de consolidar el item. Si falla la transacción atómica, el hook debe atrapar el error, no mutar optimistamente la UI, y mostrar una notificación de "Stock Insuficiente" (Toast).

---

## Fase 3: Historial y Despacho (Instrucciones para @programador)
**Afecta a:** `OrderListView.tsx` y creación de `DispatcherView.tsx`.

1. **Máquina de Estados:**
   * Ampliar el formulario/vista de detalle de orden para permitir transiciones de estado explícitas a vendedores/administradores (Pendiente -> Aprobado -> Entregado).

2. **Vista de Despachador (US-HIS-03):**
   * Crear una vista/derivación dedicada enfocada exclusivamente en órdenes `Aprobadas` listas para despacho.
   
3. **Compartir por WhatsApp (US-HIS-05):**
   * Ya existe un esqueleto en `useOrderActions.ts` (`handleWhatsAppSend`). Asegurar que el payload (`whatsappUtils`) implemente "Safe-Text": limitación estricta de caracteres, truncado y parseo robusto antes de disparar el deep link a WhatsApp API.
