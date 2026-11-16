-- Migration: Viático por Ruta (IMPL-30 / US-VIA-03)
-- Author: @alexis
-- Description: Ingreso manual de viático "por ruta" (CA1-CA3). Se agrega `origen` desde ya
--              ('manual' por defecto) porque US-VIA-02 (IMPL-33, Pre-llenado y Confirmación
--              del Formulario por IA) explícitamente reusa este mismo registro con
--              origen='ia' y un badge distinto en el listado (CA4 de esa historia) — evita
--              una migración de refactor cuando se construya esa historia.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_viaticos_por_ruta (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    quincena_id UUID NOT NULL REFERENCES public.quincenas(id) ON DELETE CASCADE,
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id),
    fecha DATE NOT NULL,
    cargo_motivo TEXT NOT NULL,
    destino TEXT NOT NULL,
    monto NUMERIC NOT NULL DEFAULT 0 CHECK (monto >= 0),
    origen TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'ia')),
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planilla_viaticos_por_ruta_quincena ON public.planilla_viaticos_por_ruta(quincena_id);

ALTER TABLE public.planilla_viaticos_por_ruta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_viaticos_por_ruta_select_tenant"
    ON public.planilla_viaticos_por_ruta FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_viaticos_por_ruta_insert_quincena_en_proceso"
    ON public.planilla_viaticos_por_ruta FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

CREATE POLICY "planilla_viaticos_por_ruta_update_quincena_en_proceso"
    ON public.planilla_viaticos_por_ruta FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_viaticos_por_ruta_delete_quincena_en_proceso"
    ON public.planilla_viaticos_por_ruta FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_viaticos_por_ruta ON public.planilla_viaticos_por_ruta;
CREATE TRIGGER tr_audit_planilla_viaticos_por_ruta
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_viaticos_por_ruta
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

COMMIT;
