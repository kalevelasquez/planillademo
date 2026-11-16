# [cite_start]IMPORFRUT - Sistema de Toma de Pedidos [cite: 63, 64]
## [cite_start]Historias de Usuario [cite: 65]
[cite_start]**61 historias — 217 story points — 4 sprints** [cite: 66]
[cite_start]*Teknergy Inc. — Febrero 2026* [cite: 68]

[cite_start]Basado en documento de requerimientos v1.0 actualizado. [cite: 69] [cite_start]Excluye requerimientos de prioridad Baja (AUTH-10, INV-11, ORD-14, CLI-06, CLI-07, CLI-08, OBS-05, OBS-06, INT-05). [cite: 70]

---

### [cite_start]Resumen General [cite: 71]
[cite_start]Este documento contiene las historias de usuario derivadas del documento de requerimientos v1.0 actualizado de ImporFrut. [cite: 72] [cite_start]Se excluyen los 9 requerimientos de prioridad Baja, los cuales quedan documentados en el backlog para Fase 2. [cite: 73]

| Módulo | Historias | Puntos | Alta | Media | Sprint |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Autenticación y Usuarios | 7 | 22 | 5 | 2 | [cite_start]S1, S3, S4 [cite: 74] |
| Inventario | 5 | 23 | 3 | 2 | [cite_start]S2, S3 [cite: 74] |
| Toma de Pedidos | 9 | 30 | 7 | 2 | [cite_start]S1, S2 [cite: 74] |
| Clientes | 3 | 11 | 2 | 1 | [cite_start]S2, S3 [cite: 74] |
| Historial y Seguimiento | 5 | 18 | 4 | 1 | [cite_start]S2, S3 [cite: 74] |
| Reportes y Dashboard | 4 | 16 | 1 | 3 | [cite_start]S3 [cite: 74] |
| Roles y Permisos | 3 | 13 | 3 | 0 | [cite_start]S3 [cite: 74] |
| Seguridad | 6 | 17 | 5 | 1 | [cite_start]S1, S2, S4 [cite: 74] |
| Auditoría | 5 | 18 | 4 | 1 | [cite_start]S3 [cite: 74] |
| Observabilidad | 2 | 6 | 1 | 1 | [cite_start]S4 [cite: 74] |
| Rendimiento | 2 | 8 | 2 | 0 | [cite_start]S2, S4 [cite: 74] |
| UX | 4 | 14 | 2 | 2 | [cite_start]S1, S4 [cite: 74] |
| Integraciones | 3 | 8 | 2 | 1 | [cite_start]S1, S2, S4 [cite: 74] |
| No Funcionales | 3 | 13 | 2 | 1 | [cite_start]S1, S2, S4 [cite: 74] |
| **TOTAL** | **61** | **217** | **43** | **18** | [cite_start]**S1-S4** [cite: 74] |

* [cite_start]**Notas:** Los story points usan escala Fibonacci (1, 2, 3, 5, 8). [cite: 75] [cite_start]Cada historia incluye criterios de aceptación que sirven tanto para el developer como para el QA. [cite: 76] [cite_start]El badge de sprint indica en qué semana se planifica: S1 (verde), S2 (azul), S3 (morado), S4 (ámbar). [cite: 78]

---

## [cite_start]1. Autenticación y Usuarios [cite: 79]
### [cite_start]1.1 Login y Autenticación [cite: 80]

#### [cite_start]US-AUTH-01: Login con Email y Contraseña [cite: 81]
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 3 | [cite_start]**Reqs:** AUTH-01, AUTH-06, SEC-06 [cite: 81]
> [cite_start]"Como vendedor, quiero iniciar sesión con mi email y contraseña desde mi teléfono, para acceder rápidamente al sistema y comenzar a tomar pedidos." [cite: 81]

[cite_start]**Criterios de Aceptación:** [cite: 81]
* [cite_start]CA1: La pantalla de login muestra el logo de ImporFrut, campos de email y contraseña, y botón de inicio de sesión. [cite: 81]
* [cite_start]CA2: Al ingresar credenciales válidas, el usuario es redirigido a la pantalla principal según su rol. [cite: 81]
* [cite_start]CA3: Al ingresar credenciales inválidas, se muestra mensaje de error claro en español sin revelar si el email existe. [cite: 81]
* [cite_start]CA4: Tras 5 intentos fallidos consecutivos, la cuenta se bloquea por 15 minutos y se muestra un mensaje indicando el tiempo restante. [cite: 81]
* [cite_start]CA5: La contraseña debe cumplir la política: mínimo 8 caracteres, una mayúscula, una minúscula, un número. [cite: 81]

#### [cite_start]US-AUTH-04: Recuperación de Contraseña [cite: 82]
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 2 | [cite_start]**Reqs:** AUTH-04 [cite: 82]
> [cite_start]"Como usuario del sistema, quiero recuperar mi contraseña vía email cuando la olvide, para volver a acceder al sistema sin depender del administrador." [cite: 82]

[cite_start]**Criterios de Aceptación:** [cite: 82]
* [cite_start]CA1: Existe un enlace "¿Olvidaste tu contraseña?" en la pantalla de login. [cite: 82]
* [cite_start]CA2: Al ingresar un email registrado, se envía un correo con enlace de restablecimiento. [cite: 82]
* [cite_start]CA3: El enlace expira después de 1 hora. [cite: 82]
* [cite_start]CA4: La nueva contraseña debe cumplir la política de seguridad. [cite: 82]
* [cite_start]CA5: Después de cambiar la contraseña, se invalidan todas las sesiones activas anteriores. [cite: 82]

#### [cite_start]US-AUTH-05: Sesión Persistente con Expiración por Rol [cite: 83]
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 3 | [cite_start]**Reqs:** AUTH-05, SEC-07 [cite: 83]
> [cite_start]"Como vendedor, quiero que mi sesión se mantenga activa durante mi jornada laboral sin tener que re-autenticarme constantemente, para no perder tiempo en login repetitivos mientras tomo pedidos." [cite: 83]

[cite_start]**Criterios de Aceptación:** [cite: 83]
* [cite_start]CA1: La sesión de vendedores expira después de 8 horas de inactividad. [cite: 83]
* [cite_start]CA2: La sesión de administradores expira después de 2 horas de inactividad. [cite: 83]
* [cite_start]CA3: Los tiempos de expiración son configurables desde la pantalla de configuración del sistema. [cite: 83]
* [cite_start]CA4: Al expirar la sesión, se muestra un mensaje claro y se redirige al login. [cite: 83]
* [cite_start]CA5: Los tokens JWT tienen expiración corta (15 min) con refresh automático transparente. [cite: 83]

### [cite_start]1.2 Gestión de Usuarios y Perfil [cite: 84]

#### [cite_start]US-AUTH-06: Gestión de Usuarios [cite: 85]
* **Prioridad:** Alta | **Sprint:** S3 | **Puntos:** 5 | [cite_start]**Reqs:** AUTH-07, AUTH-09 [cite: 85]
> [cite_start]"Como administrador, quiero crear, editar y desactivar usuarios del sistema asignándoles roles, para controlar quién tiene acceso y con qué permisos." [cite: 85]

[cite_start]**Criterios de Aceptación:** [cite: 85]
* [cite_start]CA1: La pantalla lista todos los usuarios con: nombre, email, roles asignados, estado (activo/inactivo), último login. [cite: 85]
* [cite_start]CA2: Puedo crear un nuevo usuario con: nombre, email, teléfono, y asignación de uno o más roles. [cite: 85]
* [cite_start]CA3: Al crear un usuario, se genera una contraseña temporal y se envía invitación por email. [cite: 85]
* [cite_start]CA4: En el primer login, el usuario nuevo es forzado a cambiar su contraseña temporal. [cite: 85]
* [cite_start]CA5: Puedo desactivar un usuario (soft delete), lo que cierra sus sesiones activas inmediatamente. [cite: 85]
* [cite_start]CA6: No se puede eliminar físicamente un usuario, solo desactivar. [cite: 85]
* [cite_start]CA7: Solo usuarios con rol Administrador pueden acceder a esta pantalla. [cite: 85]

#### [cite_start]US-AUTH-07: Perfil de Usuario [cite: 86]
* **Prioridad:** Media | **Sprint:** S4 | **Puntos:** 2 | [cite_start]**Reqs:** AUTH-08 [cite: 86]
> [cite_start]"Como usuario del sistema, quiero ver y editar mi perfil personal (nombre, foto, teléfono), para mantener mi información actualizada y personalizar mi experiencia." [cite: 86]

