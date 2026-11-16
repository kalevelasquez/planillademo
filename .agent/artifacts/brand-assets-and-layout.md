# Gestión de Recursos de Marca y Estandarización de Interfaz

## 1. Gestión de Assets (Archivos Estáticos y Recursos)

En una arquitectura con Vite y React, existen dos rutas principales para albergar imágenes y fuentes. Para mantener el repositorio ordenado y optimizar los tiempos de carga de la PWA, se establece la siguiente directiva estricta para el manejo de recursos gráficos:

### 1.1 El Directorio `/public/`
Este directorio está destinado **exclusivamente** para archivos estáticos que no requieren procesamiento por parte del empaquetador (Vite). Estos archivos se copian tal cual a la carpeta de distribución (`dist/`) manteniéndose en la raíz del dominio web.

*   **Regla para el Programador:**
    *   **Favicon y Metadatos PWA:** El ícono de la pestaña del navegador (`favicon.ico`) y el logo base de Vite deben ser sobrescritos aquí.
    *   Renombrar o reemplazar `/public/vite.svg` con el logo isotipo oficial de ImporFrut.
    *   Cualquier manifiesto `manifest.json` para la PWA irá aquí.

### 1.2 El Directorio `/src/assets/`
Este directorio está destinado a los gráficos, íconos o imágenes que son importados directamente dentro del código TypeScript/React (ej. `import logo from '../assets/logo-imporfrut.svg'`). Vite procesa, comprime y agrega *hashes* (versiones únicas) a estos archivos, optimizando su cache en producción.

*   **Regla para el Programador:**
    *   **Logos de la Interfaz:** El logo principal (isotipo + texto), fondos de autenticación (`login-bg.png`) o ilustraciones en el Dashboard deben ubicarse **estrictamente** dentro de `/src/assets/images/`.
    *   Nunca usar rutas absolutas al logo dentro de los componentes. Siempre usar la directiva estricta en TypeScript:
        ```tsx
        import BrandLogo from '@/assets/images/logo-imporfrut.svg';
        <img src={BrandLogo} alt="Logo ImporFrut" />
        ```

---

## 2. Estandarización de Contenedores de Interfaz (Layout)

Debido al escalado fluido del Design System hasta desktop con resoluciones anchas (UltraWide, 4K), permitir que el contenido en vistas como Dashboard o el Catálogo abarque el `100vw` degrada gravemente la usabilidad (el usuario debe mover el cuello o ratón excesivamente).

### 2.1 El Contenedor Maestro Estándar (Master Wrapper)

Para forzar la estructura de ancho máximo y centralización, todas las vistas o *Pages* de nivel superior (aquellas renderizadas por el Router) **DEBEN** envolver su contenido semántico (`<main>`) en la siguiente combinación estándar de clases utilitarias de Tailwind:

```css
max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8
```

*   `max-w-7xl` (1280px): Fija un tope de ancho muy elegante para monitores modernos.
*   `mx-auto`: Centra el contenedor completo en medio de la pantalla (espacio muerto equilibrado a la izquierda y derecha).
*   `w-full`: Fuerza que ocupe todo el espacio en pantallas más pequeñas que `1280px`.
*   `px-4 sm:px-6 lg:px-8`: Agrega un *padding* interno de cortesía que crece conforme se ensancha el monitor para evitar que los elementos visuales choquen contra el borde del cristal.

### 2.2 Requisito de Implementación (@programador)
Esta clase **debe inyectarse de inmediato** en las vistas contenedoras, tales como:
1.  `DashboardView.tsx`
2.  `CustomersView.tsx` (Lista de clientes).
3.  `InventoryView.tsx` / Catálogo.

**Ejemplo Analítico del Layout PWA:**
```tsx
export const DashboardView = () => {
  return (
    <div className="min-h-screen bg-app-surface pb-20 md:pb-0"> 
       <HeaderComponent />
       {/* CONTENEDOR MAESTRO DE IMPORFRUT */}
       <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
          <SectionResumen />
          <SectionAccesosDirectos />
       </main>
    </div>
  )
}
```

Implementar esta convención visual es una máxima prioridad para entregar la sensación de "App Premium B2B" discutida en el archivo de contexto general.
