# Product Images Specification (F1)

## Purpose

Imagen opcional por producto, subida desde Inventario y servida desde bucket público.

## Requirements

### Requirement: Columna y bucket

`products.image_url` MUST ser nullable. El bucket `product_images` MUST ser de lectura pública; la escritura MUST limitarse a usuarios internos del tenant con permiso de inventario.

#### Scenario: Lectura pública
- GIVEN una imagen subida
- WHEN anon abre su URL pública
- THEN se sirve

#### Scenario: Escritura no autorizada
- GIVEN un cliente de tienda o anon
- WHEN intenta subir al bucket
- THEN es rechazado

#### Scenario: Escritura cross-tenant
- GIVEN un vendedor del tenant A
- WHEN intenta subir bajo la ruta del tenant B
- THEN es rechazado

### Requirement: Upload desde Inventario

El formulario de producto MUST permitir subir una imagen (tipos y tamaño limitados) y guardar `image_url`. SHOULD mostrar placeholder si no hay imagen.

#### Scenario: Subir imagen válida
- GIVEN un usuario con permiso edita un producto
- WHEN selecciona un JPG/PNG/WebP dentro del límite
- THEN se sube y `image_url` se guarda

#### Scenario: Archivo inválido
- GIVEN un archivo no imagen o sobre el límite
- WHEN intenta subirlo
- THEN se rechaza con mensaje i18n (es/en) y no cambia `image_url`

#### Scenario: Producto sin imagen
- GIVEN `image_url` NULL
- WHEN se muestra en el catálogo
- THEN se renderiza un placeholder
