# Actualización de Arquitectura: Catálogo y Sincronización Excel (V2)

## 1. Análisis de Brecha (Gap Analysis) en la Base de Datos
Al revisar la migración `20260221000000_init_schema.sql`, he detectado dos discrepancias críticas que violan el diseño propuesto y las reglas de arquitectura del proyecto:

1. **Falta de Identificador Único:** La tabla `products` no posee la columna `sku`, por lo que hacer el `UPSERT` planteado en la versión inicial es imposible a nivel de base de datos.
2. **Falta de Normalización (Categorías):** El campo `category` en `products` es actualmente un campo libre de texto (`TEXT`). Según las reglas fundamentales de arquitectura (Regla #3: Exigir el uso estricto de llaves foráneas), esto abre la puerta a inconsistencias tipográficas (ej. "Cítricos" vs "Citricos"). 

## 2. Nuevo Modelo de Datos (Esquema SQL Requerido)

Se debe generar una nueva migración (ej. `20260224000000_normalize_catalog.sql`) que implemente la siguiente estructura estricta:

```sql
-- 1. Crear tabla de categorías con aislamiento Multi-Tenant
CREATE TABLE IF NOT EXISTS product_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, name) -- Evita categorías duplicadas por inquilino
);

ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "categories_tenant_isolation" ON product_categories
    FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid()))
    WITH CHECK (tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid()));

-- 2. Modificar la Tabla Products
-- Agregamos sku y cambiamos category de TEXT a UUID como Llave Foránea
ALTER TABLE products ADD COLUMN sku TEXT;

-- Llenar temporalmente los SKUs de productos existentes (si los hay) con un hash
UPDATE products SET sku = id::text WHERE sku IS NULL;

-- Ahora aseguramos el constraint
ALTER TABLE products ALTER COLUMN sku SET NOT NULL;
ALTER TABLE products ADD CONSTRAINT products_tenant_sku_key UNIQUE (tenant_id, sku);

-- Migrar la columna category (TEXT -> FK UUID)
-- Para no perder datos, primero creamos la columna nueva
ALTER TABLE products ADD COLUMN category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL;

-- (Opcional) Si hubiese datos, aquí iría un bloque DO para migrar las categorías de texto a la tabla y asignar el UUID. Como asumimos que estamos en etapas tempranas, podemos dropear la columna vieja.
ALTER TABLE products DROP COLUMN category;
```

## 3. Plan de Implementación (Flujo del Frontend para el Excel)

Dado que ahora contamos con un modelo fuertemente tipado e íntegro (Foreign Keys), el algoritmo del `@programador` en el motor de sincronización (`SheetJS`) debe mutar a un flujo de **Doble Upsert Secuencial**:

### Paso 1: Upsert de Categorías
1. El frontend recabará todos los strings únicos de la columna `categoria` del Excel.
2. Insertará/Ignorará en bloque hacia la tabla `product_categories` usando UPSERT con `onConflict: 'tenant_id, name'`.
3. El frontend descargará (haciendo un `SELECT id, name`) el diccionario completo de categorías para este tenant.

### Paso 2: Asociación y Upsert de Productos
1. El frontend iterará las filas del Excel, y por cada producto buscará en el diccionario descargado cuál es el `category_id` que corresponde a su texto `categoria`.
2. Se construirá el payload asegurando que se envía el `sku`, el `tenant_id` y el `category_id` (en vez del string).
3. Se ejecuta el `UPSERT` masivo hacia `products` con `onConflict: 'tenant_id, sku'`.

Con esta arquitectura, garantizamos una base de datos 100% íntegra, sin duplicados y preparada para analíticas futuras categorizadas.