[cite_start]**Criterios de Aceptación:** [cite: 86]
* [cite_start]CA1: Accesible desde el menú hamburguesa o el avatar en la barra superior. [cite: 86]
* [cite_start]CA2: Puedo editar: nombre completo, foto de perfil (opcional), y número de teléfono. [cite: 86]
* [cite_start]CA3: El email es de solo lectura (no editable por el usuario). [cite: 86]
* [cite_start]CA4: Los roles asignados se muestran pero no son editables. [cite: 86]
* [cite_start]CA5: Incluye botón para cambiar contraseña y ver estado de MFA. [cite: 86]

---

## [cite_start]2. Gestión de Inventario [cite: 87]
### [cite_start]2.1 Carga y Versionado [cite: 88]

#### [cite_start]US-INV-01: Carga de Inventario desde Excel [cite: 89]
* **Prioridad:** Alta | **Sprint:** S2 | **Puntos:** 8 | [cite_start]**Reqs:** INV-01, INV-02, INV-03, INV-10, SEC-09 [cite: 89]
> [cite_start]"Como administrador de inventario, quiero cargar el catálogo de productos e inventario desde un archivo Excel, para actualizar rápidamente los productos disponibles sin ingresarlos uno por uno." [cite: 89]

[cite_start]**Criterios de Aceptación:** [cite: 89]
* [cite_start]CA1: El sistema acepta archivos .xlsx y .csv de hasta 10MB. [cite: 89]
* [cite_start]CA2: El parser lee las columnas: PRODUCTO, CATEGORÍA, CALIBRE, MARCA, CALIDAD, INGRESO, EMBARQUE, FECHA, DÍAS EN BODEGA, CANTIDAD INVENTARIO. [cite: 89]
* [cite_start]CA3: Se muestra una vista previa antes de confirmar con resumen: total productos, nuevos, actualizados, removidos. [cite: 89]
* CA4: Se validan: columnas faltantes, datos vacíos obligatorios, duplicados. [cite_start]Los errores se muestran agrupados con número de fila. [cite: 89]
* [cite_start]CA5: Existe un template Excel descargable con el formato correcto y datos de ejemplo. [cite: 89]
* [cite_start]CA6: Se valida el tipo MIME del archivo y se rechaza si no es Excel válido. [cite: 89]
* [cite_start]CA7: Cada línea de inventario es identificada por la combinación única de SKU (producto + calibre + marca + calidad) y Embarque. [cite: 89]
* [cite_start]CA8: La operación de carga genera un registro en el log de auditoría con nombre de archivo y resumen de cambios. [cite: 89]

#### [cite_start]US-INV-02: Versionado de Inventario [cite: 90]
* **Prioridad:** Alta | **Sprint:** S2 | **Puntos:** 5 | [cite_start]**Reqs:** INV-04 [cite: 90]
> [cite_start]"Como administrador de inventario, quiero que cada carga de Excel cree una versión." [cite: 90]

[cite_start]**Criterios de Aceptación:** [cite: 90]
* [cite_start]CA1: Cada carga exitosa crea una nueva versión con: número, fecha/hora, usuario, nombre de archivo, resumen de cambios. [cite: 90]
* [cite_start]CA2: Existe una pantalla de historial de versiones ordenada por fecha (más reciente primero). [cite: 90]
* [cite_start]CA3: La versión activa se muestra con badge "Activa" en verde. [cite: 90]

### [cite_start]2.2 Catálogo y Operaciones [cite: 91]

#### [cite_start]US-INV-03: Catálogo de Productos [cite: 92]
* **Prioridad:** Alta | **Sprint:** S2 | **Puntos:** 5 | [cite_start]**Reqs:** INV-05, INV-06, INV-09 [cite: 92]
> [cite_start]"Como usuario del sistema, quiero ver el catálogo de productos agrupado por categoría con búsqueda rápida, para encontrar productos fácilmente." [cite: 92]

[cite_start]**Criterios de Aceptación:** [cite: 92]
* [cite_start]CA1: Los productos se muestran agrupados en secciones colapsables por categoría. [cite: 92]
* [cite_start]CA2: Cada línea muestra: nombre del producto, calibre, marca, calidad, embarque, cantidad disponible. [cite: 92]
* [cite_start]CA3: La búsqueda filtra productos en tiempo real mientras se escribe. [cite: 92]
* [cite_start]CA4: Los productos sin stock se muestran con indicador visual (badge rojo o texto gris). [cite: 92]
* [cite_start]CA5: Es posible marcar un producto como "no disponible" temporalmente. [cite: 92]

#### [cite_start]US-INV-04: Edición Inline de Cantidades [cite: 93]
* **Prioridad:** Media | **Sprint:** S2 | **Puntos:** 3 | [cite_start]**Reqs:** INV-07 [cite: 93]
> [cite_start]"Como administrador de inventario, quiero editar la cantidad disponible de un producto directamente desde el catálogo, para hacer ajustes rápidos sin necesidad de recargar todo el Excel." [cite: 93]

[cite_start]**Criterios de Aceptación:** [cite: 93]
* [cite_start]CA1: Al hacer clic en el ícono de edición, el campo de cantidad se vuelve editable inline. [cite: 93]
* [cite_start]CA2: Se muestra botón de guardar (check) y cancelar (X). [cite: 93]
* [cite_start]CA3: El cambio se guarda inmediatamente al confirmar. [cite: 93]
* [cite_start]CA4: El cambio genera un registro en el log de auditoría con valor anterior y nuevo. [cite: 93]

#### [cite_start]US-INV-05: Exportar Catálogo a Excel [cite: 94]
* **Prioridad:** Media | **Sprint:** S3 | **Puntos:** 2 | [cite_start]**Reqs:** INV-08 [cite: 94]
> [cite_start]"Como administrador de inventario, quiero exportar el catálogo actual a un archivo Excel, para tener un respaldo y poder enviarlo a proveedores o al equipo." [cite: 94]

[cite_start]**Criterios de Aceptación:** [cite: 94]
* [cite_start]CA1: Botón "Exportar" visible en la pantalla de inventario. [cite: 94]
* [cite_start]CA2: El archivo exportado contiene todas las columnas del inventario actual. [cite: 94]
* [cite_start]CA3: Se incluye la fecha de exportación en el nombre del archivo. [cite: 94]
* [cite_start]CA4: La exportación se registra en el log de auditoría. [cite: 94]

---

## [cite_start]3. Toma de Pedidos [cite: 95]
### [cite_start]3.1 Flujo Principal [cite: 96]

#### [cite_start]US-ORD-01: Selección de Cliente para Pedido [cite: 97]
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 3 | [cite_start]**Reqs:** ORD-01, ORD-12, CLI-03 [cite: 97]
> [cite_start]"Como vendedor, quiero seleccionar un cliente antes de iniciar un pedido, para que el pedido quede asociado al cliente correcto y se muestren sus precios correspondientes." [cite: 97]

[cite_start]**Criterios de Aceptación:** [cite: 97]
* [cite_start]CA1: Al tocar "Nuevo Pedido", se muestra la lista de clientes asignados al vendedor. [cite: 97]
* [cite_start]CA2: Puedo buscar clientes por nombre de negocio con filtrado instantáneo. [cite: 97]
* [cite_start]CA3: Cada cliente muestra: nombre del negocio, contacto, tipo de precio asignado, fecha del último pedido. [cite: 97]
* [cite_start]CA4: Al seleccionar un cliente, se carga automáticamente su lista de precios correspondiente. [cite: 97]
* [cite_start]CA5: Existe un botón "+ Nuevo Cliente" para crear uno rápido sin salir del flujo. [cite: 97]

#### [cite_start]US-ORD-02: Catálogo de Productos en Pedido [cite: 98]
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 5 | [cite_start]**Reqs:** ORD-01, ORD-02, ORD-03, ORD-04 [cite: 98]
> [cite_start]"Como vendedor, quiero ver el catálogo de productos con cantidad de inventario y agregar ítems rápidamente, para tomar el pedido en menos de 3 minutos mientras hablo por teléfono." [cite: 98]

