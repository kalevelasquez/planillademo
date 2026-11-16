BEGIN;

-- Gap documentado (planilla-contexto.md, IMPL-23 CA5 / IMPL-25): calcular_planilla_quincena
-- solo recorría empleados con estado='activo' — un empleado con horas extra YA CONFIRMADAS
-- para la quincena que se está calculando (planilla_horas_extras_manual, plata real) quedaba
-- excluido del loop en cuanto se lo pasaba a Inactivo, sin ningún error ni aviso: sus horas
-- nunca llegaban a planilla_calculo_empleado, nunca aparecían en el neto a pagar, nunca
-- llegaban a ningún export. No se borraban ni se bloqueaban — simplemente se volvían
-- invisibles para el motor. Se corrige incluyendo también a los inactivos que tengan al
-- menos una fila de horas extra para esta quincena puntual.
CREATE OR REPLACE FUNCTION public.calcular_planilla_quincena(
    p_quincena_id UUID,
    p_user_id UUID
) RETURNS SETOF public.planilla_calculo_empleado
LANGUAGE plpgsql
AS $$
DECLARE
    v_empleado RECORD;
BEGIN
    FOR v_empleado IN
        SELECT pe.id FROM public.planilla_empleados pe
        JOIN public.quincenas q ON q.tenant_id = pe.tenant_id
        WHERE q.id = p_quincena_id AND pe.tenant_id = public.get_auth_tenant_id()
          AND pe.deleted_at IS NULL
          AND (
              pe.estado = 'activo'
              OR EXISTS (
                  SELECT 1 FROM public.planilla_horas_extras_manual hem
                  WHERE hem.quincena_id = p_quincena_id AND hem.empleado_id = pe.id
              )
          )
    LOOP
        RETURN NEXT public.calcular_planilla_empleado(p_quincena_id, v_empleado.id, p_user_id);
    END LOOP;

    RETURN;
END;
$$;

COMMIT;
