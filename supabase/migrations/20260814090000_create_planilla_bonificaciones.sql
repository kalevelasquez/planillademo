-- Migration: Bonificaciones — Cabecera + Cálculo Automático por Utilidad Neta (IMPL-71 / US-BON-02, IMPL-74)
-- Author: @alexis
-- Description: `planilla_bonificaciones` es la tabla única que sirve tanto a los bonos
--              automáticos (US-BON-02, esta historia) como a los manuales (US-BON-03, próxima
--              historia) — CA4 de US-BON-02 exige que ambas vías convivan sin que una sustituya
--              a la otra, así que comparten esquema y se distinguen por `origen`.
--
--              Decisión de diseño (documentada en planilla-contexto.md, sin EnterPlanMode): los
--              bonos automáticos se PERSISTEN como filas reales al momento del cálculo, nunca se
--              calculan en vivo como hace el mock del DEMO — mismo principio de snapshot que ya
--              aplica TODO el resto del proyecto (horas extras, viáticos, vacaciones,
--              incapacidades). El RPC `calcular_bonos_incentivo_quincena` es quien genera esas
--              filas, disparado por un botón "Calcular bonos de esta quincena" — mismo patrón
--              que `procesar_cuotas_anticipos_quincena`/`procesar_cuotas_descuentos_quincena`.
--
--              `gravabilidad` es SIEMPRE 'gravable' para origen='automatico' (CA2: "sin toggle,
--              es fijo") — el CHECK no lo fuerza a nivel de fila (permitiría en teoría otro
--              valor si alguien lo edita), pero el RPC de cálculo nunca inserta otra cosa; la UI
--              de edición de un automático (US-BON-04/IMPL-76) tampoco expone el selector.
--
--              `tipo` es NULL para automáticos (no aplica "Tipo de Bonificación", CA1 de
--              US-BON-03 es exclusivo del registro manual) y se llena recién en la próxima
--              migración de US-BON-03. `tabla_incentivo_id` + `utilidad_neta_mes` quedan como
--              snapshot de trazabilidad — de qué tabla y con qué utilidad neta se generó.
--
--              Es idempotente por (tabla_incentivo_id, empleado_id, quincena_id): si el
--              Preparador corrige la utilidad neta y vuelve a calcular, el RPC actualiza el monto
--              en vez de duplicar la fila.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_bonificaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    quincena_id UUID NOT NULL REFERENCES public.quincenas(id),
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id),
    tipo TEXT,
    monto NUMERIC NOT NULL CHECK (monto > 0),
    gravabilidad TEXT NOT NULL CHECK (gravabilidad IN ('gravable', 'no_gravable', 'bono_10')),
    origen TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'automatico')),
    tabla_incentivo_id UUID REFERENCES public.planilla_tablas_incentivos(id),
    utilidad_neta_mes NUMERIC,
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CHECK (origen = 'automatico' OR tabla_incentivo_id IS NULL),
    CHECK ((origen = 'automatico') = (tabla_incentivo_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_planilla_bonificaciones_automatico
    ON public.planilla_bonificaciones(tabla_incentivo_id, empleado_id, quincena_id)
    WHERE origen = 'automatico';

CREATE INDEX IF NOT EXISTS idx_planilla_bonificaciones_empleado ON public.planilla_bonificaciones(empleado_id);
CREATE INDEX IF NOT EXISTS idx_planilla_bonificaciones_quincena ON public.planilla_bonificaciones(quincena_id);

ALTER TABLE public.planilla_bonificaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_bonificaciones_select_tenant"
    ON public.planilla_bonificaciones FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_bonificaciones_insert_rol"
    ON public.planilla_bonificaciones FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_bonificaciones_update_rol"
    ON public.planilla_bonificaciones FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_bonificaciones_delete_rol"
    ON public.planilla_bonificaciones FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_bonificaciones ON public.planilla_bonificaciones;
CREATE TRIGGER tr_audit_planilla_bonificaciones
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_bonificaciones
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- Sin SECURITY DEFINER: corre como INVOKER, las policies de arriba autorizan. Recorre las
-- tablas de incentivo ACTIVAS, resuelve el rango de utilidad neta que aplica, y determina los
-- empleados objetivo (el empleado asignado directo, o todos los activos del grupo/departamento).
CREATE OR REPLACE FUNCTION public.calcular_bonos_incentivo_quincena(
    p_quincena_id UUID,
    p_utilidad_neta NUMERIC,
    p_user_id UUID
) RETURNS SETOF public.planilla_bonificaciones
LANGUAGE plpgsql
AS $$
DECLARE
    v_tabla RECORD;
    v_rango RECORD;
    v_empleado RECORD;
    v_result public.planilla_bonificaciones;
BEGIN
    FOR v_tabla IN
        SELECT * FROM public.planilla_tablas_incentivos
        WHERE tenant_id = public.get_auth_tenant_id() AND activo = true
    LOOP
        SELECT * INTO v_rango
        FROM public.planilla_tablas_incentivos_rangos
        WHERE tabla_id = v_tabla.id
          AND desde <= p_utilidad_neta
          AND (hasta IS NULL OR hasta >= p_utilidad_neta)
        LIMIT 1;

        IF v_rango IS NULL THEN
            CONTINUE;
        END IF;

        FOR v_empleado IN
            SELECT id FROM public.planilla_empleados
            WHERE tenant_id = public.get_auth_tenant_id()
              AND estado = 'activo'
              AND deleted_at IS NULL
              AND (
                  (v_tabla.empleado_id IS NOT NULL AND id = v_tabla.empleado_id)
                  OR (v_tabla.grupo IS NOT NULL AND departamento = v_tabla.grupo)
              )
        LOOP
            INSERT INTO public.planilla_bonificaciones (
                tenant_id, quincena_id, empleado_id, monto, gravabilidad, origen,
                tabla_incentivo_id, utilidad_neta_mes, created_by
            ) VALUES (
                public.get_auth_tenant_id(), p_quincena_id, v_empleado.id, v_rango.bono, 'gravable', 'automatico',
                v_tabla.id, p_utilidad_neta, p_user_id
            )
            ON CONFLICT (tabla_incentivo_id, empleado_id, quincena_id) WHERE origen = 'automatico'
            DO UPDATE SET monto = v_rango.bono, utilidad_neta_mes = p_utilidad_neta, updated_at = now()
            RETURNING * INTO v_result;

            RETURN NEXT v_result;
        END LOOP;
    END LOOP;

    RETURN;
END;
$$;

COMMIT;
