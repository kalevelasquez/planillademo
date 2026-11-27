# Auth Claims Hardening Specification (F0)

> Actualizado 2026-11-27: el fallback de transición ya no lee `user_metadata`; consulta `public.user_profiles` por `auth.uid()` (fallback B). Se elimina la espera de ≥1 h "por seguridad" (la migración 0d queda como limpieza).

## Purpose

Las claims de autorización (tenant y roles) solo se leen de `app_metadata` (no editable por el usuario). El signup queda seguro y distingue invitación interna de registro de tienda.

## Requirements

### Requirement: Claims solo desde app_metadata

`get_auth_tenant_id()` y `get_auth_roles()` MUST leer de `auth.jwt()->'app_metadata'`. MUST NOT leer `user_metadata` en ningún caso. Si `app_metadata` no trae la claim, MAY consultar `public.user_profiles` por `auth.uid()` (fallback de transición); `get_auth_roles()` MUST devolver un arreglo vacío (nunca `'vendedor'`) cuando no encuentra rol.

#### Scenario: Escalada de roles vía updateUser
- GIVEN un cliente autenticado sin roles en `app_metadata`
- WHEN ejecuta `updateUser({data:{roles:['admin']}})` y refresca el JWT
- THEN `get_auth_roles()` NO incluye `admin`
- AND una query admin sobre `orders` devuelve 0 filas / error de RLS

#### Scenario: Escalada de tenant vía updateUser
- GIVEN un usuario del tenant A
- WHEN ejecuta `updateUser({data:{tenant_id:'<tenant B>'}})` y refresca el JWT
- THEN `get_auth_tenant_id()` sigue devolviendo A
- AND no puede leer datos del tenant B

#### Scenario: Usuario interno legítimo
- GIVEN un usuario con `app_metadata.tenant_id` y `roles=['vendedor']`
- WHEN consulta sus datos
- THEN RLS devuelve los datos de su tenant según sus permisos

### Requirement: Backfill y transición

Una migración MUST copiar `tenant_id` y `roles` de `user_profiles` a `app_metadata` de cada usuario interno existente. Durante la transición, el fallback SHALL consultar `user_profiles` (funciones `SECURITY DEFINER` con `search_path` fijo, para no recursar en RLS) únicamente cuando `app_metadata` no tenga la claim; MUST poder removerse en una migración posterior de limpieza (0d). Un guard `BEFORE UPDATE` MUST impedir que un usuario final cambie su propio `role`, `tenant_id`, `is_active` o `status` en `user_profiles`; `service_role` y los contextos sin JWT de usuario no se ven afectados.

#### Scenario: Backfill de usuario existente
- GIVEN un usuario con fila en `user_profiles` y claims solo en `user_metadata`
- WHEN corre el backfill
- THEN `app_metadata` contiene su `tenant_id` y `roles` de `user_profiles`

#### Scenario: Fallback a user_profiles con app_metadata vacío
- GIVEN un usuario interno sin claims en `app_metadata` (token anterior al backfill) y con fila en `user_profiles`
- WHEN se evalúa `get_auth_tenant_id()` / `get_auth_roles()`
- THEN devuelven el `tenant_id` y los roles de `user_profiles`
- AND los valores de `user_metadata` se ignoran

#### Scenario: user_metadata nunca da tenant ni roles
- GIVEN un usuario sin claims en `app_metadata`, sin fila en `user_profiles` y con `user_metadata={tenant_id:'<B>', roles:['admin']}`
- WHEN se evalúa `get_auth_tenant_id()` / `get_auth_roles()`
- THEN devuelven NULL y un arreglo vacío

#### Scenario: Usuario no puede autoescalarse en user_profiles
- GIVEN un usuario interno autenticado (sin `service_role`)
- WHEN ejecuta `UPDATE user_profiles SET role = ... / tenant_id = ... / is_active = ... / status = ...` sobre su propia fila
- THEN la operación falla (guard) y la fila no cambia
- AND editar una columna no privilegiada (p. ej. `phone`) sigue permitido

#### Scenario: app_metadata prevalece sobre user_metadata
- GIVEN `app_metadata.tenant_id=A` y `user_metadata.tenant_id=B`
- WHEN se evalúa `get_auth_tenant_id()`
- THEN devuelve A

#### Scenario: Usuario de tienda sin claims
- GIVEN un cliente de tienda sin claims en `app_metadata` y sin fila en `user_profiles`
- WHEN se evalúa `get_auth_tenant_id()`
- THEN devuelve NULL y no accede a tablas admin

### Requirement: Edge functions escriben app_metadata

`manage-users` e `invite-employee` MUST escribir `tenant_id` y `roles` en `app_metadata` al crear/actualizar usuarios internos, y MUST seguir creando la fila en `user_profiles`.

#### Scenario: Invitar empleado
- GIVEN un admin invita a un empleado con rol `vendedor`
- WHEN la función completa
- THEN el usuario tiene `app_metadata.roles=['vendedor']` y `tenant_id` del admin
- AND existe su fila en `user_profiles`

#### Scenario: Cambio de rol
- GIVEN un empleado existente
- WHEN `manage-users` cambia su rol
- THEN `app_metadata.roles` refleja el nuevo rol

### Requirement: handle_new_user seguro y ramificado

`handle_new_user` MUST ignorar `roles` y `tenant_id` provenientes de `raw_user_meta_data` del cliente. Un alta por invitación interna (validada contra `staff_invitations` por email + nonce secreto, escrita por el servidor) MUST crear `user_profiles` con los datos de la invitación. Un signup de tienda MUST crear/vincular un `customers` (tenant resuelto en servidor, `auth_user_id`) y MUST NOT crear `user_profiles`. Un error interno MUST NOT bloquear el alta del usuario.

#### Scenario: Signup de tienda
- GIVEN un visitante se registra desde la tienda
- WHEN se inserta en `auth.users`
- THEN se crea un `customers` con `auth_user_id` y el tenant de la tienda habilitada
- AND no existe fila en `user_profiles`

#### Scenario: Signup malicioso con metadata
- GIVEN un signup con `data:{roles:['admin'],tenant_id:'<otro>'}`
- WHEN se procesa
- THEN el usuario no obtiene roles ni tenant; el `customers` usa el tenant resuelto en servidor

#### Scenario: Invitación interna
- GIVEN `invite-employee` crea un usuario
- WHEN se inserta en `auth.users`
- THEN se crea `user_profiles` con el tenant y rol del invitador

#### Scenario: Fallo interno del trigger
- GIVEN el insert en `customers` falla
- WHEN se registra el usuario
- THEN el alta en `auth.users` se completa (bloque EXCEPTION)
