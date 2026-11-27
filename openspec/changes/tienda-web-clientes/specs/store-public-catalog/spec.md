# Store Public Catalog Specification (F1)

## Purpose

Catálogo público vía RPCs anon, seguro, agrupado, sin exponer datos internos.

## Requirements

### Requirement: Solo tenants habilitados

`store_list_products` y `store_get_product` MUST devolver datos únicamente de tenants con `store_enabled=true`, validado en servidor.

#### Scenario: Tenant habilitado
- GIVEN tenant con `store_enabled=true`
- WHEN anon llama `store_list_products`
- THEN recibe sus productos

#### Scenario: Tenant no habilitado
- GIVEN tenant con `store_enabled=false` o inexistente
- WHEN anon llama el RPC con ese tenant
- THEN recibe lista vacía o error y ningún dato

### Requirement: Solo columnas seguras

La respuesta MUST incluir únicamente: nombre, calibre, calidad, precio, imagen, estado de disponibilidad. MUST NOT incluir stock exacto, costos, proveedor, lotes ni IDs internos de lote.

#### Scenario: Payload mínimo
- GIVEN producto con costo y stock 37
- WHEN anon lo consulta
- THEN el JSON no contiene `cost`, `stock`, lote ni proveedor
- AND solo expone `Disponible` o `Agotado`

#### Scenario: Acceso directo a tablas
- GIVEN un anon
- WHEN hace `select` directo sobre `products`/`inventory_lots`
- THEN RLS devuelve 0 filas

### Requirement: Agrupación y disponibilidad

Los productos MUST agruparse por nombre+calibre+calidad. El estado MUST ser `Disponible` si el stock agregado > 0, si no `Agotado`. Productos inactivos MUST NOT aparecer.

#### Scenario: Agrupación
- GIVEN dos lotes del mismo nombre+calibre+calidad
- WHEN anon lista el catálogo
- THEN aparece una sola tarjeta

#### Scenario: Agotado
- GIVEN un grupo con stock total 0
- WHEN anon lo lista
- THEN aparece con estado `Agotado`

#### Scenario: Producto inactivo
- GIVEN un producto inactivo
- WHEN anon lista
- THEN no aparece

#### Scenario: Detalle inexistente
- GIVEN un id que no pertenece al tenant habilitado
- WHEN anon llama `store_get_product`
- THEN no obtiene datos
