-- Migration: Viático por Kilometraje (IMPL-30 / US-VIA-06)
-- Author: @alexis
-- Description: (1) `planilla_tarifas_km_cargo` — catálogo nuevo (config, admin-only, mismo
--              patrón que `planilla_jornadas_cargo` de Horas Extras) para precargar la tarifa
--              por KM según el cargo del empleado (CA2), editable puntualmente en el registro.
--              (2) `planilla_viaticos_kilometraje` — tabla separada de `planilla_viaticos_por_ruta`
--              (CA3: "formulario completamente separado... no comparten pantalla ni lógica de
--              cálculo"). El campo de adjuntos (CA4, "Respaldo") queda como placeholder — el
--              mecanismo real de múltiples adjuntos es US-VIA-08 (IMPL-39), que no existe
--              todavía.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_tarifas_km_cargo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    cargo TEXT NOT NULL,
    tarifa_km NUMERIC NOT NULL CHECK (tarifa_km >= 0),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id, cargo)
);

ALTER TABLE public.planilla_tarifas_km_cargo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_tarifas_km_cargo_select_tenant"
    ON public.planilla_tarifas_km_cargo FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_tarifas_km_cargo_insert_admin"
    ON public.planilla_tarifas_km_cargo FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_tarifas_km_cargo_update_admin"
    ON public.planilla_tarifas_km_cargo FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_tarifas_km_cargo_delete_admin"
    ON public.planilla_tarifas_km_cargo FOR DELETE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_tarifas_km_cargo ON public.planilla_tarifas_km_cargo;
CREATE TRIGGER tr_audit_planilla_tarifas_km_cargo
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_tarifas_km_cargo
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

CREATE TABLE IF NOT EXISTS public.planilla_viaticos_kilometraje (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    quincena_id UUID NOT NULL REFERENCES public.quincenas(id) ON DELETE CASCADE,
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id),
    fecha DATE NOT NULL,
    km_recorridos NUMERIC NOT NULL CHECK (km_recorridos >= 0),
    tarifa_km NUMERIC NOT NULL CHECK (tarifa_km >= 0),
    monto NUMERIC NOT NULL DEFAULT 0 CHECK (monto >= 0),
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planilla_viaticos_kilometraje_quincena ON public.planilla_viaticos_kilometraje(quincena_id);

ALTER TABLE public.planilla_viaticos_kilometraje ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_viaticos_kilometraje_select_tenant"
    ON public.planilla_viaticos_kilometraje FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_viaticos_kilometraje_insert_quincena_en_proceso"
    ON public.planilla_viaticos_kilometraje FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

CREATE POLICY "planilla_viaticos_kilometraje_update_quincena_en_proceso"
    ON public.planilla_viaticos_kilometraje FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_viaticos_kilometraje_delete_quincena_en_proceso"
    ON public.planilla_viaticos_kilometraje FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_viaticos_kilometraje ON public.planilla_viaticos_kilometraje;
CREATE TRIGGER tr_audit_planilla_viaticos_kilometraje
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_viaticos_kilometraje
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

COMMIT;
