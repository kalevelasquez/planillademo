-- Migration: Overrides de Jornada Ordinaria por Cargo/Departamento (IMPL-20 / US-HEX-01 CA2)
-- Author: @alexis
-- Description: La jornada legal por defecto (CA1: L-V 8h efectivas, Sábado 4h) vive como
--              constante en el código (src/utils/jornadaUtils.ts), no en esta tabla — es la
--              regla base que aplica cuando NINGÚN override calza. Esta tabla solo guarda
--              las EXCEPCIONES: un horario distinto para un cargo o departamento específico
--              (CA2: "no asume una jornada única para todo el personal"). NO implementa
--              turnos rotativos reales (el DRN no especifica frecuencia/patrón de rotación,
--              decisión explícita del usuario de acotar el alcance a horario fijo por
--              cargo/departamento) — ver gap en planilla-contexto.md. Domingo no es parte de
--              horas_por_dia: es legalmente no laborable siempre, sin excepción (CA1).

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_jornadas_cargo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    aplica_a TEXT NOT NULL CHECK (aplica_a IN ('cargo', 'departamento')),
    valor TEXT NOT NULL,
    horas_por_dia JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id, aplica_a, valor)
);

ALTER TABLE public.planilla_jornadas_cargo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_jornadas_cargo_select_tenant"
    ON public.planilla_jornadas_cargo FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_jornadas_cargo_insert_admin"
    ON public.planilla_jornadas_cargo FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_jornadas_cargo_update_admin"
    ON public.planilla_jornadas_cargo FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_jornadas_cargo_delete_admin"
    ON public.planilla_jornadas_cargo FOR DELETE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_jornadas_cargo ON public.planilla_jornadas_cargo;
CREATE TRIGGER tr_audit_planilla_jornadas_cargo
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_jornadas_cargo
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

COMMIT;
