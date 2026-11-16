# 🛠️ Extensión de Esquema: Cuarentena de Inventario (Fase 1.5)

## 1. Análisis del Problema
Durante la carga de catálogos masivos a través del Motor de Inventario (Excel), ocurren excepciones lógicas capturadas por validaciones de Zod (p.ej., esquemas incompletos, faltantes de embarques, marcas o problemas de tipado de precios). Actualmente, el registro general asienta los errores contados estadísticamente en la tabla `inventory_imports`, pero las hileras de datos erróneos se pierden en la consola efímera del cliente, impidiendo su revisión y auditoría posterior (flujo de "Cuarentena").

## 2. Modelo de Datos / Esquema Propuesto
Se precisa extender la infraestructura relacional de auditoría. Se añadirá una columna flexible `JSONB` a la tabla de reportes maestra.

### A. Modificación a la tabla `inventory_imports`
*   **Columna a inyectar:** `quarantine_data`
*   **Tipo de dato:** `JSONB`
*   **Constraint/Restricción:** `NULLABLE` (Si no existen errores, permanece en un valor nulo para ahorrar recursos).
*   **Estructura Semántica Obligatoria del JSON:** Deberá salvaguardar un array de objetos (`[]`) con las siguientes propiedades críticas:
    *   `row_number` (`number`): Fila física referencial del Excel analizado (+ offset).
    *   `data` (`any` / `object`): El bloque bruto en bruto de la fila rechazada proporcionado por SheetJS.
    *   `errors` (`string[]`): Lista agregada de excepciones falladas correspondientes dictaminadas por el engine (Zod).

## 3. Plan de Implementación (Para el @operador)
1. **Creación de Migración SQL (`20260304180000_sprint2_inventory_quarantine.sql`)**:
   Aplicar explícitamente una instrucción `ALTER TABLE public.inventory_imports ADD COLUMN IF NOT EXISTS quarantine_data JSONB;` 
2. Ningún update histórico es necesario, al estar Nullable, los lotes de auditorías previos se portarán intactos e inofensivos.

## 4. Reglas de Negocio a Futuro (Para el @programador)
*   En el código `useInventoryImport`, la variable temporal que captura los errores del "catch" de Zod (actualmente `validationErrors` mapeados a String) deberá evolucionar hacia un arreglo multidimensional. 
*   Ese arreglo deberá empatar la estructura JSONB estipulada y, finalmente, incluirse en el Payload de la inserción de estado hacia `.from('inventory_imports')` usando a la propiedad *quarantine_data*.
