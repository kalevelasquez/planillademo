# Sprint 1: Core, Login y Pedidos Básicos
*MVP ImporFrut — Documento de Alcance*

## Resumen Ejecutivo
Este documento define el alcance estricto del **Sprint 1** para el sistema ImporFrut. El objetivo principal es construir la **base técnica y de seguridad** (Infraestructura inicial, RLS y protección de comunicaciones) y el **flujo crítico de negocio horizontal**: desde que un vendedor inicia sesión de forma persistente, hasta que toma un pedido (seleccionando el cliente para aplicar sus precios específicos) y comparte el resumen por WhatsApp. Todo debe estructurarse bajo una filosofía mobile-first que garantice navegación rápida, gestos optimizados y feedback claro ante posibles errores.

---

## 1. Autenticación y Sesión (Login y Sesión)

### US-AUTH-01: Login con Email y Contraseña
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 3
> "Como vendedor, quiero iniciar sesión con mi email y contraseña desde mi teléfono, para acceder rápidamente al sistema y comenzar a tomar pedidos."

**Criterios de Aceptación:**
* CA1: La pantalla de login muestra el logo de ImporFrut, campos de email y contraseña, y botón de inicio de sesión.
* CA2: Al ingresar credenciales válidas, el usuario es redirigido a la pantalla principal según su rol.
* CA3: Al ingresar credenciales inválidas, se muestra mensaje de error claro en español sin revelar si el email existe.
* CA4: Tras 5 intentos fallidos consecutivos, la cuenta se bloquea por 15 minutos y se muestra un mensaje indicando el tiempo restante.
* CA5: La contraseña debe cumplir la política: mínimo 8 caracteres, una mayúscula, una minúscula, un número.

### US-AUTH-04: Recuperación de Contraseña
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 2
> "Como usuario del sistema, quiero recuperar mi contraseña vía email cuando la olvide, para volver a acceder al sistema sin depender del administrador."

**Criterios de Aceptación:**
* CA1: Existe un enlace "¿Olvidaste tu contraseña?" en la pantalla de login.
* CA2: Al ingresar un email registrado, se envía un correo con enlace de restablecimiento.
* CA3: El enlace expira después de 1 hora.
* CA4: La nueva contraseña debe cumplir la política de seguridad.
* CA5: Después de cambiar la contraseña, se invalidan todas las sesiones activas anteriores.

### US-AUTH-05: Sesión Persistente con Expiración por Rol
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 3
> "Como vendedor, quiero que mi sesión se mantenga activa durante mi jornada laboral sin tener que re-autenticarme constantemente, para no perder tiempo en login repetitivos mientras tomo pedidos."

**Criterios de Aceptación:**
* CA1: La sesión de vendedores expira después de 8 horas de inactividad.
* CA2: La sesión de administradores expira después de 2 horas de inactividad.
* CA3: Los tiempos de expiración son configurables desde la pantalla de configuración del sistema.
* CA4: Al expirar la sesión, se muestra un mensaje claro y se redirige al login.
* CA5: Los tokens JWT tienen expiración corta (15 min) con refresh automático transparente.

---

## 2. Toma de Pedidos y WhatsApp

### US-ORD-01: Selección de Cliente para Pedido
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 3
> "Como vendedor, quiero seleccionar un cliente antes de iniciar un pedido, para que el pedido quede asociado al cliente correcto y se muestren sus precios correspondientes."

**Criterios de Aceptación:**
* CA1: Al tocar "Nuevo Pedido", se muestra la lista de clientes asignados al vendedor.
* CA2: Puedo buscar clientes por nombre de negocio con filtrado instantáneo.
* CA3: Cada cliente muestra: nombre del negocio, contacto, tipo de precio asignado, fecha del último pedido.
* CA4: Al seleccionar un cliente, se carga automáticamente su lista de precios correspondiente.
* CA5: Existe un botón "+ Nuevo Cliente" para crear uno rápido sin salir del flujo.

### US-ORD-02: Catálogo de Productos en Pedido
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 5
> "Como vendedor, quiero ver el catálogo de productos con cantidad de inventario y agregar ítems rápidamente, para tomar el pedido en menos de 3 minutos mientras hablo por teléfono."

