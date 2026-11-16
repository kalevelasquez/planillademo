-- Migration: Configuración de Empresa / Datos Fiscales (IMPL-168, US-EXP-12)
-- Author: @alexis
-- Description: los reportes legales/fiscales (Constancia de Renta, Liquidación, Finiquito,
--              Solicitudes de Transferencia/Cheque) necesitan razón social, NIT, dirección
--              fiscal y teléfono de la empresa en su encabezado. Hoy ese dato no existe en
--              ningún lado del sistema (la tabla `tenants` solo tiene name/is_active). Se crea
--              un catálogo minimalista de una sola fila por tenant, mismo patrón que
--              `planilla_config_lavado_gasolina` (20260908090000) — no se amplía `tenants`
--              porque es la tabla administrativa raíz del multi-tenant, y mezclar ahí datos de
--              negocio de nómina rompería la separación que el proyecto ya sigue.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_config_empresa (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    razon_social TEXT NOT NULL,
    nit TEXT NOT NULL,
    direccion_fiscal TEXT NOT NULL,
    telefono TEXT NOT NULL,
    updated_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id)
);

ALTER TABLE public.planilla_config_empresa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_config_empresa_select_tenant"
    ON public.planilla_config_empresa FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_config_empresa_insert_admin"
    ON public.planilla_config_empresa FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_config_empresa_update_admin"
    ON public.planilla_config_empresa FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_config_empresa ON public.planilla_config_empresa;
CREATE TRIGGER tr_audit_planilla_config_empresa
    AFTER INSERT OR UPDATE ON public.planilla_config_empresa
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- Semilla UAT: datos reales confirmados por Imporfrut (ver 1_10_Constancia_de_Renta.docx,
-- MELVIN_FERNANDO_SANCHE_CORTEZ_JUNIO_2026.xlsx, DORA_AMANDA_AGOSTO_2026.xlsx).
INSERT INTO public.planilla_config_empresa (tenant_id, razon_social, nit, direccion_fiscal, telefono)
SELECT t.id, 'IMPORTADORA DE FRUTAS, S.A. DE C.V.', '0614-070297-103-7',
       'KM.20 Carretera de San Salvador a Quezaltepeque, Ofibodega Nejapa #6', '2524-6400'
FROM public.tenants t
ON CONFLICT (tenant_id) DO NOTHING;

COMMIT;
