# Base de Operaciones y Entornos - ImporFrut

Este documento establece la base de operaciones para el entorno local y en la nube del proyecto ImporFrut, detallando la estrategia de control de versiones y el manejo de entornos en Supabase.

---

## 1. Estrategia Git (Contenido para `docs/internal/git-conventions.md`)

```markdown
# Convenciones de Git - ImporFrut

El proyecto utiliza un flujo de trabajo basado en entornos que separa la versión estable del desarrollo iterativo, estructurado de la siguiente manera:

- **`main` (Producción)**: 
  Rama principal e históricamente estable. Contiene únicamente el código que está desplegado en producción y validado. No se programa directamente sobre ella bajo ninguna circunstancia.

- **`develop` (Staging / Sandbox)**: 
  Es la rama principal de integración. Todo el código nuevo llega aquí para ser probado en un entorno de desarrollo (staging) aislado antes de pasar a producción.

- **Prefijo `feature/`**: 
  Utilizado para organizar el desarrollo de nuevas tareas y funcionalidades.
  - **Origen**: Se crean siempre a partir de `develop`.
  - **Integración**: Una vez completadas, se integran nuevamente hacia `develop` mediante un Pull Request (PR).
  - *Ejemplo*: `feature/procesamiento-excel`, `feature/perfil-vendedor`

- **Prefijo `fix/`**: 
  Utilizado para aislar la resolución de errores o bugs reportados. 
  - **Origen**: Se crean a partir de `develop` (para bugs habituales del sandbox) o a partir de `main` (si es un hotfix urgente en producción).
  - **Integración**: Se integran hacia la rama de la cual salieron a través de un PR.
  - *Ejemplo*: `fix/error-calculo-inventario`, `fix/ui-bloqueo-boton`
```

---

## 2. Comandos Locales (Inicialización)

Ya que tienes tu repositorio inicializado y la rama `main` lista, aquí tienes la secuencia exacta de comandos de terminal para crear y posicionarte en tu rama de desarrollo:

```bash
# 1. Asegurarte de estar posicionado en la rama main
git checkout main

# 2. Crear una nueva rama llamada 'develop' a partir de main, y saltar inmediatamente a ella
git checkout -b develop

# 3. Validar visualmente que ahora te encuentras operando en 'develop'
git status
```
*Con estos pasos ejecutados, tu entorno local estará en la rama correcta para que puedas empezar a codificar con tranquilidad y sin afectar la base `main`.*

---

## 3. Entornos de Supabase

### Estrategia de Separación de Datos (Desarrollo vs Producción)
Siguiendo las mejores prácticas para aplicaciones que manejarán datos del mundo real, la estrategia consistirá en **crear dos proyectos separados** dentro de la misma organización en tu panel de Supabase:

1. **Proyecto de Desarrollo (ej. `imporfrut-dev`)**: 
   - Estará vinculado a los despliegues de tu rama `develop`. 
   - Su base de datos, sistema de autenticación (Auth) y almacenamiento (Storage) se utilizarán para hacer pruebas con datos ficticios e iterar en los esquemas sin miedo a romper cosas. 
   - Las variables de entorno en local (`.env.local`) apuntarán obligatoriamente a las credenciales de este proyecto.

2. **Proyecto de Producción (ej. `imporfrut-prod`)**: 
   - Estará reservado única y exclusivamente para los despliegues generados desde la rama `main`. 
   - Nadie deberá alterar sus registros manualmente, ni usar sus variables de entorno localmente.

Esta estricta separación garantiza que los datos productivos (inventario y métricas) nunca colisionarán ni sufrirán daños por una manipulación accidental durante una sesión de *vibe coding*.

### Región Geográfica Recomendada: El Salvador
Al crear tus proyectos de Supabase, la opción que te proporcionará la menor latencia (ping) desde El Salvador para la mayor parte de conexiones en el país es:

**US East (N. Virginia)** o equivalente (`us-east-1` en terminología estándar de AWS).

**Justificación:** El enrutamiento principal de los cables de fibra óptica e ISPs de Centroamérica (Claro, Tigo, etc.) tiene un recorrido muy directo hacia los nodos de interconexión ubicados en la costa este estadounidense (alrededor de Florida y subiendo a Virginia). Alojar los servidores de Supabase en "N. Virginia" usualmente brinda las respuestas más rápidas y de menor latencia para aplicaciones B2B de transacciones en la región centroamericana.