[cite_start]**Criterios de Aceptación:** [cite: 98]
* [cite_start]CA1: Los productos se muestran agrupados por categoría en secciones colapsables. [cite: 98]
* [cite_start]CA2: Las secciones recuerdan su estado (abierta/cerrada) entre sesiones. [cite: 98]
* [cite_start]CA3: Cada producto muestra: nombre, calibre/marca, precio según lista del cliente, cantidad disponible en inventario. [cite: 98]
* [cite_start]CA4: Cada producto tiene un stepper de cantidad (+/-) con touch targets de al menos 36px. [cite: 98]
* [cite_start]CA5: Al agregar un producto (cantidad > 0), la fila se resalta con fondo verde claro. [cite: 98]
* [cite_start]CA6: La búsqueda filtra productos por nombre en tiempo real. [cite: 98]
* [cite_start]CA7: Agregar un producto toma menos de 3 segundos (tap en + una vez). [cite: 98]
* [cite_start]CA8: Una barra flotante inferior muestra: número de ítems, subtotal, y botón "Ver Resumen". [cite: 98]

#### [cite_start]US-ORD-03: Validación de Inventario en Pedido [cite: 99]
* **Prioridad:** Alta | **Sprint:** S2 | **Puntos:** 3 | [cite_start]**Reqs:** ORD-07 [cite: 99]
> [cite_start]"Como vendedor, quiero que el sistema me alerte si estoy pidiendo más de lo disponible en inventario, para evitar comprometer productos que no tenemos en bodega." [cite: 99]

[cite_start]**Criterios de Aceptación:** [cite: 99]
* [cite_start]CA1: Si la cantidad solicitada supera el inventario disponible, se muestra una alerta visual en la línea del producto. [cite: 99]
* [cite_start]CA2: La alerta indica: "Inventario disponible: X unidades. Solicitó: Y unidades." [cite: 99]
* [cite_start]CA3: El vendedor puede sobrepasar la validación mediante una confirmación explícita ("Continuar de todas formas"). [cite: 99]
* [cite_start]CA4: Los productos que sobrepasan el inventario se marcan visualmente en el resumen del pedido. [cite: 99]

#### [cite_start]US-ORD-04: Resumen y Confirmación de Pedido [cite: 100]
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 5 | [cite_start]**Reqs:** ORD-05, ORD-08, ORD-13 [cite: 100]
> [cite_start]"Como vendedor, quiero revisar el resumen completo del pedido antes de confirmarlo, para verificar que todo esté correcto antes de comprometerlo." [cite: 100]

[cite_start]**Criterios de Aceptación:** [cite: 100]
* [cite_start]CA1: La pantalla muestra: cliente, fecha, lista de productos con cantidad editable inline, precio unitario editable inline, y total por línea. [cite: 100]
* [cite_start]CA2: Puedo eliminar una línea con botón (X). [cite: 100]
* [cite_start]CA3: Se muestra subtotal, campo de descuento (% o monto fijo), y total final. [cite: 100]
* [cite_start]CA4: Al confirmar, se genera automáticamente un número de pedido con formato PED-YYYYMMDD-NNNN. [cite: 100]
* [cite_start]CA5: Antes de confirmar, se valida: al menos un producto con cantidad > 0, cliente seleccionado, y precios válidos. [cite: 100]
* [cite_start]CA6: Si hay validaciones que fallan, se muestra alerta específica sin perder los datos ingresados. [cite: 100]

### [cite_start]3.2 Funcionalidades Complementarias [cite: 101]

#### [cite_start]US-ORD-05: Notas en el Pedido [cite: 102]
* **Prioridad:** Media | **Sprint:** S2 | **Puntos:** 2 | [cite_start]**Reqs:** ORD-06 [cite: 102]
> [cite_start]"Como vendedor, quiero agregar notas al pedido y a líneas individuales de producto, para comunicar instrucciones especiales al equipo de bodega." [cite: 102]

[cite_start]**Criterios de Aceptación:** [cite: 102]
* [cite_start]CA1: Existe un campo "Notas del pedido" en la pantalla de resumen. [cite: 102]
* [cite_start]CA2: Cada línea de producto tiene un ícono para agregar nota específica. [cite: 102]
* [cite_start]CA3: Las notas se muestran en el detalle del pedido y en el WhatsApp compartido. [cite: 102]

#### [cite_start]US-ORD-06: Compartir Pedido por WhatsApp [cite: 103]
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 3 | [cite_start]**Reqs:** ORD-09 [cite: 103]
> [cite_start]"Como vendedor, quiero compartir el resumen del pedido por WhatsApp al cliente y a la persona de bodega, para confirmar el pedido al cliente y notificar a bodega para despacho." [cite: 103]

[cite_start]**Criterios de Aceptación:** [cite: 103]
* [cite_start]CA1: Después de confirmar, aparecen botones: "Enviar al Cliente" y "Enviar a Bodega". [cite: 103]
* [cite_start]CA2: El mensaje incluye: número de pedido, nombre del cliente, lista de productos con cantidades y precios, y total. [cite: 103]
* [cite_start]CA3: El botón abre wa.me con el número del cliente pre-cargado y el texto formateado. [cite: 103]
* [cite_start]CA4: El botón de bodega permite seleccionar al despachador o ingresar número manualmente. [cite: 103]
* [cite_start]CA5: El formato del mensaje es legible en WhatsApp (usa * para negritas, líneas separadoras). [cite: 103]

#### [cite_start]US-ORD-07: Pedido Borrador con Autoguardado [cite: 104]
* **Prioridad:** Alta | **Sprint:** S2 | **Puntos:** 3 | [cite_start]**Reqs:** ORD-11 [cite: 104]
> [cite_start]"Como vendedor, quiero que mis pedidos incompletos se guarden automáticamente, para retomar el pedido si la llamada se corta o me interrumpen." [cite: 104]

[cite_start]**Criterios de Aceptación:** [cite: 104]
* [cite_start]CA1: El pedido se guarda automáticamente como borrador cada 30 segundos mientras se edita. [cite: 104]
* [cite_start]CA2: Los borradores aparecen al inicio de la lista de pedidos con badge "Borrador". [cite: 104]
* [cite_start]CA3: Puedo retomar un borrador y continuar donde lo dejé. [cite: 104]
* [cite_start]CA4: Un indicador visual muestra "Guardado automáticamente" con timestamp. [cite: 104]
* [cite_start]CA5: Puedo eliminar borradores que ya no necesito. [cite: 104]

#### [cite_start]US-ORD-08: Duplicar Pedido Anterior [cite: 105]
* **Prioridad:** Media | **Sprint:** S2 | **Puntos:** 3 | [cite_start]**Reqs:** ORD-10 [cite: 105]
> [cite_start]"Como vendedor, quiero crear un nuevo pedido copiando los ítems de un pedido anterior del cliente, para agilizar la reorden cuando un cliente pide lo mismo de siempre." [cite: 105]

[cite_start]**Criterios de Aceptación:** [cite: 105]
* [cite_start]CA1: Al seleccionar un cliente, si tiene pedidos anteriores, se muestra banner: "Repetir último pedido". [cite: 105]
* [cite_start]CA2: Se muestra un preview del último pedido: número, fecha, total, cantidad de productos. [cite: 105]
* [cite_start]CA3: Al tocar "Repetir", se copian todos los ítems al nuevo pedido con cantidades editables. [cite: 105]
* [cite_start]CA4: Los precios se actualizan a los vigentes (no se copian precios antiguos). [cite: 105]
* [cite_start]CA5: También existe opción de "Empezar vacío" para pedido desde cero. [cite: 105]

#### [cite_start]US-ORD-09: Precios Según Lista del Cliente [cite: 106]
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 3 | [cite_start]**Reqs:** ORD-12 [cite: 106]
> [cite_start]"Como vendedor, quiero que los precios se muestren automáticamente según la lista asignada al cliente, para no tener que recordar qué precio aplica a cada cliente." [cite: 106]

[cite_start]**Criterios de Aceptación:** [cite: 106]
* [cite_start]CA1: Al seleccionar un cliente, los precios del catálogo se actualizan a su lista (Empleado, Cliente, Mayoreo). [cite: 106]
* [cite_start]CA2: El tipo de lista se muestra como badge visible junto al nombre del cliente. [cite: 106]
* [cite_start]CA3: Si un producto no tiene precio en la lista del cliente, se muestra indicador visual y alerta al confirmar. [cite: 106]

---

## [cite_start]4. Gestión de Clientes [cite: 107]
### [cite_start]4.1 Clientes [cite: 108]

