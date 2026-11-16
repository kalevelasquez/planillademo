# Contexto del Proyecto y Tech Stack: IMPORFRUT

## Visión General
- **Tipo de Aplicación:** PWA (Progressive Web App) optimizada para toma de pedidos móviles rápidos (B2B).
- **Metodología de Trabajo:** Vibe Coding. El código y la documentación deben ser legibles y modulares para facilitar la colaboración.

## Stack Tecnológico
- **Frontend:** React.js 18+ con Vite, TypeScript y Tailwind CSS (arquitectura de cliente pesado).
- **Backend / BaaS:** Supabase (PostgreSQL, Auth, Realtime, Storage, Edge Functions).
- **Librerías Clave:** SheetJS (xlsx) para el procesamiento de archivos Excel.
- **Optimización de Carga (Lazy Loading):**
  - Librerías pesadas (ej: generación de PDFs, gráficas, mapas) **TIENEN PROHIBIDO** importarse en el nivel superior (`top-level import`).
  - Deben usarse **Dynamic Imports** (`await import(...)`) dentro de la función que las requiere, asegurando un *bundle* inicial ligero.

## Arquitectura y Reglas de Código (Clean Architecture)
- **Separación de Responsabilidades (Services):** Los componentes visuales (`/ui`) **TIENEN ESTRICTAMENTE PROHIBIDO** hacer consultas directas a Supabase. Toda interacción con el backend debe pasar por una capa intermedia aislada (`/services`).
- **Patrón UI/Lógica (Smart Hooks & Dumb Components):**
  - Los archivos `.tsx` (Vistas) deben ser puramente declarativos. Su única responsabilidad es renderizar JSX y conectar eventos.
  - TODA la lógica de estado compleja, efectos (`useEffect`) y manejadores (`handlers`) debe extraerse a **Custom Hooks** dedicados (ej: `useCustomerManagement.ts`).
  - **Regla de Oro:** Si un componente tiene más de 3 `useState` o lógica asíncrona visible, debe refactorizarse inmediatamente.
- **Prevención de Errores Críticos (UI):** Todo botón de envío o mutación de datos debe implementar bloqueos de estado obligatorios (*loading* o *disabled*) durante las llamadas asíncronas.

## Estándares de Código (Clean Code - Obligatorio)
- **Cero "Magic Strings":**
  - Prohibido tener textos de UI ("Guardar", "Error", Títulos) hardcodeados en los componentes.
  - Todos los textos visibles deben importarse desde `src/config/ui-texts.ts` (u objeto equivalente centralizado).
- **Tipado Estricto (TypeScript):**
  - **Prohibido `any`:** Bajo ninguna circunstancia se permite el uso de `any`, especialmente en respuestas de servicios.
  - **DTOs:** Los servicios (`/services`) deben retornar interfaces tipadas, nunca objetos crudos.
  - **Manejo de Errores:** En los bloques `catch`, el error debe tratarse como `unknown` y validarse (ej: `if (error instanceof Error)`), nunca asumir propiedades implícitas.

## Seguridad y Base de Datos
- **Seguridad de Datos:** Las políticas RLS (Row Level Security) son obligatorias en todas las tablas.
- **Auditoría:** La tabla `audit_log` debe ser estrictamente de inserción (append-only).
- **Arquitectura Multi-Tenant:**
  - TODAS las tablas (excepto catálogos globales) deben incluir un campo `tenant_id` (UUID).
  - Las RLS deben garantizar aislamiento total por `tenant_id`.

## Convenciones de Repositorio (Git) y Entornos
- **Entornos y Ramas:**
  - `main` -> **Producción** (Base de datos productiva).
  - `develop` -> **Staging / Local** (Entorno de desarrollo).
- **Flujo de Trabajo:** Todo desarrollo viaja en ramas temporales (`feature/` o `fix/`) y se integra a `develop` mediante Pull Request.

## Reglas de Documentación (Artifacts)
- **Ubicación:** Todos los documentos, diagramas y planes generados por agentes (Artifacts) deben guardarse en `.agent/artifacts/`.
- **Idioma:** Español estricto para toda documentación, commits y razonamiento.

## UI / UX y Sistema de Diseño
- **Fuente de Verdad:** `docs/product/design-system.md`.
- **Tailwind CSS:** Prohibido inventar clases o valores arbitrarios. Usar tokens del sistema de diseño.
- **Layouts Blindados:** Contenedores principales deben usar `w-full max-w-[100vw] overflow-x-clip min-w-0` para evitar desbordamientos.

### 🛡️ Protocolos de Resiliencia y Estabilidad
1. **Manejo de Sesión Supabase (Anti-Deadlock):**
   - **Desfibrilador:** `supabaseClient.ts` debe escuchar `visibilitychange` y ejecutar `getSession()` al volver a la pestaña.
   - **Escudo de Red:** En `App.tsx`, ignorar eventos `TOKEN_REFRESHED` redundantes para evitar race conditions.
2. **Edge Functions (Idempotencia):**
   - Implementar patrón "Delete-then-Invite" para invitaciones repetidas. Manejo estricto de errores 422.

## 🛡️ Protocolo de Despliegue y CI/CD (ESTRICTO)
- **Base de Datos:** JAMÁS ejecutar SQL manual. Crear migraciones (`.sql`), commitear y esperar despliegue automático.
- **Edge Functions:** JAMÁS desplegar manual. Editar `.ts`, commitear y esperar despliegue automático.