**Criterios de Aceptación:**
* CA1: Los productos se muestran agrupados por categoría en secciones colapsables.
* CA2: Las secciones recuerdan su estado (abierta/cerrada) entre sesiones.
* CA3: Cada producto muestra: nombre, calibre/marca, precio según lista del cliente, cantidad disponible en inventario.
* CA4: Cada producto tiene un stepper de cantidad (+/-) con touch targets de al menos 36px.
* CA5: Al agregar un producto (cantidad > 0), la fila se resalta con fondo verde claro.
* CA6: La búsqueda filtra productos por nombre en tiempo real.
* CA7: Agregar un producto toma menos de 3 segundos (tap en + una vez).
* CA8: Una barra flotante inferior muestra: número de ítems, subtotal, y botón "Ver Resumen".

### US-ORD-04: Resumen y Confirmación de Pedido
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 5
> "Como vendedor, quiero revisar el resumen completo del pedido antes de confirmarlo, para verificar que todo esté correcto antes de comprometerlo."

**Criterios de Aceptación:**
* CA1: La pantalla muestra: cliente, fecha, lista de productos con cantidad editable inline, precio unitario editable inline, y total por línea.
* CA2: Puedo eliminar una línea con botón (X).
* CA3: Se muestra subtotal, campo de descuento (% o monto fijo), y total final.
* CA4: Al confirmar, se genera automáticamente un número de pedido con formato PED-YYYYMMDD-NNNN.
* CA5: Antes de confirmar, se valida: al menos un producto con cantidad > 0, cliente seleccionado, y precios válidos.
* CA6: Si hay validaciones que fallan, se muestra alerta específica sin perder los datos ingresados.

### US-ORD-06: Compartir Pedido por WhatsApp
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 3
> "Como vendedor, quiero compartir el resumen del pedido por WhatsApp al cliente y a la persona de bodega, para confirmar el pedido al cliente y notificar a bodega para despacho."

**Criterios de Aceptación:**
* CA1: Después de confirmar, aparecen botones: "Enviar al Cliente" y "Enviar a Bodega".
* CA2: El mensaje incluye: número de pedido, nombre del cliente, lista de productos con cantidades y precios, y total.
* CA3: El botón abre wa.me con el número del cliente pre-cargado y el texto formateado.
* CA4: El botón de bodega permite seleccionar al despachador o ingresar número manualmente.
* CA5: El formato del mensaje es legible en WhatsApp (usa * para negritas, líneas separadoras).

### US-ORD-09: Precios Según Lista del Cliente
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 3
> "Como vendedor, quiero que los precios se muestren automáticamente según la lista asignada al cliente, para no tener que recordar qué precio aplica a cada cliente."

**Criterios de Aceptación:**
* CA1: Al seleccionar un cliente, los precios del catálogo se actualizan a su lista (Empleado, Cliente, Mayoreo).
* CA2: El tipo de lista se muestra como badge visible junto al nombre del cliente.
* CA3: Si un producto no tiene precio en la lista del cliente, se muestra indicador visual y alerta al confirmar.

---

## 3. Experiencia de Usuario (Navegación y Feedback)

### US-UX-01: Diseño Mobile-First y Navegación
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 5
> "Como vendedor, quiero una app optimizada para mi teléfono con navegación intuitiva, para usarla cómodamente con una mano mientras hablo por teléfono."

**Criterios de Aceptación:**
* CA1: Diseño mobile-first, optimizado para 360px+ con soporte para tablet y desktop.
* CA2: Navegación inferior con 4 tabs: Nuevo Pedido, Pedidos, Clientes, Inventario.
* CA3: Menú hamburguesa para opciones adicionales: Dashboard, Config, Auditoría, Perfil, Cerrar Sesión.
* CA4: Paleta corporativa: verde #4CAF50 primario, fondo blanco, cards con sombras sutiles.
* CA5: En desktop (1280px+): sidebar izquierdo reemplaza la navegación inferior.

### US-UX-02: Feedback Visual y Manejo de Errores
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 3
> "Como usuario del sistema, quiero recibir feedback visual claro para cada acción, para saber qué está pasando y no quedarme en duda."

**Criterios de Aceptación:**
* CA1: Acciones exitosas muestran toast notification verde.
* CA2: Acciones fallidas muestran toast notification rojo con mensaje accionable en español.
* CA3: Durante cargas, se muestran loading spinners o skeleton screens.
* CA4: Acciones destructivas (cancelar pedido, desactivar usuario) requieren confirmación explícita con modal.
* CA5: Las listas sin datos muestran empty state con ilustración y call-to-action.
* CA6: Nunca se muestran errores técnicos crudos (stack traces, códigos HTTP).

