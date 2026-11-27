# Store Customer Accounts Specification (F2)

## Purpose

Registro, login y consulta de pedidos propios para clientes de la tienda, vinculados a `customers`.

## Requirements

### Requirement: Registro con confirmación de email

El registro MUST requerir confirmación de email. El tenant MUST resolverse en servidor. El hook de captcha MUST existir pero estar desactivado en v1.

#### Scenario: Registro exitoso
- GIVEN un visitante con email válido
- WHEN se registra en `/cuenta`
- THEN se crea el usuario pendiente de confirmación y un `customers` con `auth_user_id`

#### Scenario: Sin confirmar
- GIVEN un usuario sin confirmar email
- WHEN intenta crear un pedido
- THEN no tiene sesión válida y el RPC lo rechaza

#### Scenario: Email duplicado
- GIVEN un email ya registrado
- WHEN se registra de nuevo
- THEN no se crea un segundo `customers` y no se filtra si el email existe

### Requirement: Vínculo y privacidad en customers

`customers.auth_user_id` MUST ser único por tenant. Un cliente MUST leer solo su propio `customers` y sus propias órdenes. MUST NOT acceder a otros clientes ni a tablas admin.

#### Scenario: Ver solo lo propio
- GIVEN clientes X e Y con pedidos
- WHEN X consulta `orders`
- THEN solo ve los suyos

#### Scenario: Acceso a otro cliente
- GIVEN el cliente X autenticado
- WHEN consulta `customers` de Y
- THEN 0 filas

#### Scenario: Cliente existente del admin
- GIVEN un `customers` interno con el mismo email, sin `auth_user_id`
- WHEN se registra ese email
- THEN [DECISIÓN DE DISEÑO] se vincula o se crea uno nuevo, sin exponer datos del existente; documentar en design

### Requirement: Mis pedidos

`/cuenta` MUST listar los pedidos del cliente con estado (Pending, Approved, rechazado/cancelado) y total.

#### Scenario: Lista de pedidos
- GIVEN un cliente con 2 pedidos web
- WHEN abre `/cuenta`
- THEN ve ambos con su estado

#### Scenario: Sesión requerida
- GIVEN un visitante anon
- WHEN abre `/cuenta/pedidos`
- THEN ve el login de tienda, no el admin

### Requirement: Login y logout de tienda

Login/logout MUST usar el cliente de tienda y MUST NOT afectar la sesión admin.

#### Scenario: Logout aislado
- GIVEN sesión admin y de tienda abiertas
- WHEN el cliente cierra sesión
- THEN la sesión admin permanece
