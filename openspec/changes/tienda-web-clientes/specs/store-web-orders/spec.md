# Store Web Orders Specification (F2)

## Purpose

Carrito local y creación segura de pedidos web `Pending` (pago contra entrega) con `store_create_order`.

## Requirements

### Requirement: Carrito local

El carrito MUST vivir en el cliente (persistido localmente) y MUST NOT ser fuente de verdad de precios.

#### Scenario: Agregar y recalcular
- GIVEN un carrito vacío
- WHEN el usuario agrega 2 unidades de un producto Disponible
- THEN el carrito muestra 2 ítems y total estimado

#### Scenario: Producto Agotado
- GIVEN un producto `Agotado`
- WHEN intenta agregarlo
- THEN la UI lo impide

### Requirement: Identidad derivada del servidor

`store_create_order` MUST requerir usuario autenticado y MUST derivar tenant y cliente de `auth.uid()`. MUST ignorar cualquier tenant/cliente/seller enviados en el payload.

#### Scenario: Anon rechazado
- GIVEN un anon
- WHEN llama `store_create_order`
- THEN error de autorización

#### Scenario: Tenant falsificado
- GIVEN un payload con `tenant_id` de otro tenant
- WHEN se ejecuta
- THEN la orden se crea con el tenant derivado de `auth.uid()` (o se rechaza)

#### Scenario: Cliente falsificado
- GIVEN un payload con `customer_id` ajeno
- WHEN se ejecuta
- THEN la orden se asocia al cliente de `auth.uid()`

#### Scenario: Tienda deshabilitada
- GIVEN el tenant con `store_enabled=false`
- WHEN un cliente llama el RPC
- THEN se rechaza sin crear orden

### Requirement: Precio y lote recalculados

El RPC MUST recalcular precios desde `products.price` ignorando precios del cliente, y MUST usar el lote activo más antiguo. MUST NOT descontar stock en Pending.

#### Scenario: Precio manipulado
- GIVEN payload con `price: 0.01` para un producto de 10.00
- WHEN se crea el pedido
- THEN el ítem y el total usan 10.00

#### Scenario: Lote más antiguo
- GIVEN dos lotes activos con distinta antigüedad
- WHEN se crea el pedido
- THEN el ítem referencia el lote más antiguo

#### Scenario: Stock sin descuento
- GIVEN stock 10 y pedido de 3
- WHEN se crea Pending
- THEN el stock sigue en 10

### Requirement: Estado y origen

La orden MUST crearse con `status='Pending'`, `origin='web'`, `seller_id=NULL` y numeración `PED-` compartida con pedidos internos.

#### Scenario: Orden creada
- GIVEN un pedido válido
- WHEN se crea
- THEN existe con Pending, origin web, seller NULL y número `PED-` consecutivo

#### Scenario: Pedido interno intacto
- GIVEN un vendedor crea un pedido interno
- WHEN se guarda
- THEN `origin='interno'` y su `seller_id` es el vendedor

### Requirement: Validación de entrada y límites

El RPC MUST rechazar: carrito vacío, cantidad <= 0 o no entera, cantidad sobre el máximo por ítem, más ítems que el máximo, productos duplicados, productos inexistentes/inactivos/de otro tenant, y exceso del límite de pedidos Pending por cliente.

#### Scenario: Carrito vacío
- GIVEN `items=[]`
- WHEN se llama
- THEN error y sin orden

#### Scenario: Cantidad inválida
- GIVEN cantidad 0, -1 o 1.5
- WHEN se llama
- THEN error y sin orden

#### Scenario: Cantidad sobre el límite
- GIVEN cantidad mayor al máximo configurado
- WHEN se llama
- THEN error y sin orden

#### Scenario: Demasiados ítems
- GIVEN más ítems que el máximo
- WHEN se llama
- THEN error y sin orden

#### Scenario: Producto de otro tenant
- GIVEN un `product_id` de otro tenant
- WHEN se llama
- THEN error y sin orden

#### Scenario: Spam de pendientes
- GIVEN un cliente en el límite de Pending
- WHEN crea otro
- THEN se rechaza

### Requirement: Pedido sin stock suficiente visible

Si el producto está Agotado al crear, el RPC MUST rechazarlo. Si hay stock insuficiente para la cantidad, MAY permitirse (la validación definitiva ocurre al aprobar).

#### Scenario: Agotado en servidor
- GIVEN un producto con stock 0
- WHEN se incluye en el pedido
- THEN error y sin orden
