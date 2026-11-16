-- Migration: Eliminar/Cancelar Permanentemente un Descuento (IMPL-153)
-- Author: @alexis
-- Description: IMPL-58 (US-DESC-01) CA4 solo ofrecía un switch Activo/Pausado — ambos
--              mecanismos temporales, ninguno representa "este descuento ya no debe aplicar
--              nunca más". Replica el patrón ya resuelto en Anticipos (IMPL-54/US-ANT-05):
--              (1) DELETE solo permitido si no se ha cobrado ninguna cuota (monto_pagado = 0,
--              mismo criterio que planilla_anticipos_delete_sin_pagos); (2) nuevo estado
--              'cancelado' para el caso con historial de pagos ya cobrados, que deja de
--              generar cuotas futuras (ya excluido en todos los WHERE estado = 'activo'
--              existentes: procesar_cuotas_descuentos_quincena, validación de fijos, gate de
--              Calcular Planilla) sin borrar lo ya cobrado. (3) Corrige un gap real encontrado
--              en la revisión: el trigger de auditoría de esta tabla nunca capturó DELETE.

BEGIN;

ALTER TABLE public.planilla_descuentos DROP CONSTRAINT planilla_descuentos_estado_check;
ALTER TABLE public.planilla_descuentos ADD CONSTRAINT planilla_descuentos_estado_check
    CHECK (estado IN ('activo', 'pausado', 'completado', 'cancelado'));

-- Mismo criterio que planilla_anticipos_delete_sin_pagos (IMPL-54): solo se puede eliminar si
-- no se ha descontado ninguna cuota. Con al menos un pago registrado, la única acción posible
-- pasa a ser "cancelar" (UPDATE a estado = 'cancelado', vía planilla_descuentos_update_rol).
CREATE POLICY "planilla_descuentos_delete_sin_pagos"
    ON public.planilla_descuentos FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND monto_pagado = 0
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_descuentos ON public.planilla_descuentos;
CREATE TRIGGER tr_audit_planilla_descuentos
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_descuentos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

COMMIT;
