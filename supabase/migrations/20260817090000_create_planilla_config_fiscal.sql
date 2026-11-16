-- Migration: Cálculo de Planilla — Configuración Fiscal Versionada (IMPL-85 / US-CALC-01, IMPL-87 + parte de US-CALC-02, IMPL-88)
-- Author: @alexis
-- Description: `planilla_config_fiscal` y `planilla_renta_tramos` viven VERSIONADAS por vigencia
--              (`vigente_desde`/`vigente_hasta`), NUNCA como constantes hardcodeadas en una
--              función — las tasas legales sí cambian (la AFP eliminó su tope en 2023) y el
--              principio ya establecido en TODO el proyecto exige que el neto de una quincena
--              YA CERRADA nunca cambie. Con constantes en la función, un `CREATE OR REPLACE
--              FUNCTION` reinterpretaría retroactivamente quincenas cerradas la próxima vez que
--              alguien mirara el detalle. Con tabla versionada, cada cálculo persistido (próxima
--              migración, `planilla_calculo_empleado`) copia el `id` de la vigencia que aplicó
--              (`config_fiscal_id`) — congelado para siempre, sin importar qué vigencia nueva se
--              abra después.
--
--              Solo `admin` escribe (nunca `preparador_planilla` — cambiar tasas legales no es
--              una operación de nómina diaria). Nunca se hace UPDATE sobre una vigencia
--              histórica — el RPC `admin_crear_vigencia_fiscal` cierra la vigencia activa
--              (`vigente_hasta := nueva_fecha - 1`) e inserta la nueva fila, mismo criterio de
--              "log inmutable, solo se agregan eventos" ya usado en `planilla_descuento_eventos`/
--              `planilla_anticipo_pagos`.
--
--              `salario_minimo_inembargable` queda NULL a propósito (US-CALC-09/IMPL-95 CA3,
--              marcado ⚠️ Pendiente en el propio Jira — el DRN no especifica el monto exacto).
--              Mientras sea NULL, el motor de cálculo (próximas migraciones) no activa ningún
--              bloqueo — cero riesgo de aplicar un número legal inventado. El día que el cliente
--              confirme el monto, se abre una vigencia nueva con ese campo poblado, sin tocar
--              código.
--
--              Semilla 2026 con los valores confirmados en Jira (US-CALC-01/02, literales).

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_config_fiscal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    vigente_desde DATE NOT NULL,
    vigente_hasta DATE,

    isss_tasa_empleado NUMERIC NOT NULL,
    isss_tasa_patronal NUMERIC NOT NULL,
    isss_tope_base NUMERIC NOT NULL,

    afp_tasa_empleado NUMERIC NOT NULL,
    afp_tasa_patronal NUMERIC NOT NULL,
    afp_tope_base NUMERIC,

    insaforp_tasa_patronal NUMERIC NOT NULL,
    ipsfa_tasa_empleado NUMERIC NOT NULL DEFAULT 0.06,
    ipsfa_tasa_patronal NUMERIC NOT NULL DEFAULT 0.06,

    deduccion_fija_anual NUMERIC NOT NULL,
    deduccion_fija_tope_ingreso_anual NUMERIC NOT NULL,

    bono10_tasa NUMERIC NOT NULL DEFAULT 0.10,

    tope_descuentos_no_obligatorios_pct NUMERIC NOT NULL DEFAULT 0.20,
    salario_minimo_inembargable NUMERIC,

    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,

    CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

CREATE INDEX IF NOT EXISTS idx_planilla_config_fiscal_vigencia ON public.planilla_config_fiscal(tenant_id, vigente_desde);

ALTER TABLE public.planilla_config_fiscal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_config_fiscal_select_tenant"
    ON public.planilla_config_fiscal FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_config_fiscal_insert_admin"
    ON public.planilla_config_fiscal FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_config_fiscal ON public.planilla_config_fiscal;
CREATE TRIGGER tr_audit_planilla_config_fiscal
    AFTER INSERT ON public.planilla_config_fiscal
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

CREATE TABLE IF NOT EXISTS public.planilla_renta_tramos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    vigente_desde DATE NOT NULL,
    vigente_hasta DATE,
    orden INT NOT NULL CHECK (orden BETWEEN 1 AND 4),
    desde NUMERIC NOT NULL,
    hasta NUMERIC,
    tasa_pct NUMERIC NOT NULL,
    exceso_sobre NUMERIC NOT NULL,
    monto_fijo NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id, vigente_desde, orden),
    CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
    CHECK (hasta IS NULL OR hasta > desde)
);

CREATE INDEX IF NOT EXISTS idx_planilla_renta_tramos_vigencia ON public.planilla_renta_tramos(tenant_id, vigente_desde);

ALTER TABLE public.planilla_renta_tramos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_renta_tramos_select_tenant"
    ON public.planilla_renta_tramos FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_renta_tramos_insert_admin"
    ON public.planilla_renta_tramos FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_renta_tramos ON public.planilla_renta_tramos;
CREATE TRIGGER tr_audit_planilla_renta_tramos
    AFTER INSERT ON public.planilla_renta_tramos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- Sin SECURITY DEFINER: corre como INVOKER, las policies de INSERT de arriba autorizan.
