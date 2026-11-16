-- Migration: Cálculo de Planilla — Snapshot Auditable por Empleado (IMPL-85 / US-CALC-00, IMPL-86)
-- Author: @alexis
-- Description: `planilla_calculo_empleado` es la tabla snapshot inmutable, una fila por
--              (quincena_id, empleado_id), con una columna real por cada uno de los 16 pasos del
--              motor (US-CALC-04/IMPL-90) — no solo el neto final. Satisface el propio CA1 de
--              IMPL-90: "poder auditar cómo se llegó a cada monto, en vez de recibir solo el
--              resultado final". Mismo principio de snapshot inmutable ya aplicado en TODA la
--              sesión (horas extras, viáticos, vacaciones, incapacidades): se calcula UNA VEZ
--              server-side y se persiste — nunca se recalcula en vivo al leer, y el neto de una
--              quincena ya cerrada nunca cambia aunque la configuración fiscal cambie después
--              (por eso `config_fiscal_id` se congela como FK, ver migración anterior).
--
--              Esta migración crea SOLO la tabla + RLS — la lógica del motor (los 16 pasos, RPCs
--              `calcular_planilla_empleado`/`calcular_planilla_quincena`) se construye en
--              migraciones posteriores, bloque por bloque (Ingresos Gravables → Deducciones
--              Legales → Bono 10% → Descuentos/Tope 20% → orquestador final), mismo criterio de
--              construcción incremental usado en toda la sesión.
--
--              Sin policy de DELETE (inmutable — recalcular es un UPSERT vía RPC, nunca un
--              borrado manual, mismo criterio que `planilla_descuento_eventos`/
--              `planilla_anticipo_pagos`). UPDATE solo permitido mientras la quincena esté
--              `en_proceso` (mismo gate que `planilla_vacaciones`) — una vez que la quincena
--              pasa a `aprobada_cerrada`, ni el propio RPC puede tocar el snapshot.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_calculo_empleado (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    quincena_id UUID NOT NULL REFERENCES public.quincenas(id) ON DELETE CASCADE,
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id),

    -- Pasos 1-2
    dias_habiles_quincena INT NOT NULL,
    dias_laborados NUMERIC NOT NULL,
    sueldo_quincenal_base NUMERIC NOT NULL,
    sueldo_proporcional NUMERIC NOT NULL,

    -- Paso 3
    horas_extras_monto NUMERIC NOT NULL DEFAULT 0,

    -- Paso 4 (informativo — excluido del Paso 8)
    viaticos_monto NUMERIC NOT NULL DEFAULT 0,
    viaticos_bono10_base NUMERIC NOT NULL DEFAULT 0,

    -- Paso 5
    vacaciones_monto NUMERIC NOT NULL DEFAULT 0,
    vacaciones_bono10_base NUMERIC NOT NULL DEFAULT 0,

    -- Paso 6
    bonificaciones_monto NUMERIC NOT NULL DEFAULT 0,

    -- Paso 7 + Paso 15 + bases de Bono 10% (US-CALC-05/IMPL-91)
    otros_ingresos_gravables NUMERIC NOT NULL DEFAULT 0,
    otros_ingresos_no_gravables NUMERIC NOT NULL DEFAULT 0,
    otros_ingresos_bono10_base NUMERIC NOT NULL DEFAULT 0,
    incapacidad_bono10_base NUMERIC NOT NULL DEFAULT 0,

    -- Paso 8
    total_ingresos_gravables NUMERIC NOT NULL DEFAULT 0,

    -- Pasos 9-10
    isss_empleado NUMERIC NOT NULL DEFAULT 0,
    afp_empleado NUMERIC NOT NULL DEFAULT 0,

    -- Paso 11
    deduccion_fija_aplicada NUMERIC NOT NULL DEFAULT 0,
    deduccion_fija_motivo TEXT,
    base_renta NUMERIC NOT NULL DEFAULT 0,

    -- Paso 12
    renta_isr NUMERIC NOT NULL DEFAULT 0,

    -- Paso 13 (línea separada, nunca se mezcla con el Paso 12)
    base_bono10_total NUMERIC NOT NULL DEFAULT 0,
    renta_bono10 NUMERIC NOT NULL DEFAULT 0,

    -- Paso 14 (US-CALC-09/IMPL-95)
    descuentos_obligatorios_total NUMERIC NOT NULL DEFAULT 0,
    descuentos_no_obligatorios_solicitado NUMERIC NOT NULL DEFAULT 0,
    descuentos_no_obligatorios_aplicado NUMERIC NOT NULL DEFAULT 0,
    descuentos_tope_20_base NUMERIC NOT NULL DEFAULT 0,
    descuentos_excedente_diferido NUMERIC NOT NULL DEFAULT 0,
    descuentos_alerta_tope_superado BOOLEAN NOT NULL DEFAULT false,
    alerta_neto_bajo_minimo BOOLEAN NOT NULL DEFAULT false,
    descuentos_detalle JSONB NOT NULL DEFAULT '[]',

    -- Paso 16
    total_no_gravable NUMERIC NOT NULL DEFAULT 0,
    neto_a_pagar NUMERIC NOT NULL DEFAULT 0,

    -- Cuotas patronales (vista separada para Contabilidad, no afectan el neto del empleado)
    isss_patronal NUMERIC NOT NULL DEFAULT 0,
    afp_patronal NUMERIC NOT NULL DEFAULT 0,
    insaforp_patronal NUMERIC NOT NULL DEFAULT 0,

    -- Trazabilidad / snapshot inmutable de configuración
    config_fiscal_id UUID NOT NULL REFERENCES public.planilla_config_fiscal(id),
    tramos_renta_vigente_desde DATE NOT NULL,
    tipo_quincena TEXT NOT NULL,

    calculado_por UUID REFERENCES public.user_profiles(id),
    calculado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,

    UNIQUE (quincena_id, empleado_id)
);

CREATE INDEX IF NOT EXISTS idx_planilla_calculo_empleado_quincena ON public.planilla_calculo_empleado(quincena_id);
CREATE INDEX IF NOT EXISTS idx_planilla_calculo_empleado_empleado ON public.planilla_calculo_empleado(empleado_id);

ALTER TABLE public.planilla_calculo_empleado ENABLE ROW LEVEL SECURITY;

-- Select abierto a todo el tenant (incluye aprobador_planilla, que necesita ver el detalle antes
-- de aprobar la quincena, IMPL-102).
CREATE POLICY "planilla_calculo_empleado_select_tenant"
    ON public.planilla_calculo_empleado FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

-- Insert/update solo mientras la quincena esté en_proceso — mismo gate que planilla_vacaciones.
CREATE POLICY "planilla_calculo_empleado_insert_rol"
    ON public.planilla_calculo_empleado FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

CREATE POLICY "planilla_calculo_empleado_update_rol"
    ON public.planilla_calculo_empleado FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_calculo_empleado ON public.planilla_calculo_empleado;
CREATE TRIGGER tr_audit_planilla_calculo_empleado
    AFTER INSERT OR UPDATE ON public.planilla_calculo_empleado
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

COMMIT;
