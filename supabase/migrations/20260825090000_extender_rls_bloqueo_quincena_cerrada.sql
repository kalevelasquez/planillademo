-- Migration: Bloqueo de edición en quincena cerrada — Grupo B (IMPL-104 / US-CIE-01)
-- Author: @alexis
-- Description: US-CIE-01 CA1/CA2 — inventario verificado tabla por tabla de todo lo
--              scoped a quincena_id. La mayoría (planilla_viaticos_fijos_variables,
--              planilla_incapacidades, planilla_viaticos_kilometraje,
--              planilla_viaticos_por_ruta, planilla_vacaciones, planilla_calculo_empleado,
--              quincena_modulo_estado) YA gatea su UPDATE/DELETE con
--              `q.estado = 'en_proceso'` — más estricto de lo pedido (ya bloquean también
--              en 'enviada_aprobacion'), sin necesidad de tocarlas.
--
--              Gap real confirmado leyendo sus migraciones: `planilla_otros_ingresos`
--              (20260813090000) y `planilla_bonificaciones` (20260814090000) solo
--              chequean rol en su UPDATE/DELETE, SIN ningún filtro de estado de quincena
--              — hoy un Preparador podría editarlas aunque la quincena ya esté
--              'aprobada_cerrada'. Se usa `<> 'aprobada_cerrada'` (no `= 'en_proceso'`)
--              para no cambiar además su ventana de edición durante 'enviada_aprobacion',
--              que es un comportamiento distinto no pedido por ningún CA — ver gap
--              documentado en planilla-contexto.md.
--
--              `planilla_anticipos` queda deliberadamente afuera: su propia migración ya
--              documenta que un anticipo vive across-quincenas (no tiene sentido gatear su
--              UPDATE a la quincena de origen); la inmutabilidad real (cuotas ya
--              procesadas) la cubre `planilla_anticipo_pagos`, que no tiene política
--              UPDATE/DELETE en absoluto (ledger solo-inserción, RLS deniega por defecto,
--              igual que planilla_descuento_eventos).

BEGIN;

DROP POLICY IF EXISTS "planilla_otros_ingresos_update_rol" ON public.planilla_otros_ingresos;
CREATE POLICY "planilla_otros_ingresos_update_rol"
    ON public.planilla_otros_ingresos FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado <> 'aprobada_cerrada')
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
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado <> 'aprobada_cerrada')
    );

DROP POLICY IF EXISTS "planilla_bonificaciones_update_rol" ON public.planilla_bonificaciones;
CREATE POLICY "planilla_bonificaciones_update_rol"
    ON public.planilla_bonificaciones FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado <> 'aprobada_cerrada')
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
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado <> 'aprobada_cerrada')
    );

COMMIT;
