# Diseño de Arquitectura: Motor Seguro de Invitaciones (Edge Function)

## 1. Visión General
Este documento define la arquitectura, contrato de datos y flujo de seguridad para la Edge Function `invite-employee`. Esta función permite a los Administradores invitar a nuevos empleados (Vendedores o Supervisores) de su misma empresa (Tenant) directamente enviándoles un correo de invitación a través del Backend de Supabase.

Siguiendo el diseño Multi-Tenant definido en `tech-stack.md`, el Frontend no creará al usuario directamente ni manipulará IDs de inquilinos. Toda la validación de pertenencia e inyección en tablas recaerá sobre código seguro en Edge Functions.

## 2. Contrato de Datos (API)

**Endpoint:** `POST /functions/v1/invite-employee`

### Request (Frontend -> Edge Function)
El cliente llamante debe proveer su propio token JWT emitido por Supabase Auth en el header `Authorization`.

**Headers requeridos:**
- `Content-Type: application/json`
- `Authorization: Bearer <Admin_JWT>`

**Payload (Body):**
```json
{
  "email": "nuevo.vendedor@ejemplo.com",
  "full_name": "Juan Pérez",
  "phone": "+503 70001234",
  "role": "vendedor" 
}
```
*(Nota: El rol deberá validarse contra una lista permitida, ej. 'vendedor', 'supervisor').*

### Response (Edge Function -> Frontend)

**Éxito (200 OK):**
```json
{
  "success": true,
  "message": "Invitación enviada correctamente",
  "user_id": "uuid-del-nuevo-usuario"
}
```

**Errores Esperados (400 / 401 / 403 / 500):**
```json
{
  "error": "CódigoDeError",
  "message": "Descripción amigable del error."
}
```

## 3. Flujo Lógico y de Seguridad (Implementación Backend)

El `@programador` que implemente la función de Deno/TypeScript en Supabase deberá seguir estrictamente esta secuencia atómica:

1. **Extracción y Validación de Identidad (Admin):**
   - Recibir la petición HTTP.
   - Extraer el JWT del header `Authorization`.
   - Inicializar el cliente regular de Supabase con el token del cliente o directamente verificarlo.
   - Extraer el `user_id` de quien realiza la petición.

2. **Descubrimiento Seguro del Tenant y Validación de Rol:**
   - Usar el `user_id` del solicitante para consultar la tabla pública `user_profiles`.
   - Recuperar su `tenant_id` y su `role`.
   - **Criterio de Rechazo:** Si el usuario que llama NO tiene permisos (ej. no es Administrador o Gerente), abortar con `403 Forbidden`.

3. **Invocación de Auth Admin (Creación y Envío de Correo):**
   - Inicializar un **Segundo Cliente de Supabase** usando la variable de entorno `SUPABASE_SERVICE_ROLE_KEY`. *Estrictamente necesario para brincar reglas RLS y poder crear usuarios de Auth nativos.*
   - Llamar al método `supabaseAdmin.auth.admin.inviteUserByEmail(email)`.
   - Capturar el `id` del usuario recién creado/invitado del objeto retornado.

4. **Inyección Controlada del Perfil Público (Multi-tenant):**
   - Usando el mismo cliente `supabaseAdmin` (Service Role), insertar atómicamente un nuevo registro en `public.user_profiles`:
     ```sql
     INSERT INTO public.user_profiles (id, tenant_id, full_name, phone, role)
     VALUES (<nuevo_user_id>, <tenant_id_del_admin>, <full_name>, <phone>, <role>);
     ```
   - **Critica Arquitectónica:** Al forzar el uso de `<tenant_id_del_admin>`, el Backend garantiza que es criptográficamente imposible que un inquilino malicioso intercepte la red y envíe una carga útil (payload) intentando inyectar un usuario en otra compañía.

5. **Resolución:**
   - Devolver HTTP 200 al Frontend indicando éxito.

## 4. Notas para el @programador (Frontend)
El UI responsable de esta pantalla (ej. `InviteEmployeeView.tsx`) no necesita saber cómo funciona el Backend, simplemente recabará los 4 datos del formulario, mostrará su respectivo estado de `loading...` en el botón y consumirá el endpoint enviando la cabecera `Authorization`. Manejará el aviso en verde al recibir código 200, y rojo en cualquier otro caso.
