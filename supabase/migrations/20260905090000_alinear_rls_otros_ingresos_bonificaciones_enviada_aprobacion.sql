-- Migration: Alinear RLS de Otros Ingresos/Bonificaciones con las demás tablas de módulo
-- Author: @alexis
-- Description: Revisión épica por épica (post-IMPL-102) de Cierre y Aprobación detectó que
--              `planilla_otros_ingresos` y `planilla_bonificaciones` (20260825090000) gatean
--              su UPDATE/DELETE con `q.estado <> 'aprobada_cerrada'`, mientras las otras 7
--              tablas de módulo (planilla_viaticos_fijos_variables, planilla_incapacidades,
--              planilla_viaticos_kilometraje, planilla_viaticos_por_ruta, planilla_vacaciones,
--              planilla_calculo_empleado, quincena_modulo_estado) usan `q.estado = 'en_proceso'`
--              — más estricto, ya bloquean también durante 'enviada_aprobacion'.
--
--              Esa diferencia dejaba una ventana real: un Preparador podía seguir editando
--              Bonificaciones/Otros Ingresos de una quincena ya enviada a aprobación, mientras
--              el Aprobador la estaba revisando — rompe la intención del flujo de aprobación
--              (las cifras no deberían cambiar bajo el Aprobador mientras decide). La migración
--              original ya documentaba esto como decisión deliberada ("no pedido por ningún
--              CA"), pero el usuario decidió en esta revisión alinear el criterio con las
--              demás 7 tablas por consistencia real, en vez de mantener la excepción.

BEGIN;

DROP POLICY IF EXISTS "planilla_otros_ingresos_update_rol" ON public.planilla_otros_ingresos;
CREATE POLICY "planilla_otros_ingresos_update_rol"
    ON public.planilla_otros_ingresos FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

DROP POLICY IF EXISTS "planilla_otros_ingresos_delete_rol" ON public.planilla_otros_ingresos;
CREATE POLICY "planilla_otros_ingresos_delete_rol"
    ON public.planilla_otros_ingresos FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

DROP POLICY IF EXISTS "planilla_bonificaciones_update_rol" ON public.planilla_bonificaciones;
CREATE POLICY "planilla_bonificaciones_update_rol"
    ON public.planilla_bonificaciones FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

DROP POLICY IF EXISTS "planilla_bonificaciones_delete_rol" ON public.planilla_bonificaciones;
CREATE POLICY "planilla_bonificaciones_delete_rol"
    ON public.planilla_bonificaciones FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

COMMIT;
