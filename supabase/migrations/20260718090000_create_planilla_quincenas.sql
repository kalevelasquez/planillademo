-- Migration: Tabla de Quincenas del módulo de Planilla (IMPL-9 / US-QNA-01, US-QNA-02)
-- Author: @alexis
-- Description: Primera tabla de "período" del proyecto. Cubre el modelo de datos base
--              (US-QNA-01: alta) y el enum de estados completo (US-QNA-02: ciclo de vida),
--              aunque las transiciones de estado (envío, aprobación, rechazo, re-apertura)
--              se implementan en Lote 12 (Cierre y Aprobación) — acá solo se persiste el
--              estado inicial 'en_proceso'.
--
--              Sin EXCLUDE USING gist para solapamiento de fechas: el proyecto no tiene
--              precedente de exclusion constraints ni btree_gist en ninguna otra migración.
--              La validación de solapamiento (CA6 de US-QNA-01) se hace a mano dentro del
--              RPC create_quincena, mismo criterio que register_indemnizacion
--              (20260717090000_create_planilla_empleado_indemnizaciones.sql).

BEGIN;

CREATE TABLE IF NOT EXISTS public.quincenas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

    tipo TEXT NOT NULL CHECK (tipo IN ('normal', 'aguinaldo', 'quincena_25')),
    nombre TEXT NOT NULL,                                  -- libre, editable (CA2)
    etiqueta_estandar TEXT NOT NULL,                       -- auto-generada, NO editable (CA3)

    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    dias_habiles INT NOT NULL,                             -- L-Sáb, sin descontar feriados todavía (IMPL-15 pendiente)

    estado TEXT NOT NULL DEFAULT 'en_proceso'
        CHECK (estado IN ('en_proceso', 'enviada_aprobacion', 'aprobada_cerrada', 'reabierta')),

    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    deleted_at TIMESTAMPTZ,

    CHECK (fecha_fin >= fecha_inicio)
);

CREATE INDEX IF NOT EXISTS idx_quincenas_tenant_estado ON public.quincenas(tenant_id, estado);
CREATE INDEX IF NOT EXISTS idx_quincenas_tenant_fechas ON public.quincenas(tenant_id, fecha_inicio, fecha_fin);

ALTER TABLE public.quincenas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quincenas_select_tenant"
    ON public.quincenas FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "quincenas_insert_roles"
    ON public.quincenas FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "quincenas_update_roles"
    ON public.quincenas FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

DROP TRIGGER IF EXISTS tr_audit_quincenas ON public.quincenas;
CREATE TRIGGER tr_audit_quincenas
    AFTER INSERT OR UPDATE ON public.quincenas
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- ============================================================
-- RPC: crear quincena validando solapamiento (CA6)
-- ============================================================
-- Sin SECURITY DEFINER a propósito, mismo criterio que register_indemnizacion: corre con
-- las políticas RLS del usuario invocante (solo admin/preparador_planilla pueden insertar).
CREATE OR REPLACE FUNCTION public.create_quincena(
    p_tipo TEXT,
    p_nombre TEXT,
    p_etiqueta_estandar TEXT,
    p_fecha_inicio DATE,
    p_fecha_fin DATE,
    p_dias_habiles INT
)
RETURNS public.quincenas
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.quincenas;
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_solapada BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM public.quincenas
        WHERE tenant_id = v_tenant_id
          AND tipo = p_tipo
          AND deleted_at IS NULL
          AND fecha_inicio <= p_fecha_fin
          AND fecha_fin >= p_fecha_inicio
    ) INTO v_solapada;

    IF v_solapada THEN
        RAISE EXCEPTION 'Ya existe una quincena de tipo "%" con un rango de fechas que se superpone (%  a  %)', p_tipo, p_fecha_inicio, p_fecha_fin;
    END IF;

    INSERT INTO public.quincenas (
        tenant_id, tipo, nombre, etiqueta_estandar, fecha_inicio, fecha_fin, dias_habiles, created_by
    ) VALUES (
        v_tenant_id, p_tipo, p_nombre, p_etiqueta_estandar, p_fecha_inicio, p_fecha_fin, p_dias_habiles, auth.uid()
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

COMMIT;
