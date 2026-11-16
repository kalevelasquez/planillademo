-- Migration: Estado de Módulos por Quincena (IMPL-9 / US-QNA-06)
-- Author: @alexis
-- Description: Modelo híbrido de estado (CA1): pendiente → con_datos (automático al
--              primer registro real del módulo, NO implementado todavía porque los 7
--              módulos — Horas Extras, Viáticos, Vacaciones, Bonificaciones, Anticipos,
--              Incapacidades, Descuentos — son épicas futuras) → confirmado (manual, vía
--              "Confirmar módulo" o "Sin registros este período" para los 4 módulos que
--              CA2 marca como opcionales: Viáticos, Incapacidades, Vacaciones,
--              Bonificaciones). Horas Extras/Anticipos/Descuentos SÍ requieren datos reales
--              para confirmarse, así que quedan bloqueados hasta que existan esos módulos.
--
--              RLS espejada a la de "quincenas" (IMPL-12): solo se puede escribir mientras
--              la quincena padre esté en estado 'en_proceso'.

BEGIN;

CREATE TABLE IF NOT EXISTS public.quincena_modulo_estado (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    quincena_id UUID NOT NULL REFERENCES public.quincenas(id) ON DELETE CASCADE,
    modulo TEXT NOT NULL CHECK (modulo IN (
        'horas_extras', 'viaticos', 'vacaciones', 'bonificaciones', 'anticipos', 'incapacidades', 'descuentos'
    )),
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'con_datos', 'confirmado')),
    via_sin_registros BOOLEAN NOT NULL DEFAULT false,
    confirmado_por UUID REFERENCES public.user_profiles(id),
    confirmado_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,

    UNIQUE (quincena_id, modulo)
);

CREATE INDEX IF NOT EXISTS idx_quincena_modulo_estado_quincena ON public.quincena_modulo_estado(quincena_id);

ALTER TABLE public.quincena_modulo_estado ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quincena_modulo_estado_select_tenant"
    ON public.quincena_modulo_estado FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "quincena_modulo_estado_insert_en_proceso"
    ON public.quincena_modulo_estado FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

CREATE POLICY "quincena_modulo_estado_update_en_proceso"
    ON public.quincena_modulo_estado FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

DROP TRIGGER IF EXISTS tr_audit_quincena_modulo_estado ON public.quincena_modulo_estado;
CREATE TRIGGER tr_audit_quincena_modulo_estado
    AFTER INSERT OR UPDATE ON public.quincena_modulo_estado
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

COMMIT;