-- Cierra la vigencia activa (vigente_hasta = p_desde - 1) e inserta la nueva fila — nunca UPDATE
-- sobre una vigencia histórica.
CREATE OR REPLACE FUNCTION public.admin_crear_vigencia_fiscal(
    p_desde DATE,
    p_isss_tasa_empleado NUMERIC, p_isss_tasa_patronal NUMERIC, p_isss_tope_base NUMERIC,
    p_afp_tasa_empleado NUMERIC, p_afp_tasa_patronal NUMERIC, p_afp_tope_base NUMERIC,
    p_insaforp_tasa_patronal NUMERIC,
    p_deduccion_fija_anual NUMERIC, p_deduccion_fija_tope_ingreso_anual NUMERIC,
    p_salario_minimo_inembargable NUMERIC,
    p_tramos JSONB,
    p_user_id UUID
) RETURNS public.planilla_config_fiscal
LANGUAGE plpgsql
AS $$
DECLARE
    v_config public.planilla_config_fiscal;
    v_tramo JSONB;
BEGIN
    UPDATE public.planilla_config_fiscal
    SET vigente_hasta = p_desde - 1
    WHERE tenant_id = public.get_auth_tenant_id() AND vigente_hasta IS NULL;

    UPDATE public.planilla_renta_tramos
    SET vigente_hasta = p_desde - 1
    WHERE tenant_id = public.get_auth_tenant_id() AND vigente_hasta IS NULL;

    INSERT INTO public.planilla_config_fiscal (
        tenant_id, vigente_desde, isss_tasa_empleado, isss_tasa_patronal, isss_tope_base,
        afp_tasa_empleado, afp_tasa_patronal, afp_tope_base, insaforp_tasa_patronal,
        deduccion_fija_anual, deduccion_fija_tope_ingreso_anual, salario_minimo_inembargable,
        created_by
    ) VALUES (
        public.get_auth_tenant_id(), p_desde, p_isss_tasa_empleado, p_isss_tasa_patronal, p_isss_tope_base,
        p_afp_tasa_empleado, p_afp_tasa_patronal, p_afp_tope_base, p_insaforp_tasa_patronal,
        p_deduccion_fija_anual, p_deduccion_fija_tope_ingreso_anual, p_salario_minimo_inembargable,
        p_user_id
    )
    RETURNING * INTO v_config;

    FOR v_tramo IN SELECT * FROM jsonb_array_elements(p_tramos)
    LOOP
        INSERT INTO public.planilla_renta_tramos (
            tenant_id, vigente_desde, orden, desde, hasta, tasa_pct, exceso_sobre, monto_fijo
        ) VALUES (
            v_config.tenant_id, p_desde,
            (v_tramo->>'orden')::INT,
            (v_tramo->>'desde')::NUMERIC,
            NULLIF(v_tramo->>'hasta', '')::NUMERIC,
            (v_tramo->>'tasa_pct')::NUMERIC,
            (v_tramo->>'exceso_sobre')::NUMERIC,
            (v_tramo->>'monto_fijo')::NUMERIC
        );
    END LOOP;

    RETURN v_config;
END;
$$;

-- Semilla 2026 (US-CALC-01 CA1/CA2, US-CALC-02 CA1/CA2, literales de Jira). IPSFA queda con su
-- DEFAULT de la tabla (6%/6%) — caso excepcional, no aplica a la generalidad de Imporfrut.
INSERT INTO public.planilla_config_fiscal (
    tenant_id, vigente_desde,
    isss_tasa_empleado, isss_tasa_patronal, isss_tope_base,
    afp_tasa_empleado, afp_tasa_patronal, afp_tope_base,
    insaforp_tasa_patronal,
    deduccion_fija_anual, deduccion_fija_tope_ingreso_anual
)
SELECT t.id, '2026-01-01',
    0.03, 0.075, 500.00,
    0.0725, 0.0875, NULL,
    0.01,
    1600.00, 9100.00
FROM public.tenants t;

INSERT INTO public.planilla_renta_tramos (tenant_id, vigente_desde, orden, desde, hasta, tasa_pct, exceso_sobre, monto_fijo)
SELECT t.id, '2026-01-01', v.orden, v.desde, v.hasta, v.tasa_pct, v.exceso_sobre, v.monto_fijo
FROM public.tenants t
CROSS JOIN (VALUES
    (1, 0.01, 275.00, 0.00, 0.00, 0.00),
    (2, 275.01, 447.62, 0.10, 236.00, 8.83),
    (3, 447.63, 1019.05, 0.20, 447.62, 30.00),
    (4, 1019.06, NULL, 0.30, 1019.05, 144.28)
) AS v(orden, desde, hasta, tasa_pct, exceso_sobre, monto_fijo);

-- Días laborados (Pasos 1-2 de US-CALC-04/IMPL-90) necesitan poder prorratear una baja a mitad
-- de quincena — hoy no existe ningún campo para eso. Aditivo, no migra nada existente. Gap
-- documentado: el motor de esta épica solo prorratea ALTAS contra fecha_ingreso; bajas a mitad
-- de quincena quedan fuera de alcance (el cálculo solo procesa empleados estado='activo').
ALTER TABLE public.planilla_empleados ADD COLUMN IF NOT EXISTS fecha_baja DATE;

COMMIT;