#### [cite_start]US-CLI-01: CRUD de Clientes [cite: 109]
* **Prioridad:** Alta | **Sprint:** S2 | **Puntos:** 5 | [cite_start]**Reqs:** CLI-01, CLI-02, CLI-05 [cite: 109]
> [cite_start]"Como vendedor, quiero crear, ver, editar y buscar clientes desde la app, para gestionar mi cartera de clientes sin depender de una hoja de papel." [cite: 109]

[cite_start]**Criterios de Aceptación:** [cite: 109]
* [cite_start]CA1: La pantalla lista todos mis clientes asignados con: nombre del negocio, contacto, teléfono, tipo de precio, estado. [cite: 109]
* [cite_start]CA2: Puedo buscar y filtrar por nombre, zona, tipo de precio, y estado (activo/inactivo). [cite: 109]
* [cite_start]CA3: Puedo crear un nuevo cliente con: nombre del negocio, contacto principal, teléfono, dirección, tipo de precio, notas. [cite: 109]
* [cite_start]CA4: Puedo editar la información de un cliente existente. [cite: 109]
* [cite_start]CA5: Cada cliente tiene botones de contacto rápido: WhatsApp (abre wa.me) y llamada directa (enlace tel:). [cite: 109]
* [cite_start]CA6: Los clientes se desactivan (soft delete), nunca se eliminan físicamente. [cite: 109]

#### [cite_start]US-CLI-02: Asignación de Clientes a Vendedores [cite: 110]
* **Prioridad:** Alta | **Sprint:** S2 | **Puntos:** 3 | [cite_start]**Reqs:** CLI-03 [cite: 110]
> [cite_start]"Como supervisor, quiero asignar clientes a vendedores específicos, para que cada vendedor solo vea y gestione sus clientes asignados." [cite: 110]

[cite_start]**Criterios de Aceptación:** [cite: 110]
* [cite_start]CA1: En la ficha del cliente existe un campo "Vendedor asignado" con dropdown. [cite: 110]
* [cite_start]CA2: Un vendedor solo ve los clientes que tiene asignados (enforced por RLS). [cite: 110]
* [cite_start]CA3: Un supervisor puede ver y reasignar clientes entre los vendedores de su equipo. [cite: 110]
* [cite_start]CA4: Un administrador puede ver y asignar clientes a cualquier vendedor. [cite: 110]

#### [cite_start]US-CLI-03: Historial del Cliente [cite: 111]
* **Prioridad:** Media | **Sprint:** S3 | **Puntos:** 3 | [cite_start]**Reqs:** CLI-04 [cite: 111]
> [cite_start]"Como vendedor, quiero ver el historial de pedidos y estadísticas de compra de un cliente, para conocer sus hábitos y ofrecer un mejor servicio." [cite: 111]

[cite_start]**Criterios de Aceptación:** [cite: 111]
* [cite_start]CA1: El detalle del cliente muestra: pedidos totales, monto total histórico, ticket promedio. [cite: 111]
* [cite_start]CA2: Lista de últimos pedidos con: fecha, número, total, estado. [cite: 111]
* [cite_start]CA3: Enlace para ver todos los pedidos del cliente filtrados automáticamente. [cite: 111]

---

## [cite_start]5. Historial y Seguimiento de Pedidos [cite: 112]
### [cite_start]5.1 Historial, Estados y Despacho [cite: 113]

#### [cite_start]US-HIS-01: Lista de Pedidos con Filtros [cite: 114]
* **Prioridad:** Alta | **Sprint:** S2 | **Puntos:** 5 | [cite_start]**Reqs:** HIS-01, HIS-02 [cite: 114]
> [cite_start]"Como vendedor, quiero ver la lista de mis pedidos con filtros por estado, fecha y cliente, para dar seguimiento a mis pedidos y encontrar rápidamente uno específico." [cite: 114]

[cite_start]**Criterios de Aceptación:** [cite: 114]
* [cite_start]CA1: La lista muestra: número de pedido, cliente, fecha, total, badge de estado con color. [cite: 114]
* [cite_start]CA2: Filtros disponibles: por estado (Borrador, Pendiente, Aprobado, Entregado, Cancelado), rango de fechas, cliente. [cite: 114]
* [cite_start]CA3: Los pedidos se ordenan por fecha descendente (más reciente primero). [cite: 114]
* [cite_start]CA4: El detalle muestra: líneas de producto, precios, descuentos, notas, timestamps. [cite: 114]
* CA5: Los vendedores solo ven sus propios pedidos. [cite_start]Los supervisores ven los de su equipo. [cite: 114]
* CA6: Edición de pedidos solo en estado Borrador, Pendiente o Aprobado. [cite_start]Pedidos entregados son de solo lectura. [cite: 114]

#### [cite_start]US-HIS-02: Flujo de Estados de Pedido [cite: 115]
* **Prioridad:** Alta | **Sprint:** S2 | **Puntos:** 5 | [cite_start]**Reqs:** HIS-03, HIS-04, HIS-05, HIS-06 [cite: 115]
> [cite_start]"Como supervisor, quiero cambiar el estado de los pedidos siguiendo un flujo definido, para gestionar el ciclo de vida del pedido desde su creación hasta la entrega." [cite: 115]

[cite_start]**Criterios de Aceptación:** [cite: 115]
* CA1: El flujo de estados es: Borrador → Pendiente → Aprobado → Entregado. [cite_start]Cancelado es posible desde cualquier estado excepto Entregado. [cite: 115]
* [cite_start]CA2: Cada cambio de estado registra: timestamp, usuario, y comentario opcional. [cite: 115]
* CA3: Los pedidos en estado Borrador, Pendiente o Aprobado son editables. [cite_start]Entregados son de solo lectura. [cite: 115]
* [cite_start]CA4: La cancelación requiere motivo obligatorio en un campo de texto. [cite: 115]
* [cite_start]CA5: Solo supervisores y admins pueden cancelar pedidos en estado Aprobado. [cite: 115]
* [cite_start]CA6: El historial de cambios de estado se muestra como timeline en el detalle del pedido. [cite: 115]

#### [cite_start]US-HIS-03: Vista del Despachador [cite: 116]
* **Prioridad:** Alta | **Sprint:** S2 | **Puntos:** 5 | [cite_start]**Reqs:** HIS-09 [cite: 116]
> [cite_start]"Como despachador de bodega, quiero ver los pedidos aprobados y marcarlos como entregados, para saber qué tengo que despachar y registrar las entregas." [cite: 116]

[cite_start]**Criterios de Aceptación:** [cite: 116]
* [cite_start]CA1: El despachador ve una lista de pedidos en estado "Aprobado" ordenados por fecha. [cite: 116]
* [cite_start]CA2: Puede ver el detalle de cada pedido: productos, cantidades, notas. [cite: 116]
* [cite_start]CA3: Puede cambiar el estado de un pedido de "Aprobado" a "Entregado". [cite: 116]
* [cite_start]CA4: Cuando un nuevo pedido es aprobado, aparece una notificación en la campana de notificaciones. [cite: 116]
* [cite_start]CA5: La campana de notificaciones muestra un badge con el número de pedidos nuevos sin revisar. [cite: 116]
* [cite_start]CA6: Al tocar la notificación, se navega al detalle del pedido. [cite: 116]

#### [cite_start]US-HIS-04: Exportar Pedidos a Excel [cite: 117]
* **Prioridad:** Media | **Sprint:** S3 | **Puntos:** 2 | [cite_start]**Reqs:** HIS-07 [cite: 117]
> [cite_start]"Como supervisor, quiero exportar la lista de pedidos filtrada a un archivo Excel, para generar reportes personalizados y compartirlos con gerencia." [cite: 117]

[cite_start]**Criterios de Aceptación:** [cite: 117]
* [cite_start]CA1: Botón "Exportar" visible en la pantalla de historial de pedidos. [cite: 117]
* [cite_start]CA2: La exportación respeta los filtros aplicados (fecha, estado, vendedor, cliente). [cite: 117]
* [cite_start]CA3: El archivo contiene: número de pedido, cliente, vendedor, fecha, estado, total, detalle de líneas. [cite: 117]
* [cite_start]CA4: La exportación se registra en el log de auditoría. [cite: 117]

#### [cite_start]US-HIS-05: Compartir Pedido desde Historial [cite: 118]
* **Prioridad:** Alta | **Sprint:** S2 | **Puntos:** 1 | [cite_start]**Reqs:** HIS-08 [cite: 118]
> [cite_start]"Como vendedor, quiero compartir el resumen de un pedido existente por WhatsApp, para reenviar el pedido al cliente si lo necesita de nuevo." [cite: 118]

