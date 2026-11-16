-- Migration: Descuentos — suspensión por quincena (IMPL-56 / US-DESC-02, IMPL-59)
-- Author: @alexis
-- Description: `planilla_descuento_eventos` es el análogo exacto de `planilla_anticipo_pagos`
--              (CA3 de US-DESC-02 pide explícitamente "mismo patrón que Anticipos, US-ANT-04")
--              — tabla propia (no la misma física de Anticipos, son entidades padre distintas),
--              mismo diseño: eventos perezosos, UNIQUE (descuento_id, quincena_id), CHECK de
--              exclusividad pago/suspensión, sin policies de UPDATE/DELETE (log inmutable),
--              trigger que rechaza eventos sobre un descuento ya completado.
--
--              Esta historia SOLO construye la suspensión (CA1/CA2) — el RPC bulk de
--              "procesar cuotas" (que decrementaría saldo_pendiente y dispararía la
--              finalización automática) llega con IMPL-61, que es quien realmente lo necesita.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_descuento_eventos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    descuento_id UUID NOT NULL REFERENCES public.planilla_descuentos(id) ON DELETE RESTRICT,
    quincena_id UUID NOT NULL REFERENCES public.quincenas(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('pago', 'suspension')),
    monto NUMERIC,
    motivo_suspension TEXT,
    registrado_por UUID REFERENCES public.user_profiles(id),
    registrado_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (descuento_id, quincena_id),
    CHECK (
        (tipo = 'pago' AND monto IS NOT NULL AND monto > 0 AND motivo_suspension IS NULL)
        OR
        (tipo = 'suspension' AND monto IS NULL AND motivo_suspension IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_planilla_descuento_eventos_descuento ON public.planilla_descuento_eventos(descuento_id);
CREATE INDEX IF NOT EXISTS idx_planilla_descuento_eventos_quincena ON public.planilla_descuento_eventos(quincena_id);

ALTER TABLE public.planilla_descuento_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_descuento_eventos_select_tenant"
    ON public.planilla_descuento_eventos FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_descuento_eventos_insert_quincena_en_proceso"
    ON public.planilla_descuento_eventos FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_descuento_eventos ON public.planilla_descuento_eventos;
CREATE TRIGGER tr_audit_planilla_descuento_eventos
    AFTER INSERT ON public.planilla_descuento_eventos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

CREATE OR REPLACE FUNCTION public.fn_validar_evento_descuento()
RETURNS TRIGGER AS $$
DECLARE
    v_estado TEXT;
BEGIN
    SELECT estado INTO v_estado FROM public.planilla_descuentos WHERE id = NEW.descuento_id;
    IF v_estado = 'completado' THEN
        RAISE EXCEPTION 'El descuento % ya está completado, no admite nuevos eventos', NEW.descuento_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_validar_evento_descuento ON public.planilla_descuento_eventos;
CREATE TRIGGER tr_validar_evento_descuento
    BEFORE INSERT ON public.planilla_descuento_eventos
    FOR EACH ROW EXECUTE FUNCTION public.fn_validar_evento_descuento();

COMMIT;
