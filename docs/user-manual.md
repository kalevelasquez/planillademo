# Manual de Usuario - ImporFrut v1.0

Este manual describe el flujo de trabajo para vendedores y administrativos en la plataforma ImporFrut.

## 1. Inicio de Sesión
Para acceder al sistema:
1. Navega a la URL de la aplicación.
2. Ingresa tus credenciales (Correo electrónico y Contraseña) proporcionadas por el administrador.
3. Haz clic en **Entrar**.
4. Una vez autenticado, serás redirigido al **Panel de Inicio** o a la **Lista de Clientes**.

## 2. Proceso de Creación de un Pedido
El flujo principal para generar ventas se divide en 4 pasos:

### Paso 1: Seleccionar Cliente
- Ve al módulo de **Clientes**.
- Busca al cliente por su nombre o código en la barra de búsqueda.
- Haz clic sobre el cliente deseado para entrar a su **Catálogo Personalizado**.

### Paso 2: Agregar Productos
- En el catálogo, verás los productos disponibles con sus precios actuales.
- Utiliza el buscador o los filtros (Categoría, Marca, Calibre, etc.) para encontrar productos.
- Ajusta la cantidad de cada producto. El sistema validará automáticamente si hay stock disponible.
- Los productos se guardarán automáticamente como un **Borrador** para evitar pérdida de datos.

### Paso 3: Resumen del Pedido
- Haz clic en el botón flotante **Ver Pedido** o en el icono del carrito.
- En la pantalla de resumen, verifica:
    - Cantidades de cada ítem.
    - Descuentos aplicados (Nota: Los descuentos tienen un límite máximo definido por el sistema).
    - Monto total del pedido.
- Puedes eliminar productos o ajustar cantidades antes de finalizar.

### Paso 4: Confirmar y Enviar WhatsApp
- Haz clic en **Confirmar Pedido**.
- El sistema generará un número de folio oficial (Ej: `PED-20260323-XXXX`).
- Se presentarán opciones para notificar al cliente:
    - **Enviar al Cliente:** Abre WhatsApp Web con un mensaje pre-formateado para el cliente.
    - **Enviar a Despacho:** Envía el resumen al equipo de logística.

## 3. Gestión de Clientes Básica
- Mira la lista de clientes para ver su saldo actual y estatus.
- Utiliza los filtros para ver solo "Mis Clientes" o buscar por zona.
- Si un cliente tiene un pedido anterior, puedes usar la opción **Repetir Pedido** desde su catálogo para cargar rápidamente los productos frecuentes.

## 4. Diferencia entre Pedido y Borrador

| Característica | Borrador (Draft) | Pedido (Confirmed) |
| :--- | :--- | :--- |
| **Folio** | Prefijo `DRAFT-` | Prefijo `PED-` |
| **Estado** | Temporal, editable. | Oficial, registrado en el sistema. |
| **Inventario** | No reserva stock definitivo. | Descuenta el inventario oficial. |
| **Visibilidad** | Solo tú puedes verlo. | Visible para Dispatch y Admin. |

## 5. Gestión de Inventario (Carga de Excel)
Este módulo permite a los administradores y encargados de inventario masivo actualizar los lotes disponibles en el sistema de manera eficiente.

**Pasos para la Carga Masiva:**
1. Navega al módulo de **Inventario**.
2. Haz clic en **Plantilla** > **Descargar Plantilla (.XLSX)** para obtener el formato oficial con las cabeceras requeridas.
3. Completa los datos en el Excel respetando las columnas (Producto, Marca, Calibre, Calidad, Embarque, Stock, Precio). 
   - *Nota:* La "Llave Única" de cada lote se forma por la combinación de Producto, Calibre, Marca, Calidad y Embarque.
4. Haz clic en **Importar Archivo** y sube tu Excel.
5. El sistema procesará las filas y mostrará un resumen:
   - **Sincronizados:** Registros que se actualizaron o crearon correctamente.
   - **Cuarentena:** Registros que quedaron en pausa debido a datos incompletos o inconsistentes.
6. **Gestión de Cuarentena:** Ve a la pestaña **Cuarentena (Importación)** para corregir manualmente los registros fallidos y guardarlos definitivamente en la base de datos.

## 6. Panel de Despacho y Logística
Módulo destinado al personal de bodega para la preparación física y entrega de los pedidos confirmados por el equipo de ventas.

**Flujo Operativo:**
1. Ve al **Panel de Despacho** desde el menú principal.
2. En la pestaña **Pendientes**, verás los pedidos que están listos para ser surtidos.
3. Haz clic en **Iniciar Preparación** sobre un pedido. Esto cambiará su estado a "En Preparación", informando al resto del equipo que el pedido ya está en manos del despachador.
4. Una vez los productos estén listos y cargados para su salida, haz clic en **Confirmar Entrega**.
5. Este paso cierra el ciclo del pedido:
   - Marca el estado como **Entregado**.
   - Genera el registro de auditoría final.
   - Bloquea el pedido para futuras ediciones manuales.

---
*Para soporte técnico, contacta a tu administrador de sistema.*
