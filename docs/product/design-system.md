# ImporFrut - Design System v1.0
**Sistema de Toma de Pedidos**
**Guía visual para desarrollo y prototipado**
*Teknergy Inc. — Febrero 2026 — Versión 1.0*

---

## 1. Paleta de Colores
Todos los colores del sistema fueron extraídos del logo oficial de ImporFrut. El verde `#02B446` del swoosh es el color dominante. Cada fruta del logo aporta un color funcional al sistema: la manzana roja para errores, las uvas púrpura para acentos, y la naranja para alertas.

### 1.1 Colores de Marca (del Logo)
| Color | Nombre | RGB | Uso en la App |
| :--- | :--- | :--- | :--- |
| `#02B446` | Verde Principal | 2, 180, 70 | Color primario. Botones principales, navegación activa, indicadores de éxito, swoosh del logo. |
| `#028A36` | Verde Oscuro | 2, 138, 54 | Headers, énfasis, hover en botones verdes, barra superior de la app. |
| `#E6F7EC` | Verde Claro | 230, 247, 236 | Fondos de selección, filas activas en catálogo, backgrounds suaves de éxito. |
| `#172C6B` | Azul Marino | 23, 44, 107 | Texto del logo. Usar para headings principales y elementos que transmitan autoridad. |

### 1.2 Colores de Acento (de las Frutas del Logo)
| Color | Nombre | RGB | Uso en la App |
| :--- | :--- | :--- | :--- |
| `#FC1C27` | Rojo Manzana | 252, 28, 39 | 🍎 Errores, alertas críticas, badges de Cancelado, acciones destructivas. |
| `#952B97` | Púrpura Uva | 149, 43, 151 | 🍇 Acento secundario. Badges de lista de precio Mayoreo, diferenciadores. |
| `#FCAA18` | Naranja Cítrico | 252, 170, 24 | 🍊 Alertas/warnings, badges Pendiente, indicadores que requieren atención. |
| `#1976D2` | Azul Info | 25, 118, 210 | 🔵 Badges de En Proceso/Aprobado, enlaces informativos, lista de precio Cliente. |

### 1.3 Colores Neutros
| Color | Nombre | RGB | Uso en la App |
| :--- | :--- | :--- | :--- |
| `#1A1A2E` | Texto Principal | 26, 26, 46 | Cuerpo de texto, títulos. Derivado del azul marino del logo para cohesión. |
| `#5A5A7A` | Texto Secundario | 90, 90, 122 | Subtítulos, labels, texto de apoyo, metadata, captions. |
| `#E0E0E0` | Borde | 224, 224, 224 | Bordes de inputs, divisores, separadores de tabla. |
| `#F5F5F5` | Superficie | 245, 245, 245 | Fondos alternados en tablas, cards secundarias, fondos de sección. |
| `#FFFFFF` | Fondo | 255, 255, 255 | Fondo principal de la app, cards primarias, modales. |

### 1.4 Colores de Estado (Badges)
Cada estado del flujo de pedidos tiene un color asignado que se usa en badges, indicadores y filtros.
* **Pedidos:** Borrador (`#9E9E9E`), Pendiente (`#FCAA18`), Aprobado (`#1976D2`), Entregado (`#02B446`), Cancelado (`#FC1C27`).
* **Lista de Precios:** Empleado (`#02B446`), Cliente (`#1976D2`), Mayoreo (`#952B97`).

---

## 2. Tipografía
* **Fuente principal:** DM Sans (Google Fonts) o system font stack como fallback.
* **Fuente monospace:** JetBrains Mono para precios, números de pedido y códigos.
* **Fuente cuerpo/UI:** Inter.

### 2.1 Escala Tipográfica
| Nivel | Tamaño | Peso | Ejemplo |
| :--- | :--- | :--- | :--- |
| H1 — Título de Página | 24px | 700 | Nuevo Pedido |
| H2 — Título de Sección | 20px | 700 | Cítricos y Frutas |
| H3 — Subtítulo | 16px | 600 | Tienda Don Pedro |
| Body — Texto base | 14px | 400 | Mandarina Clementina 12 UN |
| Caption — Texto auxiliar | 12px | 400 | Último pedido: hace 3 días |
| Overline — Labels | 11px | 600 | CANTIDAD DISPONIBLE |

### 2.2 Fuente Monospace
Usar JetBrains Mono o monospace del sistema para datos numéricos y códigos:
* **Número de pedido:** PED-20260212-0047 (JetBrains Mono, 14px, semibold)
* **Precio unitario:** $4.50 (JetBrains Mono, 16px, bold)
* **Total del pedido:** $1,245.00 (JetBrains Mono, 20px, bold)

---

## 3. Componentes UI

### 3.1 Botones
Todos los botones usan `border-radius: 10px`, `font-weight: 600`, `font-family: Inter`.

| Tipo | Background | Texto | Borde | Uso |
| :--- | :--- | :--- | :--- | :--- |
| Primary | `#02B446` | `#FFFFFF` | none | Confirmar Pedido, Guardar, Crear |
| Secondary | transparent | `#02B446` | 1.5px `#02B446` | Ver Resumen, Volver, Cancelar |
| Danger | `#FC1C27` | `#FFFFFF` | none | Cancelar Pedido, Eliminar |

### 3.2 Inputs y Formularios
Propiedades comunes: `border-radius: 8px`, `padding: 10px 14px`, `font-size: 14px`, `font-family: Inter`.

* **Normal:** Borde 1px solid `#E0E0E0`, Fondo `#FFFFFF`
* **Focus:** Borde 2px solid `#02B446` (ring Tailwind)

### 3.3 Navegación
* **Bottom Nav (mobile):** Tabs inferiores estáticos.
* **Sidebar (desktop):** 256px ancho (`w-64`), fondo `#FFFFFF`. Item activo: border-left 4px `#02B446`, fondo `#E6F7EC`.

---

## 4. Espaciado y Breakpoints
* **Base:** 8px.
* **Breakpoints:** Mobile (Default), Tablet (`md: 768px`), Desktop (`lg: 1024px`).
* **Border radius:** Cards (`12px`), Inputs (`8px`), Botones (`10px`).
* **Iconografía:** Material Symbols Outlined.