[cite_start]**Criterios de Aceptación:** [cite: 118]
* [cite_start]CA1: En el detalle de cualquier pedido, existe un botón "Compartir por WhatsApp". [cite: 118]
* [cite_start]CA2: El mensaje generado es el mismo formato que al confirmar: número, productos, totales. [cite: 118]
* [cite_start]CA3: Se pre-carga el número de WhatsApp del cliente asociado. [cite: 118]

---

## [cite_start]6. Reportes y Dashboard [cite: 119]
### [cite_start]6.1 Dashboard y Reportes [cite: 120]

#### [cite_start]US-REP-01: Dashboard de KPIs [cite: 121]
* **Prioridad:** Alta | **Sprint:** S3 | **Puntos:** 5 | [cite_start]**Reqs:** REP-01, REP-07 [cite: 121]
> [cite_start]"Como gerente, quiero ver un dashboard con métricas clave del día, para tener visibilidad rápida del rendimiento del negocio." [cite: 121]

[cite_start]**Criterios de Aceptación:** [cite: 121]
* [cite_start]CA1: El dashboard muestra: pedidos del día, ventas del día, pedidos pendientes, top 5 productos, top 5 clientes. [cite: 121]
* CA2: Los vendedores solo ven sus propias métricas. Los supervisores ven las de su equipo. [cite_start]Gerencia ve todo. [cite: 121]
* [cite_start]CA3: Los KPIs se actualizan en tiempo real o al refrescar la página. [cite: 121]
* [cite_start]CA4: Se muestra comparativa vs día/período anterior con indicador de tendencia (flecha arriba/abajo, %). [cite: 121]

#### [cite_start]US-REP-02: Gráfico de Ventas por Período [cite: 122]
* **Prioridad:** Media | **Sprint:** S3 | **Puntos:** 3 | [cite_start]**Reqs:** REP-02 [cite: 122]
> [cite_start]"Como gerente, quiero ver un gráfico de tendencia de ventas configurable por período, para identificar patrones y tomar decisiones informadas." [cite: 122]

[cite_start]**Criterios de Aceptación:** [cite: 122]
* [cite_start]CA1: Gráfico de barras/líneas con selector de período: 7 días, 30 días, 90 días. [cite: 122]
* [cite_start]CA2: Incluye línea de comparación con período anterior. [cite: 122]
* [cite_start]CA3: Los montos y fechas se muestran claramente al tocar una barra/punto. [cite: 122]

#### [cite_start]US-REP-03: Reportes por Vendedor, Producto y Cliente [cite: 123]
* **Prioridad:** Media | **Sprint:** S3 | **Puntos:** 5 | [cite_start]**Reqs:** REP-03, REP-04, REP-05 [cite: 123]
> [cite_start]"Como gerente, quiero ver reportes desglosados por vendedor, por producto y por cliente, para evaluar rendimiento y tomar decisiones de negocio." [cite: 123]

[cite_start]**Criterios de Aceptación:** [cite: 123]
* [cite_start]CA1: Reporte de vendedores: ranking con pedidos, monto total, ticket promedio. [cite: 123]
* [cite_start]CA2: Reporte de productos: más y menos vendidos por período. [cite: 123]
* [cite_start]CA3: Reporte de clientes: frecuencia de compra, último pedido, monto acumulado, clientes inactivos. [cite: 123]
* [cite_start]CA4: Todos los reportes tienen filtro de rango de fechas. [cite: 123]

#### [cite_start]US-REP-04: Exportar Reportes [cite: 124]
* **Prioridad:** Media | **Sprint:** S3 | **Puntos:** 3 | [cite_start]**Reqs:** REP-06 [cite: 124]
> [cite_start]"Como gerente, quiero exportar cualquier reporte a Excel o PDF, para compartir los datos con socios y para archivo." [cite: 124]

[cite_start]**Criterios de Aceptación:** [cite: 124]
* [cite_start]CA1: Botón "Exportar" con opciones: Excel (.xlsx) y PDF. [cite: 124]
* [cite_start]CA2: La exportación incluye los datos del reporte con los filtros aplicados. [cite: 124]
* [cite_start]CA3: El archivo incluye encabezado con: nombre del reporte, rango de fechas, fecha de generación. [cite: 124]

---

## [cite_start]7. Roles y Permisos [cite: 125]
### [cite_start]7.1 RBAC [cite: 126]

#### [cite_start]US-ROL-01: Gestión de Roles [cite: 127]
* **Prioridad:** Alta | **Sprint:** S3 | **Puntos:** 5 | [cite_start]**Reqs:** ROL-01, ROL-03, ROL-06 [cite: 127]
> [cite_start]"Como administrador, quiero crear, editar y gestionar roles personalizados con permisos específicos, para adaptar el control de acceso a las necesidades de ImporFrut." [cite: 127]

[cite_start]**Criterios de Aceptación:** [cite: 127]
* [cite_start]CA1: La pantalla lista todos los roles con: nombre, descripción, número de usuarios asignados, tipo (sistema/custom). [cite: 127]
* [cite_start]CA2: Los roles del sistema (Admin, Gerencia, Supervisor, Vendedor, Inventario, Despachador) no se pueden eliminar pero sí modificar sus permisos. [cite: 127]
* [cite_start]CA3: Puedo crear roles personalizados con nombre, descripción, y selección de permisos. [cite: 127]
* [cite_start]CA4: Opción de clonar permisos de un rol existente al crear uno nuevo. [cite: 127]
* [cite_start]CA5: Todo cambio genera entrada en log de auditoría con valores antes/después. [cite: 127]

#### [cite_start]US-ROL-02: Matriz de Permisos Visual [cite: 128]
* **Prioridad:** Alta | **Sprint:** S3 | **Puntos:** 5 | [cite_start]**Reqs:** ROL-02, ROL-04 [cite: 128]
> [cite_start]"Como administrador, quiero ver y configurar los permisos de cada rol en una matriz visual de recursos vs acciones, para entender rápidamente qué puede y qué no puede hacer cada rol." [cite: 128]

[cite_start]**Criterios de Aceptación:** [cite: 128]
* [cite_start]CA1: La matriz muestra filas (recursos: Pedidos, Clientes, Inventario, Reportes, Usuarios, Roles, Config, Auditoría) y columnas (acciones: Ver, Crear, Editar, Eliminar, Exportar, Aprobar). [cite: 128]
* [cite_start]CA2: Cada celda es un checkbox/toggle que puedo activar o desactivar. [cite: 128]
* [cite_start]CA3: Incluye selector de alcance por recurso: "Solo propios", "Equipo", "Todos". [cite: 128]
* [cite_start]CA4: Un usuario puede tener múltiples roles y los permisos son aditivos (unión). [cite: 128]
* [cite_start]CA5: Warning al guardar: "Los cambios se aplicarán inmediatamente a X usuarios con este rol." [cite: 128]

#### [cite_start]US-ROL-03: Seguridad de Roles [cite: 129]
* **Prioridad:** Alta | **Sprint:** S3 | **Puntos:** 3 | [cite_start]**Reqs:** ROL-05, ROL-07, ROL-08 [cite: 129]
> [cite_start]"Como administrador, quiero que los permisos se apliquen inmediatamente y se validen tanto en UI como en backend, para evitar accesos no autorizados por cualquier vía." [cite: 129]

[cite_start]**Criterios de Aceptación:** [cite: 129]
* [cite_start]CA1: Los cambios de roles/permisos se aplican sin necesidad de que el usuario cierre sesión. [cite: 129]
* [cite_start]CA2: Los permisos se validan en cada request a través de middleware y RLS policies. [cite: 129]
* [cite_start]CA3: En el frontend, los elementos de UI se ocultan o deshabilitan según permisos. [cite: 129]
* [cite_start]CA4: Un usuario no puede asignarse a sí mismo un rol superior al que posee (anti-escalación). [cite: 129]
* [cite_start]CA5: Si un usuario intenta asignar un permiso que no tiene, se muestra: "No podés asignar permisos que no tenés." [cite: 129]

---

## [cite_start]8. Seguridad [cite: 130]
### [cite_start]8.1 Seguridad de Aplicación y Datos [cite: 131]

#### [cite_start]US-SEC-01: Seguridad de Comunicaciones y Headers [cite: 132]
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 3 | [cite_start]**Reqs:** SEC-01, SEC-04, SEC-08, SEC-10 [cite: 132]
> [cite_start]"Como administrador del sistema, quiero que todas las comunicaciones sean seguras y el frontend tenga headers de protección, para prevenir ataques comunes como XSS, clickjacking, y man-in-the-middle." [cite: 132]

