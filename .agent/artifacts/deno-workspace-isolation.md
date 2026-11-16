# Plan de Aislamiento de Workspace (Frontend vs Edge Functions)

## 1. El Problema (Colisión de Contextos TypeScript)
El proyecto contiene dos ecosistemas distintos dentro del mismo repositorio:
- **La Raíz: `Teknergy.ImporFrut.FrontEnd/`**: Funciona bajo Node.js para las herramientas de compilación (Vite) y su código base objetivo es el **DOM del Navegador** (Librería DOM en tsconfig).
- **El Backend: `supabase/functions/`**: Supabase Edge Functions se ejecuta bajo **Deno**, un runtime moderno que no reconoce variables globales de Node.js, utiliza URLs para importaciones y proporciona su propio namespace global `Deno`.

La falta de aislamiento provoca que editores como VS Code muestren falsos positivos (warnings rojos) como: `Cannot find name 'Deno'` al intentar programar la función `invite-employee`.

## 2. Plan Arquitectónico de Solución
El objetivo es instruir al Language Server (TypeScript) para que asuma reglas de Deno **únicamente** para los archivos contenidos dentro de `supabase/functions/`.

### 2.1 Archivo de Aislamiento (`deno.json`)
He dictaminado crear un archivo centralizador de configuración de Deno en la raíz de las funciones:

**Ruta:** `supabase/functions/deno.json`

**Contenido Obligatorio:**
```json
{
  "compilerOptions": {
    "allowJs": true,
    "lib": ["deno.window"],
    "strict": true
  },
  "lint": {
    "rules": {
      "tags": ["recommended"]
    }
  },
  "fmt": {
    "useTabs": false,
    "lineWidth": 80,
    "indentWidth": 2,
    "semiColons": true,
    "singleQuote": true,
    "proseWrap": "preserve"
  }
}
```

*Configuraciones Clave Explicadas para el @programador:*
- `"lib": ["deno.window"]`: Permite al editor saber que el objeto global `Deno` existe y tiene tipados estáticos aquí. No incluir `"dom"` para evitar contaminación.

### 2.2 Instrucciones de Herramientas para Carlos (El Editor)
Para que el archivo `deno.json` tenga efecto inmediato en el IntelliSense de Visual Studio Code:
1. Carlos debe tener instalada la Extensión Oficial: **Deno (`denoland.vscode-deno`)**.
2. Al existir un archivo `deno.json` en esa carpeta específica, la extensión habilita automáticamente el soporte de tipado de Deno para la ruta, coexistiendo limpiamente con el `tsconfig.json` de React para el resto del proyecto.

### 3. Siguientes Pasos (Para el @programador)
El contexto de desarrollo ya no marcará conflicto. El `@programador` ahora puede importar librerías mediante ESM URLs `npm:xxxxx` o `jsr:@xxxx` y estructurar limpiamente la Edge Function `invite-employee` utilizando todo el poder del tipado del namespace `Deno`.
