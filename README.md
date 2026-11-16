# Teknergy - ImporFrut FrontEnd

Solución frontend moderna para la gestión de pedidos y clientes de ImporFrut, construida con React 19 y Supabase.

## 🚀 Inicio Rápido

1. **Instalar dependencias**:
   ```bash
   npm install
   ```

2. **Configurar variables de entorno**:
   Crea un archivo `.env` en la raíz con las siguientes variables:
   ```env
   VITE_SUPABASE_URL=tu_url_de_supabase
   VITE_SUPABASE_ANON_KEY=tu_clave_anon_de_supabase
   ```

3. **Ejecutar servidor de desarrollo**:
   ```bash
   npm run dev
   ```

## 🌍 Internacionalización (i18n)

El proyecto utiliza `i18next` para gestionar múltiples idiomas de forma centralizada.

### Cómo añadir un nuevo idioma:
1. Crea una nueva carpeta en `public/locales/` con el código del idioma (ej: `public/locales/en/`).
2. Copia el archivo `common.json` de la carpeta `es/` a la nueva carpeta.
3. Traduce los valores del JSON manteniendo las mismas llaves.
4. (Opcional) Registra el idioma en `src/config/i18n.ts` si deseas forzarlo o cambiar el orden de detección.

## 📚 Documentación

Para una guía detallada sobre las funcionalidades del sistema, consulta:
- [Manual de Usuario](docs/user-manual.md): Flujos de trabajo para vendedores y administradores.

## 🛠 Configuración del Proyecto

Todos los parámetros de negocio y límites del sistema se encuentran centralizados en:
- `src/config/index.ts`: Ajustes como el prefijo de pedidos, límites de descuento y flags de características.

## 🧪 Stack Tecnológico

- **Framework:** React 19 + Vite
- **Lenguaje:** TypeScript
- **Estado:** Zustand
- **Estilos:** Tailwind CSS v4
- **Base de Datos & Auth:** Supabase
- **Internacionalización:** react-i18next
