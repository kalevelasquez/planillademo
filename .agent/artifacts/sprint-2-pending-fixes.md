# 🛠️ Snapshot de Estabilización (Sprint 2 - Fase 1 y 2)

## 1. Análisis del Problema
Durante la ejecución de las Fases 1 (Motor de Inventario) y 2 (Gestión de Clientes) del Sprint 2, se han detectado fallos lógicos regresivos que amenazan la integridad estructural y la visualización correcta de los datos por parte del usuario final. Estas ramificaciones prohíben proceder inmediatamente al Motor de Pedidos (Fase 3), ya que construiríamos sobre una base inestable e inconsistente.

## 2. Diagnóstico de Fallos y Modelo de Datos Afectado

### A. Fallo RLS Clientes (Control de Acceso Vulnerado)
* **Síntoma:** Los usuarios con un rol menor al gerencial (ej. Vendedores / `seller`) únicamente visibilizan clientes categorizados como "Sin asignar" y han perdido el acceso de visualización de su propia cartera de clientes asignados activamente.
* **Causa Raíz:** La política de nivel de filas estipulada en la tabla `customers` subyace en un defecto estructural de evaluación lógica en su componente `OR`. Se asume que el chequeo de igualdad `assigned_seller_id = auth.uid()` fue sobreescrito, ocluido en una sub-consulta errónea, o simplemente excluido al permitir la lectura pública aislada para `assigned_seller_id IS NULL`.
* **Impacto del Negocio:** Riesgo alto, disrupción transaccional de ventas por limitación de acceso nativo de usuario.

### B. Fallo Motor Inventario (Sincronización Restringida)
* **Síntoma:** Rebotes persistentes al intentar la actualización del Inventario "Inline". A su vez, se documentan fallos continuos de lectoescritura al tratar con el Storage `inventory_documents`.
* **Causa Raíz:**
  1. *Lógica Transaccional Rota:* Las operaciones al modelo `products` están abortando silenciosamente porque el Trigger estructurado para poblar los registros en `inventory_versions` sufre excepciones (error de tipo de datos relacional, validación check violada, ausencia de metadata o credenciales elevadas faltantes en nivel base de datos).
  2. *Controladores Carentes:* El depósito `inventory_documents` carece del bucket debidamente formalizado y/o las Políticas RLS de Storage niegan estrictamente la escritura proveniente de `auth.role() = 'authenticated'`.
* **Impacto del Negocio:** El balance de stock frontal no es la fuente verdadera; se genera un falso "Optimistic Feedback" que es rechazado silenciosamente por Supabase, comprometiendo todo el proceso logístico.

## 3. Hoja de Ruta de Reparación (Plan de Implementación Estricto)

### Para el @operador (Backend / Storage & Postgres)
1. **Auditoría e Inyección de SQL para el Fallo RLS (Customers):**
   * Preparar un parche en `/supabase/migrations/` o una inserción correctiva de Postgres.
   * La RLS para `customers` (SELECT) de los "vendedores" **DEBE OBLIGATORIAMENTE** seguir la lógica estricta: Mostrar el cliente SI su Tenant es el del vendedor `AND` (`assigned_seller_id IS NULL` `OR` `assigned_seller_id = auth.uid()`).
2. **Reparación del Aborto Transaccional del Motor de Inventario:**
   * Auditar los Triggers en Postgres vinculados a la tabla `products`. Asegurar que el cast, checks y foreign keys encajen perfectamente en las declaraciones asíncronas para la delegación a `inventory_versions`. Un update de tabla de clientes no debe matar el guardado completo si está acoplado lógicamente por trigger.
3. **Desbloqueo de Storage para Storage:**
   * Garantizar que el bucket `inventory_documents` esté habilitado y cuente con la regla explícita permitiendo escrituras vía Storage API REST.

### Para el @programador (Frontend)
1. **Atrapado de Excepciones del Backend:**
   * Es mandatorio mejorar el catch del `.syncProducts()` o la edición *Inline* asegurando que la UI aviente el mensaje descriptivo exacto fallido. El frontend no debe ser optimista cuando la infraestructura declina por debajo de este.
2. **Restante Mantenimiento de Parches:**
   * Realizar una comprobación transversal probando las credenciales de *admin* vs *vendedor* confirmando el renderizado correcto y seguro de Supabase Data.

> **⚠️ DEBILITAR EL FIREWALL ES PROHIBIDO ⚠️.** Ningún componente de la Fase 3 debe comenzar o ser procesado antes de que estas reparaciones sean concretadas y confirmadas formalmente por el equipo.
