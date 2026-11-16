-- Migration: Bonificaciones — Registro Manual (IMPL-71 / US-BON-03, IMPL-75)
-- Author: @alexis
-- Description: `planilla_bonificacion_tipos` es el catálogo de "Tipo de Bonificación" que pide
--              CA1 (Producción/Asistencia/Ventas/Otro) — sin historia Jira propia de
--              administración, mismo criterio que `planilla_descuento_categorias`: se siembra
--              vía migración, sin pantalla de configuración dedicada.
--
--              `planilla_bonificaciones.tipo` (columna TEXT sin uso real desde IMPL-74, los
--              automáticos siempre la dejaban NULL) se reemplaza por `tipo_id` FK — más
--              consistente con el resto del proyecto (categoria_id en Descuentos, concepto_id en
--              Otros Ingresos). Solo obligatoria para `origen='manual'`.
--
--              RPC `crear_bonificacion_manual`: soporta "Todos los empleados" (CA1) insertando
--              una fila por cada empleado activo con el MISMO monto — mismo patrón de
--              bulk-RPC-loop ya validado en `procesar_cuotas_anticipos_quincena`/
--              `procesar_cuotas_descuentos_quincena`, primera vez que se aplica a un "aplicar a
--              todos" en vez de "aplicar a los pendientes de esta quincena". El total de nómina
--              (CA3, monto × empleados activos) se muestra en el cliente ANTES de llamar al RPC
--              — el cliente ya sabe cuántos empleados activos hay (los tiene cargados para el
--              combobox), no hace falta que el RPC lo calcule ni lo confirme.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_bonificacion_tipos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id, nombre)
);

ALTER TABLE public.planilla_bonificacion_tipos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_bonificacion_tipos_select_tenant"
    ON public.planilla_bonificacion_tipos FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_bonificacion_tipos_insert_admin"
    ON public.planilla_bonificacion_tipos FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_bonificacion_tipos_update_admin"
    ON public.planilla_bonificacion_tipos FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_bonificacion_tipos ON public.planilla_bonificacion_tipos;
CREATE TRIGGER tr_audit_planilla_bonificacion_tipos
    AFTER INSERT OR UPDATE ON public.planilla_bonificacion_tipos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

INSERT INTO public.planilla_bonificacion_tipos (tenant_id, nombre)
SELECT t.id, v.nombre
FROM public.tenants t
CROSS JOIN (VALUES ('Producción'), ('Asistencia'), ('Ventas'), ('Otro')) AS v(nombre)
ON CONFLICT (tenant_id, nombre) DO NOTHING;

ALTER TABLE public.planilla_bonificaciones DROP COLUMN IF EXISTS tipo;
ALTER TABLE public.planilla_bonificaciones ADD COLUMN IF NOT EXISTS tipo_id UUID REFERENCES public.planilla_bonificacion_tipos(id);
ALTER TABLE public.planilla_bonificaciones ADD CONSTRAINT chk_planilla_bonificaciones_tipo_manual
    CHECK (origen = 'automatico' OR tipo_id IS NOT NULL);

-- Sin SECURITY DEFINER: corre como INVOKER, las policies de planilla_bonificaciones autorizan.
CREATE OR REPLACE FUNCTION public.crear_bonificacion_manual(
    p_quincena_id UUID,
    p_empleado_id UUID,
    p_todos_empleados BOOLEAN,
    p_tipo_id UUID,
    p_monto NUMERIC,
    p_gravabilidad TEXT,
    p_user_id UUID
) RETURNS SETOF public.planilla_bonificaciones
LANGUAGE plpgsql
AS $$
DECLARE
    v_empleado_id UUID;
    v_result public.planilla_bonificaciones;
BEGIN
    IF p_todos_empleados THEN
        FOR v_empleado_id IN
            SELECT id FROM public.planilla_empleados
            WHERE tenant_id = public.get_auth_tenant_id() AND estado = 'activo' AND deleted_at IS NULL
        LOOP
            INSERT INTO public.planilla_bonificaciones (
                tenant_id, quincena_id, empleado_id, tipo_id, monto, gravabilidad, origen, created_by
            ) VALUES (
                public.get_auth_tenant_id(), p_quincena_id, v_empleado_id, p_tipo_id, p_monto, p_gravabilidad, 'manual', p_user_id
            )
            RETURNING * INTO v_result;

            RETURN NEXT v_result;
        END LOOP;
    ELSE
        INSERT INTO public.planilla_bonificaciones (
            tenant_id, quincena_id, empleado_id, tipo_id, monto, gravabilidad, origen, created_by
        ) VALUES (
            public.get_auth_tenant_id(), p_quincena_id, p_empleado_id, p_tipo_id, p_monto, p_gravabilidad, 'manual', p_user_id
        )
        RETURNING * INTO v_result;

        RETURN NEXT v_result;
    END IF;

    RETURN;
END;
$$;

COMMIT;
