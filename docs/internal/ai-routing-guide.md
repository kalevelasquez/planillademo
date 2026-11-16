# Guía de Enrutamiento de Modelos IA (Vibe Coding)

**Regla de Oro:** Paga por pensar, ahorra en teclear. No delegues arquitectura a modelos rápidos, ni pagues modelos caros por escribir un botón.

### 🧠 Modelos de Razonamiento (High / Thinking)
* **Uso:** Diseño, lógica compleja, configuración crítica y análisis de requerimientos.
* **Modelos:** Gemini 3 Pro, Claude 3.5 Sonnet / 3.7 Thinking, o equivalentes "Pro".
* **Agentes Asignados:**
  - `@arquitecto`: Diseño de base de datos (Supabase), arquitectura Clean, revisión crítica.
  - `@gerente`: Análisis de historias de usuario, definición de UX/UI y flujos.
  - `@operador`: Configuración de variables de entorno, seguridad (RLS) y despliegues.

### ⚡️ Modelos de Ejecución (Flash / Fast)
* **Uso:** Generación masiva de código basado estrictamente en planos ya definidos. Velocidad pura.
* **Modelos:** Gemini 3 Flash, Claude 3.5 Haiku, o equivalentes "Flash/Mini".
* **Agentes Asignados:**
  - `@programador`: Escribir componentes React, maquetar con Tailwind, seguir el Artifact del arquitecto.
  - `@tester`: Pruebas de linting, validación de UI y búsqueda de bugs de sintaxis.