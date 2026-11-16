-- Migration: Eliminar empleado (soft-delete con validación de movimientos, US-UX-02)
-- Author: @alexis
-- Description: RPC transaccional para "Eliminar empleado" (fidelidad al prototipo del PM,
--              menú ⋮ del detalle de empleado). No existía ningún mecanismo de borrado hasta
--              ahora — `planilla_empleados.deleted_at` ya existía en el esquema (y ya se
--              filtra con `.is('deleted_at', null)` en 9 lugares del frontend) pero nunca se
--              escribía. Se eligió soft-delete en vez de DELETE físico (más reversible, y
--              evita perder el registro histórico si algún día se necesita auditar). El RPC
--              valida primero que el empleado no tenga movimientos reales en las 13 tablas
--              con FK RESTRICT hacia planilla_empleados (planilla_empleado_documentos e
--              indemnizaciones quedan afuera del chequeo a propósito: son metadata/historial
--              del empleado, no "movimientos en planilla" — y de hecho tienen ON DELETE
--              CASCADE, no RESTRICT, en sus migraciones de creación).
--
--              Restringido a admin explícitamente dentro del RPC: la policy de UPDATE de
--              planilla_empleados ya permite admin O preparador_planilla (necesario para el
--              guardado normal del formulario), pero la policy de DELETE físico existente
--              (planilla_empleados_delete_admin) es admin-only — este RPC reemplaza esa
--              intención de "borrar es cosa de admin" con un chequeo propio, ya que técnicamente
--              hace un UPDATE (deleted_at), no un DELETE, y por lo tanto no hereda esa policy.

BEGIN;

CREATE OR REPLACE FUNCTION public.eliminar_empleado(p_empleado_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_tiene_movimientos BOOLEAN;
BEGIN
    IF NOT ('admin' = ANY(public.get_auth_roles())) THEN
        RAISE EXCEPTION 'Solo un administrador puede eliminar empleados.';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.planilla_anticipos WHERE empleado_id = p_empleado_id
        UNION ALL
        SELECT 1 FROM public.planilla_descuentos WHERE empleado_id = p_empleado_id
        UNION ALL
        SELECT 1 FROM public.planilla_vacaciones WHERE empleado_id = p_empleado_id
        UNION ALL
        SELECT 1 FROM public.planilla_bonificaciones WHERE empleado_id = p_empleado_id
        UNION ALL
        SELECT 1 FROM public.planilla_incapacidades WHERE empleado_id = p_empleado_id
        UNION ALL
        SELECT 1 FROM public.planilla_otros_ingresos WHERE empleado_id = p_empleado_id
        UNION ALL
        SELECT 1 FROM public.planilla_viaticos_kilometraje WHERE empleado_id = p_empleado_id
        UNION ALL
        SELECT 1 FROM public.planilla_viaticos_por_ruta WHERE empleado_id = p_empleado_id
        UNION ALL
        SELECT 1 FROM public.planilla_viaticos_fijos_variables WHERE empleado_id = p_empleado_id
        UNION ALL
        SELECT 1 FROM public.planilla_calculo_empleado WHERE empleado_id = p_empleado_id
        UNION ALL
        SELECT 1 FROM public.planilla_horas_extras_manual WHERE empleado_id = p_empleado_id
        UNION ALL
        SELECT 1 FROM public.planilla_marcaciones WHERE empleado_id = p_empleado_id
        UNION ALL
        SELECT 1 FROM public.planilla_tablas_incentivos WHERE empleado_id = p_empleado_id
    ) INTO v_tiene_movimientos;

    IF v_tiene_movimientos THEN
        RAISE EXCEPTION 'Este empleado tiene movimientos registrados en planilla y no se puede eliminar. Podés inactivarlo en su lugar.';
    END IF;

    UPDATE public.planilla_empleados
    SET deleted_at = now()
    WHERE id = p_empleado_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Empleado % no encontrado en el tenant actual', p_empleado_id;
    END IF;
END;
$$;

COMMIT;
