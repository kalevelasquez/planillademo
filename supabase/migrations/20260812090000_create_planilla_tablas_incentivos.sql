-- Migration: Bonificaciones — Tablas de Incentivos por Empleado o Grupo (IMPL-71 / US-BON-01, IMPL-73)
-- Author: @alexis
-- Description: `planilla_tablas_incentivos` (cabecera) asigna una tabla a UN empleado o a UN
--              grupo, nunca ambos ni ninguno (CHECK XOR) — "grupo" reutiliza el campo ya
--              existente `planilla_empleados.departamento` (texto libre, con precedente de
--              agrupación ya establecido en `getEmpleadosPorDepartamento`, US-QNA-08), no se
--              crea un concepto nuevo de "grupo".
--
--              `planilla_tablas_incentivos_rangos` (detalle): rangos de utilidad neta
--              (desde/hasta) y su bono correspondiente. `hasta IS NULL` significa "sin límite
--              superior" (el último rango de una tabla suele ser así). Se valida en el CHECK que
--              hasta > desde cuando no es null; la no-superposición de rangos entre sí queda
--              como responsabilidad de la UI (ver gap documentado), no se modela con un exclusion
--              constraint todavía — no hay CA que lo exija explícitamente.
--
--              Solo admin administra (CA1: "Como administrador, quiero definir tablas...").
--              Sin tabla de eventos/cuotas: esto es solo configuración, el cálculo real
--              (US-BON-02/IMPL-74) vive en `planilla_bonificaciones`, tabla separada.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_tablas_incentivos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    empleado_id UUID REFERENCES public.planilla_empleados(id),
    grupo TEXT,
    activo BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CHECK ((empleado_id IS NOT NULL) <> (grupo IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_planilla_tablas_incentivos_empleado ON public.planilla_tablas_incentivos(empleado_id);
CREATE INDEX IF NOT EXISTS idx_planilla_tablas_incentivos_grupo ON public.planilla_tablas_incentivos(grupo);

ALTER TABLE public.planilla_tablas_incentivos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_tablas_incentivos_select_tenant"
    ON public.planilla_tablas_incentivos FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_tablas_incentivos_insert_admin"
    ON public.planilla_tablas_incentivos FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_tablas_incentivos_update_admin"
    ON public.planilla_tablas_incentivos FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_tablas_incentivos_delete_admin"
    ON public.planilla_tablas_incentivos FOR DELETE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_tablas_incentivos ON public.planilla_tablas_incentivos;
CREATE TRIGGER tr_audit_planilla_tablas_incentivos
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_tablas_incentivos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

CREATE TABLE IF NOT EXISTS public.planilla_tablas_incentivos_rangos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    tabla_id UUID NOT NULL REFERENCES public.planilla_tablas_incentivos(id) ON DELETE CASCADE,
    desde NUMERIC NOT NULL CHECK (desde >= 0),
    hasta NUMERIC CHECK (hasta IS NULL OR hasta > desde),
    bono NUMERIC NOT NULL CHECK (bono > 0),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planilla_tablas_incentivos_rangos_tabla ON public.planilla_tablas_incentivos_rangos(tabla_id);

ALTER TABLE public.planilla_tablas_incentivos_rangos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_tablas_incentivos_rangos_select_tenant"
    ON public.planilla_tablas_incentivos_rangos FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_tablas_incentivos_rangos_insert_admin"
    ON public.planilla_tablas_incentivos_rangos FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_tablas_incentivos_rangos_update_admin"
    ON public.planilla_tablas_incentivos_rangos FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_tablas_incentivos_rangos_delete_admin"
    ON public.planilla_tablas_incentivos_rangos FOR DELETE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_tablas_incentivos_rangos ON public.planilla_tablas_incentivos_rangos;
CREATE TRIGGER tr_audit_planilla_tablas_incentivos_rangos
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_tablas_incentivos_rangos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- Sin SECURITY DEFINER (mismo criterio que crear_descuento): corre como INVOKER, las policies de
-- INSERT de arriba son las que autorizan. Atómico: tabla + rangos en una sola transacción, para
-- no dejar una tabla de incentivos sin rangos si algo falla a mitad de camino.
CREATE OR REPLACE FUNCTION public.crear_tabla_incentivo(
    p_nombre TEXT,
    p_empleado_id UUID,
    p_grupo TEXT,
    p_rangos JSONB,
    p_user_id UUID
) RETURNS public.planilla_tablas_incentivos
LANGUAGE plpgsql
AS $$
DECLARE
    v_tabla public.planilla_tablas_incentivos;
    v_rango JSONB;
BEGIN
    INSERT INTO public.planilla_tablas_incentivos (tenant_id, nombre, empleado_id, grupo, created_by)
    VALUES (public.get_auth_tenant_id(), p_nombre, p_empleado_id, p_grupo, p_user_id)
    RETURNING * INTO v_tabla;

    FOR v_rango IN SELECT * FROM jsonb_array_elements(p_rangos)
    LOOP
        INSERT INTO public.planilla_tablas_incentivos_rangos (tenant_id, tabla_id, desde, hasta, bono)
        VALUES (
            v_tabla.tenant_id,
            v_tabla.id,
            (v_rango->>'desde')::NUMERIC,
            NULLIF(v_rango->>'hasta', '')::NUMERIC,
            (v_rango->>'bono')::NUMERIC
        );
    END LOOP;

    RETURN v_tabla;
END;
$$;

COMMIT;
