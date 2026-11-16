# Arquitectura Técnica: Módulo de Gestión de Equipo (Team Management) y Flujo de Invitaciones

## 1. Análisis del Problema
El sistema actual presenta una falla crítica de resiliencia en el flujo de invitaciones a empleados. Cuando una invitación expira o un usuario no la acepta, la Edge Function falla con un error `422` (`email_exists`) al intentar re-invitarlo. Adicionalmente, el frontend carece de visibilidad sobre el estado real de la invitación de los empleados en su Tenant, y la vista actual es un placeholder.
Esta arquitectura define el patrón **Delete-then-Invite** para garantizar idempotencia en la Edge Function, establece una sincronización Event-Driven entre `auth.users` y `public.profiles` para exponer el estado de manera segura y define la estructura de componentes seguros para la UI.

## 2. Estrategia de Datos y Sincronización (Backend)

**Decisión Arquitectónica:** Sincronización de estado mediante **Trigger de Postgres**.
**Justificación:** Exponer la columna `email_confirmed_at` en el frontend a través de una función RPC (Security Definer) añadiría latencia innecesaria en listados y no permitiría aprovechar las suscripciones Realtime (si fuesen necesarias en un futuro). Al replicar el estado en `public.profiles`, mantenemos las lecturas desde el frontend eficientes y directas bajo RLS `tenant_id`.

**Implementación del Modelo de Datos:**
1.  **Nueva Columna en `public.profiles`:**
    *   Agregar columna `status` (tipo `text` o `varchar`, con valores `'PENDING'` | `'ACTIVE'`).
    *   Valor por defecto: `'PENDING'`.

2.  **Trigger Sincronizador en `auth.users`:**
    *   Crear una función `sync_user_status()` ejecutada por un trigger `AFTER UPDATE ON auth.users FOR EACH ROW`.
    *   **Lógica del Trigger:**
        ```sql
        IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
            UPDATE public.profiles
            SET status = 'ACTIVE'
            WHERE id = NEW.id;
        END IF;
        ```
    *   Esto garantiza que tan pronto el empleado hace clic en el enlace de invitación de Supabase, su perfil pase a estar activo en la UI automáticamente.

## 3. Lógica Resiliente de la Edge Function (`invite-employee`)

La Edge Function debe operar con **Supabase Admin Client (Service Role Key)** para poder evaluar cuentas y borrarlas en el Auth. Debe implementar el patrón **"Delete-then-Invite"**.

### Reglas de Negocio en Edge Function:
1.  **Validación de Autorización (RBAC):** Verificar que el usuario que invoca tenga el rol `ADMIN` (leyendo su perfil).
2.  **Intento de Invitación:** Llamar a `supabaseAdmin.auth.admin.inviteUserByEmail({ email })`.
3.  **Captura y Resolución de Errores (Idempotencia):**
    *   Si retorna éxito: Continuar e insertar/vincular el registro en `public.profiles`.
    *   Si falla con `422` (`email_exists` / `User already registered`):
        1.  Listar/buscar el usuario por email: `supabaseAdmin.auth.admin.listUsers()`.
        2.  Extraer `email_confirmed_at` del usuario encontrado.
        3.  **Evaluación:**
            *   Si `email_confirmed_at IS NOT NULL`: Retornar HTTP 400 con mensaje "El usuario ya se encuentra activo en el sistema".
            *   Si `email_confirmed_at IS NULL`: (Invitación enviada previamente pero no aceptada).
                *   Ejecutar `supabaseAdmin.auth.admin.deleteUser(user.id)`. (Asegurarse que la clave foránea en `public.profiles` tenga `ON DELETE CASCADE` para limpiar el perfil pendiente viejo).
                *   Re-ejecutar `supabaseAdmin.auth.admin.inviteUserByEmail({ email })`.
                *   Insertar el nuevo perfil (con el nuevo `id`) en `public.profiles` asignando el `tenant_id` y el estado `'PENDING'`.

## 4. Diseño de Componentes UI (TeamView)

Ubicación del Componente Principal: `/features/team/TeamManagementView.tsx` (o similar).

**Directivas de Contención (Resiliencia UI):**
El layout contenedor debe aplicar `w-full max-w-[100vw] overflow-x-clip min-w-0` obligatoriamente según *tech-stack.md*.

### Árbol de Componentes
*   `<TeamManagementView>` (Contenedor que maneja la obtención de datos y estados de red)
    *   `<TeamHeader>` (Contiene Título y botón "Invitar Empleado")
        *   *Regla RBAC:* El botón "Invitar Empleado" solo se renderiza si `currentUser.role === 'ADMIN'`.
    *   `<TeamList>` (Tabla abstracta listando a los empleados)
        *   `<TeamMemberRow>`
            *   `Columna Nombre/Email`
            *   `Columna Rol` (Con badge de color)
            *   `<StatusBadge>` (Evalúa `profile.status`: 'PENDING' -> Amarillo/Gris, 'ACTIVE' -> Verde)
            *   `<ActionsMenu>` (Botones: Eliminar, Cambiar Rol). Solo visible si `currentUser.role === 'ADMIN'`.

### Prevención de Errores UX
*   **Bloqueo de UI:** Al oprimir "Enviar Invitación" en el modal, el botón de guardado (Save) debe pasar inmediatamente a `isLoading = true` o `disabled = true` bloqueando múltiples peticiones.
*   **Feedback:** Si la petición falla, se muestra un Toast o Alert con el mensaje de error procesado (ej. "Usuario ya activo"), nunca debe cerrarse el listado ni colapsar la aplicación. La lista detrás debe persistir.

## 5. Plan de Implementación (Para el @programador)

1.  **Paso 1: Modificación de Base de Datos (Migración SQL)**
    *   Añadir columna `status VARCHAR` a `public.profiles` con default `'PENDING'`.
    *   Crear el Trigger y la Función en PostgreSQL (`sync_user_status`) que actualice `public.profiles.status = 'ACTIVE'` cuando `auth.users.email_confirmed_at` cambie de `NULL` a un timestamp válido.
    *   *(Crucial)*: Confirmar que la FK de `public.profiles.id` hacia `auth.users.id` tenga `ON DELETE CASCADE`.

2.  **Paso 2: Refactor de la Edge Function (`invite-employee`)**
    *   Actualizar Deno code de la Deno Edge Function para incluir el `deleteUser` logrando la lógica *"Delete-then-Invite"*.
    *   Asegurar que se devuelven los códigos HTTP correctos (`400` para ya activo, `200` para éxito).

3.  **Paso 3: Desarrollo de UI - Componentes Base**
    *   Crear el `StatusBadge` reutilizable si no existe.
    *   Crear la estructura de la tabla/grid para `<TeamList>` utilizando los tokens del design system.

4.  **Paso 4: Integración y RBAC**
    *   Conectar `TeamManagementView` al `profileService` para extraer los empleados del mismo `tenant_id`.
    *   Implementar la lógica RBAC ocultando el botón o menú de acciones si el usuario logueado en estado NO es ADMIN.

5.  **Paso 5: Pruebas Locales**
    *   Simular una vista paralela, enviar un invite y ver a la vez el estado pendiente. Abrir enlace, verificar que pase a 'Active' (Trigger working). Re-intentar invitar a alguien en estado pendiente -> verificar que re-emita la invitacion.
