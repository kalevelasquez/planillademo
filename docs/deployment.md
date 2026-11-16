# Guía de Despliegue - ImporFrut B2B

## Infraestructura
El proyecto se despliega en una arquitectura de **JAMStack** (Javascript, APIs, Markup):
- **Frontend**: [Vercel](https://vercel.com) (o Netlify/Vite static host).
- **Backend / DB / Auth**: [Supabase](https://supabase.com).

## Configuración de Entorno (.env)
Se deben configurar las siguientes variables de entorno para que el proyecto conecte con la instancia de Supabase:

```bash
# Obligatorias
VITE_SUPABASE_URL=https://[TU_PROYECTO].supabase.co
VITE_SUPABASE_ANON_KEY=[TU_ANON_KEY]

# Opcionales (desarrollo)
VITE_DEBUG_MODE=true
```

## Pasos para Despliegue (CI/CD)
1. **Conectar Repositorio**: En Vercel, añade el proyecto seleccionando el repositorio de GitHub/GitLab.
2. **Framework**: Selecciona "Vite" o "Direct" (Vercel detecta Vite automáticamente).
3. **Variables**: Pega los valores de `.env` en la sección "Environment Variables" de Vercel.
4. **Build Tool**: Asegúrate de que el comando de construcción sea `npm run build`.
5. **Directorio Output**: El directorio de salida es `dist/`.

## Base de Datos (Supabase)
1. **Ejecutar Migraciones**: Se deben correr secuencialmente los scripts SQL en `supabase/migrations/` en el SQL Editor de Supabase.
2. **RLS Policies**: Verificar que las políticas RLS estén activas (especialmente el aislamiento de `tenant_id`).
3. **Storage**: Crear un bucket público llamado `orders_pdf` para que el visor de PDF funcione.

## Dominios y SSL
Vercel y Supabase proporcionan SSL automático (HTTPS). Se recomienda configurar un dominio personalizado (ej. `app.imporfrut.com`) desde el panel de control de Vercel.
