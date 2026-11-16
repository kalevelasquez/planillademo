-- Migration: Viáticos Fijos y Variables (IMPL-30 / US-VIA-05)
-- Author: @alexis
-- Description: Primera tabla de la épica Viáticos. Registro por empleado/quincena de un
--              viático Fijo o Variable con un concepto libre y un monto (CA1). No tiene
--              ninguna dimensión de ubicación (a diferencia de Horas Extras) porque ninguna
--              de las 10 historias de esta épica menciona ubicaciones. Tampoco se agrega
--              ningún candado de "completitud de módulo" (quincena_modulo_estado ya trackea
--              'viaticos' genéricamente desde IMPL-16, incluyendo el escape de "Sin
--              registros"; el camino de "confirmar con datos" queda fuera de alcance de estas
--              10 historias — ver gap en planilla-contexto.md).

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_viaticos_fijos_variables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    quincena_id UUID NOT NULL REFERENCES public.quincenas(id) ON DELETE CASCADE,
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('fijo', 'variable')),
    concepto TEXT NOT NULL,
    cantidad_lavados INT CHECK (cantidad_lavados >= 0),
    monto NUMERIC NOT NULL DEFAULT 0 CHECK (monto >= 0),
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planilla_viaticos_fijos_variables_quincena ON public.planilla_viaticos_fijos_variables(quincena_id);

ALTER TABLE public.planilla_viaticos_fijos_variables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_viaticos_fijos_variables_select_tenant"
    ON public.planilla_viaticos_fijos_variables FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_viaticos_fijos_variables_insert_quincena_en_proceso"
    ON public.planilla_viaticos_fijos_variables FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

CREATE POLICY "planilla_viaticos_fijos_variables_update_quincena_en_proceso"
    ON public.planilla_viaticos_fijos_variables FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_viaticos_fijos_variables_delete_quincena_en_proceso"
    ON public.planilla_viaticos_fijos_variables FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_viaticos_fijos_variables ON public.planilla_viaticos_fijos_variables;
CREATE TRIGGER tr_audit_planilla_viaticos_fijos_variables
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_viaticos_fijos_variables
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

COMMIT;
