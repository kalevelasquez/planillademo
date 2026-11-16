# Reporte de Bugs (QA Auditoría de UI/Concurrencia)

**Rol:** `@tester`
**Objetivo principal:** Búsqueda de vulnerabilidades de concurrencia y validaciones.

Tras realizar una auditoría de código analizando todos los manejadores de formularios y botones asíncronos en el frontend (`src/ui/features`), se ha detectado una vulnerabilidad crítica de concurrencia que afecta directamente a la instrucción de Prevención de Errores Críticos estipulada en el `tech-stack.md`.

## Detalles de la Vulnerabilidad: Condición de Carrera en Formularios Asíncronos (Double-click/Submit spam)

1. **Ubicaciones:**
   - `src/ui/features/orders/OrderSummaryView.tsx` (Función: `handleConfirmOrder`) - **RIESGO CRÍTICO** (Pedidos Duplicados).
   - `src/ui/features/customers/CustomerListView.tsx` (Función: `handleCreateCustomer`) - **RIESGO ALTO** (Clientes Duplicados si no hay restricción unique en DB de antemano).
   - `src/ui/features/auth/LoginView.tsx` (Función: `handleSubmit`).
   - `src/ui/features/auth/ResetPasswordView.tsx` (Función: `handleSubmit`).
   - `src/ui/features/auth/ForgotPasswordView.tsx` (Función: `handleSubmit`).
   - `src/ui/features/auth/UpdatePasswordRequiredView.tsx` (Función: `handleSubmit`).

2. **Pasos exactos para reproducirlos:**
   1. Ingresar a cualquiera de las vistas mencionadas (ej. Resumen de Pedido).
   2. Completar los requisitos necesarios para activar el botón de envío.
   3. Realizar múltiples clics muy rápidos en el botón de confirmación ("Confirmar Pedido", "Guardar Cliente", "Iniciar Sesión") o presionar repetidamente la tecla `Enter`.
   4. **Resultado:** Puesto que la validación para actualizar el estado booleano de React `setIsSubmitting(true)` ocurre después de la evaluación del evento, pero las llamadas a la función asíncrona se agrupan en la cola de event loop de Javascript antes del siguiente renderizado del DOM, la función es capaz de ejecutarse 2, 3 o más veces de forma simultánea. Esto salta las mitigaciones pasivas de `disabled={isSubmitting}` porque el DOM no tuvo tiempo de deshabilitar el botón físico antes de los múltiples clics.
   5. **Efecto:** Múltiples peticiones HTTP POST salen hacia Supabase. En el caso de `OrderSummaryView`, crearán órdenes de compra duplicadas, lo cual es inaceptable operativamente.

## Sugerencias de Refactorización para el `@programador`

Para mitigar proactivamente este error, el `@programador` debe aplicar una defensa sincrónica y semafórica explícita directamente en el bloque principal de los handlers de eventos utilizando el estado `isSubmitting`.

**Ejemplo de cómo corregir `OrderSummaryView.tsx` (y aplicar al resto):**

```tsx
const handleConfirmOrder = async () => {
    // 1. RESTRICCIÓN DE CONCURRENCIA OBLIGATORIA (Semáforo al inicio de la función)
    if (isSubmitting) return;

    if (!selectedCustomer || !hasItems || !profile?.tenant_id) return;

    setIsSubmitting(true);
    setError(null);

    try {
        // ... (código existente de la orden)
```

**Regla General Sugerida:** Todos los manejadores `onSubmit`, `onClick` asíncronos en componentes funcionales de React que mutan datos en Supabase DEBEN tener un `if (isSubmitting) return;` en la primera línea de la función. El control mediante la propiedad `disabled={isSubmitting}` en los componentes UI sirve como ayuda visual, no como barrera real de seguridad transaccional frente a eventos rápidos.
