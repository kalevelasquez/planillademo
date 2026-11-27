# Web Order Approval Specification (F3)

## Purpose

Bandeja de pedidos web, aprobación con validación de stock, descuento y avisos al equipo.

## Requirements

### Requirement: Visibilidad de Pending web

Los pedidos `origin='web'` y `status='Pending'` MUST ser visibles para el equipo del tenant con permiso de Pedidos, incluidos vendedores con scope `own`. MUST NOT serlo para otros tenants. Tras aprobar, aplican las reglas normales de scope con `seller_id` = aprobador.

#### Scenario: Vendedor own ve Pending web
- GIVEN un vendedor con scope `own`
- WHEN abre la bandeja de pedidos web
- THEN ve las órdenes web Pending con seller NULL de su tenant

#### Scenario: Vendedor own no ve pedidos ajenos
- GIVEN una orden interna de otro vendedor
- WHEN el vendedor lista Pedidos
- THEN no la ve

#### Scenario: Cross-tenant
- GIVEN una orden web Pending del tenant B
- WHEN un vendedor del tenant A consulta
- THEN no la ve

### Requirement: Aprobación

El RPC de aprobación MUST exigir permiso de aprobar pedidos, bloquear stock con `FOR UPDATE`, verificar stock suficiente, pasar la orden a `Approved` y asignar `seller_id=auth.uid()`. MUST rechazar si no hay stock suficiente, sin cambios parciales.

#### Scenario: Aprobación exitosa
- GIVEN orden web Pending con stock suficiente
- WHEN un vendedor autorizado aprueba
- THEN status `Approved` y `seller_id` es el aprobador

#### Scenario: Stock insuficiente
- GIVEN stock menor a la cantidad pedida
- WHEN se intenta aprobar
- THEN error, la orden sigue `Pending` y el stock no cambia

#### Scenario: Aprobaciones concurrentes
- GIVEN dos aprobaciones simultáneas con stock para una sola
- WHEN ambas ejecutan
- THEN solo una tiene éxito y el stock nunca queda negativo

#### Scenario: Doble aprobación
- GIVEN una orden ya `Approved`
- WHEN se aprueba otra vez
- THEN se rechaza y no se descuenta de nuevo

#### Scenario: Sin permiso
- GIVEN un usuario sin permiso de aprobar o un cliente de tienda
- WHEN llama el RPC
- THEN se rechaza

### Requirement: Descuento de stock en Pending→Approved

El trigger de stock MUST descontar al pasar `Pending→Approved`, y no duplicar descuentos de otras transiciones existentes.

#### Scenario: Descuento al aprobar
- GIVEN stock 10 y orden de 3
- WHEN pasa a Approved
- THEN el stock queda en 7

#### Scenario: Transición existente sin cambios
- GIVEN un flujo interno existente de cambio de estado
- WHEN se ejecuta
- THEN el descuento se comporta igual que antes

### Requirement: Rechazo / cancelación de pedido web

El equipo MUST poder rechazar una orden web Pending sin tocar stock; el cliente SHOULD ver el estado actualizado.

#### Scenario: Rechazar
- GIVEN orden web Pending
- WHEN un usuario autorizado la rechaza
- THEN pasa a estado rechazado/cancelado y el stock no cambia

### Requirement: Notificaciones al equipo

Al crearse una orden web, el sistema MUST insertar en `notificaciones` (tipo `pedido_web`) para los usuarios del tenant con permiso sobre Pedidos, y MUST NOT notificar a otros tenants. `NotificationBell` MUST enrutar el tipo `pedido_web` a la bandeja de pedidos web.

#### Scenario: Fan-out
- GIVEN 3 usuarios con permiso y 1 sin permiso en el tenant
- WHEN un cliente crea un pedido web
- THEN se crean 3 notificaciones `pedido_web`

#### Scenario: Aislamiento de tenant
- GIVEN usuarios en el tenant B
- WHEN se crea un pedido en el tenant A
- THEN B no recibe notificaciones

#### Scenario: Navegación de la campana
- GIVEN una notificación `pedido_web`
- WHEN el usuario la abre
- THEN navega a la bandeja de pedidos web; otros tipos mantienen su ruta actual