[cite_start]**Criterios de Aceptación:** [cite: 132]
* CA1: Toda comunicación es sobre HTTPS/TLS 1.2+. [cite_start]HTTP redirige automáticamente a HTTPS. [cite: 132]
* [cite_start]CA2: Headers configurados: Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security. [cite: 132]
* [cite_start]CA3: Protección CSRF en formularios y mutaciones. [cite: 132]
* CA4: Las credenciales de Supabase (service_role key) nunca se exponen en el frontend. [cite_start]Solo se usa la anon key. [cite: 132]
* [cite_start]CA5: Variables de entorno para todas las credenciales en todos los ambientes. [cite: 132]

#### [cite_start]US-SEC-02: Row Level Security (RLS) [cite: 133]
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 5 | [cite_start]**Reqs:** SEC-02, SEC-03 [cite: 133]
> [cite_start]"Como administrador del sistema, quiero que todas las tablas tengan políticas RLS y validación de datos, para que ningún usuario pueda acceder a datos que no le corresponden." [cite: 133]

[cite_start]**Criterios de Aceptación:** [cite: 133]
* [cite_start]CA1: Todas las tablas de Supabase tienen RLS habilitado. [cite: 133]
* [cite_start]CA2: Vendedores solo acceden a sus pedidos y clientes asignados. [cite: 133]
* [cite_start]CA3: Supervisores acceden a los datos de su equipo. [cite: 133]
* [cite_start]CA4: Administradores tienen acceso completo pero sus acciones se registran. [cite: 133]
* [cite_start]CA5: Los inputs se sanitizan tanto en frontend como en backend para prevenir XSS e inyección SQL. [cite: 133]
* [cite_start]CA6: Se validan datos en Edge Functions además del frontend. [cite: 133]

#### [cite_start]US-SEC-03: Rate Limiting y Seguridad de Auth [cite: 134]
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 2 | [cite_start]**Reqs:** SEC-05, SEC-06 [cite: 134]
> [cite_start]"Como administrador del sistema, quiero limitar la tasa de requests en endpoints de autenticación, para prevenir ataques de fuerza bruta contra cuentas de usuarios." [cite: 134]

[cite_start]**Criterios de Aceptación:** [cite: 134]
* [cite_start]CA1: Los endpoints de login tienen rate limiting configurado. [cite: 134]
* CA2: La política de contraseñas se aplica: mín. [cite_start]8 chars, mayúscula, minúscula, número. [cite: 134]
* [cite_start]CA3: Se valida contra lista de contraseñas comunes. [cite: 134]

#### [cite_start]US-SEC-04: Seguridad de Datos y Backups [cite: 135]
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 3 | [cite_start]**Reqs:** SEC-11, SEC-12, SEC-13, SEC-14 [cite: 135]
> [cite_start]"Como administrador del sistema, quiero que los datos estén encriptados, respaldados, y que nunca se eliminen físicamente, para proteger la información del negocio y cumplir con buenas prácticas." [cite: 135]

[cite_start]**Criterios de Aceptación:** [cite: 135]
* [cite_start]CA1: Los datos en reposo están encriptados (manejo nativo de Supabase/PostgreSQL). [cite: 135]
* [cite_start]CA2: Backups automáticos diarios con retención de 30 días configurados en Supabase Pro. [cite: 135]
* [cite_start]CA3: Todas las entidades críticas usan soft delete (campo deleted_at en vez de DELETE físico). [cite: 135]
* [cite_start]CA4: Ambientes de desarrollo y producción tienen datos completamente aislados. [cite: 135]

#### [cite_start]US-SEC-05: Política de Retención de Datos [cite: 136]
* **Prioridad:** Media | **Sprint:** S4 | **Puntos:** 2 | [cite_start]**Reqs:** SEC-15 [cite: 136]
> [cite_start]"Como gerente, quiero que los pedidos y logs de auditoría se retengan por al menos 5 años, para cumplir con requerimientos legales y de negocio." [cite: 136]

[cite_start]**Criterios de Aceptación:** [cite: 136]
* [cite_start]CA1: Los registros de pedidos y auditoría no se eliminan automáticamente. [cite: 136]
* [cite_start]CA2: Se documenta la política de retención: pedidos y auditoría = 5 años mínimo. [cite: 136]
* [cite_start]CA3: Se configura alerta si el almacenamiento se acerca al límite. [cite: 136]

#### [cite_start]US-SEC-06: Validación de Archivos Excel [cite: 137]
* **Prioridad:** Alta | **Sprint:** S2 | **Puntos:** 2 | [cite_start]**Reqs:** SEC-09 [cite: 137]
> [cite_start]"Como administrador de inventario, quiero que el sistema valide los archivos Excel antes de procesarlos, para prevenir que archivos maliciosos o corruptos dañen el sistema." [cite: 137]

[cite_start]**Criterios de Aceptación:** [cite: 137]
* [cite_start]CA1: Se valida tipo MIME del archivo (.xlsx, .csv únicamente). [cite: 137]
* CA2: Tamaño máximo: 10MB. [cite_start]Archivos mayores se rechazan con mensaje claro. [cite: 137]
* [cite_start]CA3: Se escanea básicamente el contenido (número de columnas, tipos de datos). [cite: 137]
* [cite_start]CA4: Archivos inválidos muestran error específico: "El archivo no tiene el formato esperado." [cite: 137]

---

## [cite_start]9. Auditoría [cite: 138]
### [cite_start]9.1 Log de Auditoría [cite: 139]

#### [cite_start]US-AUD-01: Log de Auditoría Inmutable [cite: 140]
* **Prioridad:** Alta | **Sprint:** S3 | **Puntos:** 5 | [cite_start]**Reqs:** AUD-01, AUD-02, AUD-10 [cite: 140]
> [cite_start]"Como administrador, quiero que todas las operaciones críticas se registren automáticamente en un log inmutable, para tener trazabilidad completa de quién hizo qué y cuándo." [cite: 140]

[cite_start]**Criterios de Aceptación:** [cite: 140]
* [cite_start]CA1: La tabla audit_log registra: timestamp, user_id, email, acción (CREATE/UPDATE/DELETE/LOGIN/EXPORT/UPLOAD), tipo de recurso, resource_id, valores anteriores (JSONB), valores nuevos (JSONB), IP, user_agent. [cite: 140]
* [cite_start]CA2: El registro se hace automáticamente vía triggers de PostgreSQL en tablas críticas (no depende del frontend). [cite: 140]
* CA3: La tabla audit_log tiene política RLS que solo permite INSERT. [cite_start]Nunca UPDATE ni DELETE. [cite: 140]
* [cite_start]CA4: Ni siquiera los administradores pueden modificar o eliminar entradas del log. [cite: 140]

#### [cite_start]US-AUD-02: Consulta del Log de Auditoría [cite: 141]
* **Prioridad:** Alta | **Sprint:** S3 | **Puntos:** 5 | [cite_start]**Reqs:** AUD-03, AUD-04 [cite: 141]
> [cite_start]"Como administrador, quiero consultar el log de auditoría con filtros y ver el detalle de cambios, para investigar quién hizo un cambio específico y qué valores tenía antes." [cite: 141]

[cite_start]**Criterios de Aceptación:** [cite: 141]
* [cite_start]CA1: Pantalla accesible solo por roles Administrador y Gerencia. [cite: 141]
* [cite_start]CA2: Filtros disponibles: por usuario, por acción, por tipo de recurso, por rango de fechas. [cite: 141]
* [cite_start]CA3: Resultados paginados con contador total de registros. [cite: 141]
* [cite_start]CA4: El detalle de cada entrada muestra una vista diff: campos que cambiaron resaltados, valor anterior vs nuevo. [cite: 141]
* [cite_start]CA5: Campos sin cambios se muestran pero no resaltados. [cite: 141]

#### [cite_start]US-AUD-03: Registro de Eventos de Autenticación [cite: 142]
* **Prioridad:** Alta | **Sprint:** S3 | **Puntos:** 3 | [cite_start]**Reqs:** AUD-05 [cite: 142]
> [cite_start]"Como administrador, quiero que los eventos de autenticación se registren en el log, para detectar intentos de acceso no autorizado." [cite: 142]

