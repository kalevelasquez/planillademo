# Configuración de MCP para el IDE - ImporFrut

Para que los agentes de IA (Arquitecto, Programador, Operador) puedan leer el esquema de la base de datos y ayudarte mejor en el desarrollo, debes configurar el **MCP (Model Context Protocol)** de PostgreSQL en tu IDE.

## Paso 1: Obtener la Cadena de Conexión (URI) de Supabase

1. Entra a tu Dashboard de Supabase.
2. Ve a **Project Settings** (el icono de engranaje abajo a la izquierda).
3. Selecciona **Database**.
4. Busca la sección **Connection string**.
5. Asegúrate de que esté seleccionada la pestaña **URI**.
6. **Importante:** Necesitarás la URI que usa el puerto `5432` o el modo de conexión directa.
7. La cadena tendrá un formato similar a este:
   `postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres`

## Paso 2: Configuración en el IDE

1. Abre la configuración de MCP en tu IDE (cursor o editor compatible).
2. Agrega una nueva configuración de tipo `PostgreSQL`.
3. Pega la URI que copiaste de Supabase.
4. Asegúrate de reemplazar `[YOUR-PASSWORD]` con la contraseña real que configuraste al crear el proyecto.

## Paso 3: Entornos Separados

Recuerda que si estás trabajando en la rama `develop`, debes usar la URI del proyecto de **Desarrollo/Staging**. Cuando pases a Producción, deberás cambiarla (o tener una configuración separada) por la del proyecto principal de **Producción**.

A partir de que configures esto, podremos usar la herramienta `mcp_supabase-mcp-server_execute_sql` para validar que el esquema que estamos diseñando sea consistente con la realidad de tu base de datos.
