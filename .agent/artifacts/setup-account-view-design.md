# Diseño de Arquitectura: Flujo de Onboarding (SetupAccountView)

## 1. Diagrama de Arquitectura (Interacciones de Componentes)

```text
[ SetupAccountView.tsx ] (UI React Component)
       |
       |-- (Estado: loading / disabled para evitar doble clic)
       |-- (Validación Local: Zod / React Hook Form o validación manual)
       |
       v
[ Supabase Auth API ] 
       |-- Paso 1: supabase.auth.updateUser({ password })
       |-- (Atómico: Si falla aquí, se aborta y se muestra error al usuario)
       |
       v
[ Supabase Database API ] 
       |-- Paso 2: supabase.from('user_profiles').update({ full_name, phone }).eq('id', session.user.id)
       |-- (Atómico: Si falla aquí, se notifica que la contraseña se guardó, pero el perfil requiere reintento)
       |
       v
[ Router / Navegación ]
       |-- Paso 3: Redirigir a vista principal o Dashboard tras éxito completo.
```

## 2. Modelo de Datos y Tipos TypeScript

Se requiere declarar o utilizar el tipo de datos necesario para interactuar con la tabla pública `user_profiles`.

```typescript
// En src/types/database.ts (o similar)
export interface UserProfileUpdate {
  full_name: string;
  phone: string; // Formato esperado: "+503 XXXXXXXX"
  updated_at?: string; // (Opcional) Si la base de datos lo requiere 
}
```

**Nota sobre Base de Datos:** 
El registro en `user_profiles` ya existe (ya que el usuario fue pre-registrado y tiene un `auth.uid()`). La base de datos asume estrictamente políticas RLS. La sentencia SQL subyacente que el frontend invocará se traduce en:
`UPDATE public.user_profiles SET full_name = ?, phone = ? WHERE id = auth.uid();`

## 3. Plan de Implementación (Para el @programador)

**Tarea 1: Construcción de la Interfaz (UI)**
- Crear el componente `/src/features/auth/SetupAccountView.tsx` (o en la carpeta que corresponda a las vistas vistas).
- Implementar un formulario basado en el **Design System** (Inputs con border-radius 8px, padding 10px 14px, focus con ring `#02B446`).
- **Campos del Formulario:**
  1. `Nombre Completo` (Texto).
  2. `Teléfono` (Texto/Tel, requerido validar que comience con `+503` y tenga 8 dígitos después).
  3. `Nueva Contraseña` (Password).
- **Control de Estado:** Crear un estado `isLoading` que bloquee el botón primario de submit al ser presionado, mostrando el texto "Guardando...".

**Tarea 2: Lógica de Autenticación y Flujo (Contrato Atómico)**
- Importar la instancia configurada de Supabase (`supabase`).
- En la función `onSubmit`:
  1. Ejecutar `const { data: authData, error: authError } = await supabase.auth.updateUser({ password: nuevaPassword });`
  2. Verificar `authError`. Si falla, liberar `isLoading` y pintar el string del error (Ej. "La contraseña es muy débil"). **ABORTAR FLUJO**.
  3. Ejecutar la actualización del perfil:
     ```typescript
     const { error: profileError } = await supabase
       .from('user_profiles')
       .update({ full_name: nombreCompleto, phone: telefono })
       .eq('id', authData.user.id);
     ```
  4. Verificar `profileError`. Si falla, mostrar un advertencia: *"Tu contraseña fue actualizada, pero hubo un error al guardar tu perfil. Intenta de nuevo."* y permitir reintentar solo el envío (o ignorar la clave la siguiente vez). **Opcional/Recomendado:** Controlar banderas booleanas si ya pasó la clave para no re-enviarla.
  5. Si código llega al final exitosamente: limpiar `isLoading` y dirigir a `/` usando `useNavigate` o similar.

**Tarea 3: Manejo de Sesión (Importante)**
- Como el caso de uso empieza de un link `type=invite`, la sesión activa (`supabase.auth.getSession()`) ya debió resolverse y la URL debió limpiarse por Supabase PKCE.
- Requerir que este componente `SetupAccountView.tsx` solo se renderice si existe un `session` válido. De no haber sesión, redirigir a `/login`.