[cite_start]**Criterios de Aceptación:** [cite: 142]
* [cite_start]CA1: Se registran: login exitoso, login fallido (con email intentado), logout, cambio de contraseña, activación/desactivación de MFA. [cite: 142]
* [cite_start]CA2: Los logins fallidos incluyen IP y user_agent para análisis. [cite: 142]
* [cite_start]CA3: Los eventos de auth se filtran con la acción "LOGIN" y "LOGIN_FAILED" en la pantalla de auditoría. [cite: 142]

#### [cite_start]US-AUD-04: Registro de Operaciones de Inventario y Pedidos [cite: 143]
* **Prioridad:** Alta | **Sprint:** S3 | **Puntos:** 3 | [cite_start]**Reqs:** AUD-06, AUD-07, AUD-08 [cite: 143]
> [cite_start]"Como administrador, quiero que los cambios en inventario, roles y pedidos se registren automáticamente, para tener trazabilidad de todas las operaciones comerciales y administrativas." [cite: 143]

[cite_start]**Criterios de Aceptación:** [cite: 143]
* [cite_start]CA1: Carga de Excel registra: nombre de archivo, usuario, resumen de cambios (nuevos/actualizados/removidos). [cite: 143]
* [cite_start]CA2: Edición manual de cantidades registra: producto, valor anterior, valor nuevo. [cite: 143]
* [cite_start]CA3: Cambios en roles y permisos registran: rol afectado, permisos antes/después. [cite: 143]
* [cite_start]CA4: Cambios de estado de pedidos registran: pedido, estado anterior, estado nuevo, usuario, comentario. [cite: 143]

#### [cite_start]US-AUD-05: Exportar Log de Auditoría [cite: 144]
* **Prioridad:** Media | **Sprint:** S3 | **Puntos:** 2 | [cite_start]**Reqs:** AUD-09 [cite: 144]
> [cite_start]"Como administrador, quiero exportar el log de auditoría filtrado a Excel o CSV, para compartir registros con auditoría externa o gerencia." [cite: 144]

[cite_start]**Criterios de Aceptación:** [cite: 144]
* [cite_start]CA1: Botón "Exportar" en la pantalla de auditoría con opciones: Excel y CSV. [cite: 144]
* [cite_start]CA2: La exportación respeta los filtros aplicados. [cite: 144]
* [cite_start]CA3: La exportación misma se registra en el log de auditoría. [cite: 144]

---

## [cite_start]10. Observabilidad [cite: 145]
### [cite_start]10.1 Logging y Monitoreo [cite: 146]

#### [cite_start]US-OBS-01: Logging y Monitoreo de Errores [cite: 147]
* **Prioridad:** Alta | **Sprint:** S4 | **Puntos:** 3 | [cite_start]**Reqs:** OBS-01, OBS-02 [cite: 147]
> [cite_start]"Como administrador del sistema, quiero que los errores se capturen y logueen de forma estructurada, para diagnosticar problemas rápidamente sin depender de los usuarios." [cite: 147]

[cite_start]**Criterios de Aceptación:** [cite: 147]
* [cite_start]CA1: Las Edge Functions usan logging estructurado con niveles: ERROR, WARN, INFO, DEBUG en formato JSON. [cite: 147]
* [cite_start]CA2: El frontend captura excepciones no manejadas con contexto: usuario, acción, stack trace. [cite: 147]
* [cite_start]CA3: Los errores críticos se muestran al usuario con mensaje amigable en español, no el stack trace. [cite: 147]

#### [cite_start]US-OBS-02: Health Check y Métricas [cite: 148]
* **Prioridad:** Media | **Sprint:** S4 | **Puntos:** 3 | [cite_start]**Reqs:** OBS-03, OBS-04 [cite: 148]
> [cite_start]"Como administrador del sistema, quiero tener un endpoint de health check y métricas básicas de uso, para monitorear que el sistema esté funcionando correctamente." [cite: 148]

[cite_start]**Criterios de Aceptación:** [cite: 148]
* [cite_start]CA1: Endpoint /api/health que retorna: status, conectividad con Supabase, versión del sistema. [cite: 148]
* [cite_start]CA2: Métricas básicas disponibles: pedidos por día, usuarios activos, errores por hora. [cite: 148]
* [cite_start]CA3: Las métricas son consultables desde el dashboard admin. [cite: 148]

---

## [cite_start]11. Rendimiento [cite: 149]
### [cite_start]11.1 Performance [cite: 150]

#### [cite_start]US-PER-01: Rendimiento de Carga y Búsqueda [cite: 151]
* **Prioridad:** Alta | **Sprint:** S4 | **Puntos:** 5 | [cite_start]**Reqs:** PER-01, PER-02, PER-03, PER-05 [cite: 151]
> [cite_start]"Como vendedor, quiero que la app cargue rápido y las búsquedas sean instantáneas, para no hacer esperar al cliente mientras estoy al teléfono." [cite: 151]

[cite_start]**Criterios de Aceptación:** [cite: 151]
* [cite_start]CA1: La carga inicial es menor a 3 segundos en conexión 3G (medido con Lighthouse). [cite: 151]
* [cite_start]CA2: La búsqueda de productos responde en menos de 300ms. [cite: 151]
* [cite_start]CA3: Se usa code splitting y lazy loading para minimizar el bundle inicial. [cite: 151]
* [cite_start]CA4: La base de datos tiene índices optimizados para: búsqueda de productos, pedidos por fecha, pedidos por cliente. [cite: 151]

#### [cite_start]US-PER-02: Paginación y Procesamiento de Excel [cite: 152]
* **Prioridad:** Alta | **Sprint:** S2 | **Puntos:** 3 | [cite_start]**Reqs:** PER-06, PER-07, PER-08 [cite: 152]
> [cite_start]"Como usuario del sistema, quiero que las listas largas estén paginadas y los Excel se procesen sin congelar la app, para tener una experiencia fluida sin importar el volumen de datos." [cite: 152]

[cite_start]**Criterios de Aceptación:** [cite: 152]
* [cite_start]CA1: Listas con más de 50 elementos usan paginación o scroll infinito. [cite: 152]
* [cite_start]CA2: Archivos Excel de hasta 1,000 productos se procesan sin degradación. [cite: 152]
* [cite_start]CA3: El sistema soporta al menos 20 vendedores concurrentes tomando pedidos. [cite: 152]
* [cite_start]CA4: Se muestra indicador de progreso durante procesamiento de archivos grandes. [cite: 152]

---

## [cite_start]12. Experiencia de Usuario [cite: 153]
### [cite_start]12.1 UX y PWA [cite: 154]

#### [cite_start]US-UX-01: Diseño Mobile-First y Navegación [cite: 155]
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 5 | [cite_start]**Reqs:** UX-01, UX-02, UX-03 [cite: 155]
> [cite_start]"Como vendedor, quiero una app optimizada para mi teléfono con navegación intuitiva, para usarla cómodamente con una mano mientras hablo por teléfono." [cite: 155]

[cite_start]**Criterios de Aceptación:** [cite: 155]
* [cite_start]CA1: Diseño mobile-first, optimizado para 360px+ con soporte para tablet y desktop. [cite: 155]
* [cite_start]CA2: Navegación inferior con 4 tabs: Nuevo Pedido, Pedidos, Clientes, Inventario. [cite: 155]
* [cite_start]CA3: Menú hamburguesa para opciones adicionales: Dashboard, Config, Auditoría, Perfil, Cerrar Sesión. [cite: 155]
* [cite_start]CA4: Paleta corporativa: verde #4CAF50 primario, fondo blanco, cards con sombras sutiles. [cite: 155]
* [cite_start]CA5: En desktop (1280px+): sidebar izquierdo reemplaza la navegación inferior. [cite: 155]

#### [cite_start]US-UX-02: Feedback Visual y Manejo de Errores [cite: 156]
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 3 | [cite_start]**Reqs:** UX-04, UX-05, UX-08, UX-09 [cite: 156]
> [cite_start]"Como usuario del sistema, quiero recibir feedback visual claro para cada acción, para saber qué está pasando y no quedarme en duda." [cite: 156]

[cite_start]**Criterios de Aceptación:** [cite: 156]
* [cite_start]CA1: Acciones exitosas muestran toast notification verde. [cite: 156]
* [cite_start]CA2: Acciones fallidas muestran toast notification rojo con mensaje accionable en español. [cite: 156]
* [cite_start]CA3: Durante cargas, se muestran loading spinners o skeleton screens. [cite: 156]
* [cite_start]CA4: Acciones destructivas (cancelar pedido, desactivar usuario) requieren confirmación explícita con modal. [cite: 156]
* [cite_start]CA5: Las listas sin datos muestran empty state con ilustración y call-to-action. [cite: 156]
* [cite_start]CA6: Nunca se muestran errores técnicos crudos (stack traces, códigos HTTP). [cite: 156]

