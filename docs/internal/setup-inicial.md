# Documentación de Setup Inicial - ImporFrut
*Teknergy Inc. - Febrero 2026*

## El Problema del "Huevo y la Gallina" en el Entorno Multi-Tenant

Durante el desarrollo del Sprint 1, nos encontramos con un desafío arquitectónico crítico al implementar la seguridad de base de datos (**Row Level Security - RLS**) junto con la lógica de negocio Multi-Tenant.

### 1. El Bloqueo del Tenant (El Huevo)
Nuestra política RLS para la tabla `tenants` es restrictiva: protege la creación de nuevos tenants para evitar que cualquier usuario anónimo cree organizaciones a voluntad. 
* **Fallo**: El frontend intentaba crear un Tenant usando el cliente anónimo de Supabase.
* **Resultado**: `403 Forbidden`. No puedes crear un tenant si no eres admin, pero no puedes ser admin si no tienes un tenant asignado.

### 2. La Creación del Usuario (La Gallina)
Para que un usuario sea válido en ImporFrut, debe existir en:
1. `auth.users` (Manejado por Supabase Auth/GoTrue).
2. `public.user_profiles` (Nuestra tabla de negocio).

### 3. La Solución: Enfoque Híbrido

Para romper este ciclo, hemos establecido el siguiente procedimiento de inicialización para entornos nuevos (Staging/Local):

#### A. Inyección de Infraestructura (Vía Operador/SQL)
El primer Tenant (**ImporFrut Central**) debe inyectarse directamente en la base de datos utilizando privilegios de superusuario (`service_role` o vía MCP). Esto salta las políticas RLS.
* **ID Generado**: `0710bc7d-13e1-4b77-9549-fd5953596c0d`

#### B. Registro de Identidad (Vía Frontend)
El primer Usuario Administrador se crea a través del método `signUp` de la librería de Supabase en el frontend.
* **Razón**: Es vital que el registro pase por el servidor de Auth de Supabase para que la contraseña se encriptre correctamente (`bcrypt`) y, lo más importante, para que se dispare el **Trigger de PostgreSQL** (`on_auth_user_created`) que inserta automáticamente el perfil del usuario con su `tenant_id` y `role` en la tabla `user_profiles`.

## Conclusión
Este flujo híbrido garantiza que el sistema nazca seguro desde el "segundo cero", respetando el aislamiento Multi-Tenant sin sacrificar la integridad de las contraseñas ni la automatización de perfiles.