---

## 4. Seguridad (Seguridad y RLS)

### US-SEC-01: Seguridad de Comunicaciones y Headers
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 3
> "Como administrador del sistema, quiero que todas las comunicaciones sean seguras y el frontend tenga headers de protección, para prevenir ataques comunes como XSS, clickjacking, y man-in-the-middle."

**Criterios de Aceptación:**
* CA1: Toda comunicación es sobre HTTPS/TLS 1.2+. HTTP redirige automáticamente a HTTPS.
* CA2: Headers configurados: Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security.
* CA3: Protección CSRF en formularios y mutaciones.
* CA4: Las credenciales de Supabase (service_role key) nunca se exponen en el frontend. Solo se usa la anon key.
* CA5: Variables de entorno para todas las credenciales en todos los ambientes.

### US-SEC-02: Row Level Security (RLS)
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 5
> "Como administrador del sistema, quiero que todas las tablas tengan políticas RLS y validación de datos, para que ningún usuario pueda acceder a datos que no le corresponden."

**Criterios de Aceptación:**
* CA1: Todas las tablas de Supabase tienen RLS habilitado.
* CA2: Vendedores solo acceden a sus pedidos y clientes asignados.
* CA3: Supervisores acceden a los datos de su equipo.
* CA4: Administradores tienen acceso completo pero sus acciones se registran.
* CA5: Los inputs se sanitizan tanto en frontend como en backend para prevenir XSS e inyección SQL.
* CA6: Se validan datos en Edge Functions además del frontend.

### US-SEC-03: Rate Limiting y Seguridad de Auth
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 2
> "Como administrador del sistema, quiero limitar la tasa de requests en endpoints de autenticación, para prevenir ataques de fuerza bruta contra cuentas de usuarios."

**Criterios de Aceptación:**
* CA1: Los endpoints de login tienen rate limiting configurado.
* CA2: La política de contraseñas se aplica: mín. 8 chars, mayúscula, minúscula, número.
* CA3: Se valida contra lista de contraseñas comunes.

### US-SEC-04: Seguridad de Datos y Backups
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 3
> "Como administrador del sistema, quiero que los datos estén encriptados, respaldados, y que nunca se eliminen físicamente, para proteger la información del negocio y cumplir con buenas prácticas."

**Criterios de Aceptación:**
* CA1: Los datos en reposo están encriptados (manejo nativo de Supabase/PostgreSQL).
* CA2: Backups automáticos diarios con retención de 30 días configurados en Supabase Pro.
* CA3: Todas las entidades críticas usan soft delete (campo deleted_at en vez de DELETE físico).
* CA4: Ambientes de desarrollo y producción tienen datos completamente aislados.

---

## 5. Integraciones

### US-INT-01: Integración WhatsApp y Llamadas
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 2
> "Como vendedor, quiero contactar a mis clientes por WhatsApp o llamada directa desde la app, para comunicarme sin tener que buscar el número en otra app."

**Criterios de Aceptación:**
* CA1: Botón de WhatsApp en ficha de cliente abre wa.me con el número pre-cargado.
* CA2: Botón de llamada abre enlace tel: para iniciar llamada directa.
* CA3: Ambos botones funcionan en móvil y desktop.

---

## 6. Requerimientos No Funcionales

### US-NFR-01: Infraestructura y CI/CD
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 5
> "Como equipo de desarrollo, quiero un pipeline CI/CD configurado con ambientes separados, para entregar código con confianza y sin riesgo de dañar producción."

**Criterios de Aceptación:**
* CA1: Repositorio Git con branching strategy: main (prod), develop (staging), feature branches.
* CA2: Pull requests obligatorios con al menos 1 review.
* CA3: Pipeline: lint, tests, build automático en cada PR.
* CA4: Deploy automático a staging al mergear a develop. Deploy manual a producción al mergear a main.
* CA5: Ambientes dev (local), staging (Supabase branch), producción (Supabase Pro) completamente aislados.
* CA6: Disponibilidad objetivo: 99.5% uptime mensual.

---
*Flujo de Pantallas (Wireframe Textual) disponible en la documentación de UI/UX vinculada (Design System).*