#### [cite_start]US-UX-03: Gestos Táctiles y Accesibilidad [cite: 157]
* **Prioridad:** Media | **Sprint:** S4 | **Puntos:** 3 | [cite_start]**Reqs:** UX-06, UX-07 [cite: 157]
> [cite_start]"Como vendedor, quiero usar gestos táctiles para acciones rápidas, para navegar más ágilmente en mi teléfono." [cite: 157]

[cite_start]**Criterios de Aceptación:** [cite: 157]
* [cite_start]CA1: Pull-to-refresh funciona en listas de pedidos, clientes e inventario. [cite: 157]
* [cite_start]CA2: Swipe lateral en cards para acciones rápidas (WhatsApp, llamar, editar). [cite: 157]
* [cite_start]CA3: Contrastes de color adecuados para legibilidad al sol. [cite: 157]
* [cite_start]CA4: Todos los formularios tienen labels asociados y navegación por teclado en desktop. [cite: 157]

#### [cite_start]US-UX-04: PWA Instalable [cite: 158]
* **Prioridad:** Media | **Sprint:** S4 | **Puntos:** 3 | [cite_start]**Reqs:** UX-10 [cite: 158]
> [cite_start]"Como vendedor, quiero instalar la app en mi pantalla de inicio como si fuera una app nativa, para acceder rápidamente sin abrir el navegador." [cite: 158]

[cite_start]**Criterios de Aceptación:** [cite: 158]
* [cite_start]CA1: La app tiene manifest.json, service worker, e íconos configurados. [cite: 158]
* [cite_start]CA2: El navegador muestra prompt "Agregar a pantalla de inicio" automáticamente. [cite: 158]
* [cite_start]CA3: Al abrir desde pantalla de inicio, se muestra splash screen con logo ImporFrut. [cite: 158]
* [cite_start]CA4: La app funciona en modo standalone (sin barra de navegador). [cite: 158]

---

## [cite_start]13. Integraciones [cite: 159]
### [cite_start]13.1 Integraciones Externas [cite: 160]

#### [cite_start]US-INT-01: Integración WhatsApp y Llamadas [cite: 161]
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 2 | [cite_start]**Reqs:** INT-01, INT-02 [cite: 161]
> [cite_start]"Como vendedor, quiero contactar a mis clientes por WhatsApp o llamada directa desde la app, para comunicarme sin tener que buscar el número en otra app." [cite: 161]

[cite_start]**Criterios de Aceptación:** [cite: 161]
* [cite_start]CA1: Botón de WhatsApp en ficha de cliente abre wa.me con el número pre-cargado. [cite: 161]
* [cite_start]CA2: Botón de llamada abre enlace tel: para iniciar llamada directa. [cite: 161]
* [cite_start]CA3: Ambos botones funcionan en móvil y desktop. [cite: 161]

#### [cite_start]US-INT-02: Integración Excel Bidireccional [cite: 162]
* **Prioridad:** Alta | **Sprint:** S2 | **Puntos:** 3 | [cite_start]**Reqs:** INT-03 [cite: 162]
> [cite_start]"Como administrador de inventario, quiero importar inventario desde Excel y exportar pedidos/reportes a Excel, para mantener la flexibilidad de trabajar con hojas de cálculo cuando sea necesario." [cite: 162]

[cite_start]**Criterios de Aceptación:** [cite: 162]
* [cite_start]CA1: Importación de inventario desde .xlsx y .csv con validación. [cite: 162]
* [cite_start]CA2: Exportación de pedidos filtrados a .xlsx. [cite: 162]
* [cite_start]CA3: Exportación de reportes y auditoría a .xlsx. [cite: 162]
* [cite_start]CA4: Los archivos exportados tienen formato profesional con encabezados y metadatos. [cite: 162]

#### [cite_start]US-INT-03: Generación de PDF de Pedido [cite: 163]
* **Prioridad:** Media | **Sprint:** S4 | **Puntos:** 3 | [cite_start]**Reqs:** INT-04 [cite: 163]
> [cite_start]"Como vendedor, quiero descargar un comprobante del pedido en formato PDF, para tener un documento formal para entregar al cliente si lo solicita." [cite: 163]

[cite_start]**Criterios de Aceptación:** [cite: 163]
* [cite_start]CA1: Botón "Descargar PDF" en el detalle del pedido. [cite: 163]
* [cite_start]CA2: El PDF incluye: logo ImporFrut, número de pedido, datos del cliente, tabla de productos, totales. [cite: 163]
* [cite_start]CA3: El PDF tiene formato profesional y es legible en móvil. [cite: 163]

---

## [cite_start]14. Requerimientos No Funcionales [cite: 164]
### [cite_start]14.1 Infraestructura y Calidad [cite: 165]

#### [cite_start]US-NFR-01: Infraestructura y CI/CD [cite: 166]
* **Prioridad:** Alta | **Sprint:** S1 | **Puntos:** 5 | [cite_start]**Reqs:** NFR-01, NFR-04, NFR-07, SEC-14 [cite: 166]
> [cite_start]"Como equipo de desarrollo, quiero un pipeline CI/CD configurado con ambientes separados, para entregar código con confianza y sin riesgo de dañar producción." [cite: 166]

[cite_start]**Criterios de Aceptación:** [cite: 166]
* [cite_start]CA1: Repositorio Git con branching strategy: main (prod), develop (staging), feature branches. [cite: 166]
* [cite_start]CA2: Pull requests obligatorios con al menos 1 review. [cite: 166]
* [cite_start]CA3: Pipeline: lint, tests, build automático en cada PR. [cite: 166]
* CA4: Deploy automático a staging al mergear a develop. [cite_start]Deploy manual a producción al mergear a main. [cite: 166]
* [cite_start]CA5: Ambientes dev (local), staging (Supabase branch), producción (Supabase Pro) completamente aislados. [cite: 166]
* [cite_start]CA6: Disponibilidad objetivo: 99.5% uptime mensual. [cite: 166]

#### [cite_start]US-NFR-02: Tests y Calidad de Código [cite: 167]
* **Prioridad:** Alta | **Sprint:** S2 | **Puntos:** 5 | [cite_start]**Reqs:** NFR-05, NFR-09, NFR-02 [cite: 167]
> [cite_start]"Como equipo de desarrollo, quiero tests unitarios para lógica crítica y manejo centralizado de errores, para detectar bugs antes de que lleguen a producción." [cite: 167]

[cite_start]**Criterios de Aceptación:** [cite: 167]
* [cite_start]CA1: Tests unitarios para: cálculo de totales y descuentos, validaciones de pedidos, parsing de Excel, lógica de permisos. [cite: 167]
* [cite_start]CA2: Error boundary components en React para capturar errores de renderizado. [cite: 167]
* [cite_start]CA3: Error handler global para excepciones no manejadas. [cite: 167]
* [cite_start]CA4: Compatibilidad probada en: Chrome 90+, Safari 14+, Firefox 90+, Edge 90+. [cite: 167]

#### [cite_start]US-NFR-03: Internacionalización y Documentación [cite: 168]
* **Prioridad:** Media | **Sprint:** S4 | **Puntos:** 3 | [cite_start]**Reqs:** NFR-03, NFR-08, NFR-10 [cite: 168]
> [cite_start]"Como equipo de desarrollo, quiero arquitectura preparada para i18n y documentación técnica completa, para facilitar el mantenimiento futuro y la eventual adición de otros idiomas." [cite: 168]

[cite_start]**Criterios de Aceptación:** [cite: 168]
* [cite_start]CA1: Todos los textos de UI usan keys de i18n (aunque solo español esté implementado). [cite: 168]
* [cite_start]CA2: Variables de configuración externalizadas: URLs, feature flags, límites de descuento, formato de número de pedido. [cite: 168]
* [cite_start]CA3: Documentación incluye: README, arquitectura, guía de deployment, manual de usuario básico. [cite: 168] **[COMPLETADO]**

---
[cite_start]*Fin del Documento* [cite: 170]  
[cite_start]*Teknergy Inc. © 2026 — Todos los derechos reservados* [cite: 171]