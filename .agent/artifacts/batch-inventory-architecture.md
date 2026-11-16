# Arquitectura de Datos: Gestión de Inventario por Embarques (Batch Tracking)

## 1. El Nuevo Modelo de Dominio
El modelo estático basado en un "SKU manual" queda deprecado. La nueva unidad atómica de información logística es el **Lote/Embarque**. 
Un artículo único en la bodega se define estrictamente por la combinación de sus características físicas y logísticas.

### La Llave Compuesta (Identidad Estricta)
Para garantizar la integridad y evitar duplicados, la unicidad (`UNIQUE CONSTRAINT`) a nivel de base de datos se formará por:
`[ tenant_id, name, caliber, brand, quality, shipment_number ]`

## 2. Estructura de la Base de Datos (DDL)

### Modificaciones a la tabla `products`
La tabla principal absorberá los campos provenientes del Excel.

| Excel Header | Columna DB | Tipado SQL | Regla / Constraint |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY`. Las FK en `order_items` siguen apuntando aquí. |
| `status` | `TEXT` | `DEFAULT 'active'`. Valores: `'active'`, `'incomplete'`. (Para módulo de revisión). |
| `PRODUCTO` | `name` | `TEXT` | `NOT NULL`. Mapea la columna en Excel. |
| `CALIBRE` | `caliber` | `TEXT` | `NOT NULL`. Mapea la columna en Excel. |
| `MARCA` | `brand` | `TEXT` | `NOT NULL`. Mapea la columna en Excel. |
| `CALIDAD` | `quality` | `TEXT` | `NOT NULL`. Mapea la columna en Excel. |
| `EMBARQUE` | `shipment_number` | `TEXT` | `NOT NULL`. Mapea la columna (originalmente o en proceso `EMB#` a `EMBARQUE`). |
| `INGRESO` | `entry_date` | `DATE` | Mapea la columna `INGRESO`. Fecha real de ingreso a bodega. |
| `INVENTARIO` | `available_quantity`| `DECIMAL(12,2)`| Mapea la columna de `inventario` normalizada. Sube a decimal para soportar kilos o fracciones. `CHECK (>= 0)` |
| `PRECIO` | `price_cliente` | `DECIMAL(12,2)`| Precio base de venta. |
| `sku_sintetico` | `TEXT` | `GENERATED ALWAYS AS (...) STORED`. Código auto-generado, ej: `STE-138-EMB31`. |
| `created_at` | `TIMESTAMPTZ`| El motor inyecta `NOW()` al crear. Sustituye la necesidad de leer la columna `FECHA` del Excel. |

*Normalización de Idioma:* Todo el *mapping* de librerías como *SheetJS* debe buscar estrictamente los encabezados normalizados en español y mayúsculas (`PRODUCTO`, `CALIBRE`, `MARCA`, `CALIDAD`, `EMBARQUE`, `INGRESO`, `INVENTARIO`, `PRECIO`). De igual forma, todos los mensajes de error, *toasts* de UI, y componentes visuales deben estar en español, respondiendo al diseño original del proyecto.

*Nota sobre "Días en Bodega" y "FECHA":* Ambas columnas del archivo fuente (`DIAS EN BODEGA` y `FECHA`) **se ignoran en la base de datos**. `FECHA` es redundante por la existencia de la columna inmutable `created_at` de Supabase. "Días", al ser un valor dependiente del tiempo, se calculará dinámicamente en el Frontend como: `DIAS = NOW() - entry_date`.

## 3. Estrategia de Ingesta (UPSERT)
El motor de inserción desde el Frontend usará el mecanismo `UPSERT` de PostgreSQL basado en la llave compuesta.

```javascript
// Pseudo-código del Frontend (Supabase JS)
await supabase.from('products').upsert(lotes, { 
    onConflict: 'tenant_id, name, caliber, brand, quality, shipment_number' 
});
```
- **Si el Lote No Existe:** Hace `INSERT`, genera el UUID primario perpetuo, y crea el respectivo SKU Sintético.
- **Si el Lote Ya Existe (mismas 5 características + EMB#):** Hace un `UPDATE` afectando solo el inventario (`available_quantity`), protegiendo el `id` original y por ende, manteniendo el historial de notas de venta intacto.

## 4. Estrategia para Información Incompleta (Mantenimiento / Cuarentena)

El Excel crudo puede contener filas con información vital faltante (ej. sin `EMBarque`, sin `INGRESO`, o sin `CALIDAD`). No podemos insertar llaves nulas si son parte del índice único porque rompería el Upsert y la integridad.

### El Flujo de "Cuarentena"
1. **Detección en el Frontend (Algoritmo B):** Durante el parseo del Excel usando SheetJS, el código aislará las filas a las que les falte al menos una de las columnas obligatorias de la llave compuesta (`name`, `caliber`, `brand`, `quality`, `shipment_number`).
2. **Asignación de "Placeholder":** A las celdas vacías que formen parte de la llave compuesta se les asignará un valor comodín que incluya un UUID o Timestamp (ej. `shipment_number = 'PENDIENTE-' || uuid()`) para evitar que las filas incompletas colisionen entre sí en el `ON CONFLICT`.
3. **Marca de Estado:** Estas filas se insertarán en la tabla `products` con la columna `status = 'incomplete'`.
4. **Módulo de Mantenimiento (UI):** Se creará una vista o pestaña nueva en la interfaz (Ej. "Revisión de Lotes") que filtre `SELECT * FROM products WHERE status = 'incomplete'`.
5. **Corrección Manual:** El Supervisor podrá entrar a este módulo, visualizar las filas huérfanas o con datos flatantes, y llenar los campos (ej. asignarles a qué embarque realmente pertenecían).
6. **Resolución de Conflictos al Guardar:** Cuando el usuario guarde la corrección, el sistema actualizará los campos y pasará el `status` a `'active'`. (A nivel backend, si la corrección causa que el ítem ahora empate con un lote *ya existente* y activo, se sumarán los inventarios y se eliminará el registro huérfano para evitar colisiones).

## 5. Plan de Acción Técnico (Para el Programador)

1. **Migración SQL (DDL):**
   - Eliminar estrictamente la columna `sku` y sus constraints antiguos (`products_tenant_sku_key`), así como cualquier columna que ya no pertenezca al nuevo contrato.
   - Preservar intacta la relación de llave foránea con `product_categories` (`category_id`).
   - Añadir columnas: `status`, `shipment_number`, `entry_date`.
   - Modificar la columna de Inventario a `DECIMAL` e inyectar datos de saneamiento para filas existentes (asignarles `shipment_number = 'S/I'`).
   - Crear el `UNIQUE CONSTRAINT` y la columna virtual generada `sku_sintetico`.
2. **Actualizar Capa de Servicios:** 
   - Modificar las interfaces TS en el entorno React.
   - **Lógica de Categorías:** Si una fila del Excel es apta pero carece de la columna de categoría, el algoritmo debe crear o recuperar automáticamente una categoría llamada `"OTROS"` o `"SIN CATEGORIA"` y asignarle ese `category_id` para no corromper la tabla de productos.
3. **Adaptar ProductManagementView:** Alterar la lógica del Dropzone (Drag & Drop) para que clasifique entre "Lotes Óptimos" y "Lotes Incompletos".
4. **Desarrollar Módulo de Revisión:** Construir la pestaña "Lotes Incompletos" donde se corrijan las inconsistencias.
