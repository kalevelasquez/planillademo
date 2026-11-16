-- =============================================================================
-- MIGRACIÓN: saldo_horas_negativas_us_hex_11
-- =============================================================================
-- US-HEX-11 (IMPL-29) CA1: "Campo de seguimiento manual por empleado, actualizado
-- por el responsable de la ubicación" — saldo de horas negativas NO compensadas
-- que un empleado arrastra de una quincena a la siguiente, en ubicaciones sin
-- reloj marcador (Carga Manual de Horas).
--
-- CA2 (fórmula exacta de cómo este saldo se aplica/descuenta del total de horas
-- de la quincena actual) sigue BLOQUEADA (DRN §13, ítem #5) — esta migración
-- SOLO cubre CA1: un campo de tracking manual, sin ninguna lógica automática
-- de aplicación contra el motor de cálculo.
--
-- DISEÑO: tabla dedicada, no una columna más en `planilla_horas_extras_manual`.
-- Esa tabla está scoped a una quincena puntual (quincena_id); si el saldo
-- viviera ahí, cada quincena nueva arrancaría con el campo vacío y el
-- responsable tendría que ir a buscar el valor de la quincena anterior y
-- volver a tipearlo a mano — riesgo real de que se pierda el dato. Acá el
-- saldo es un valor CORRIENTE por empleado (no por quincena): sobrevive solo
-- de un período al siguiente, y el responsable lo ajusta cuando corresponda
-- (por ejemplo, al confirmar Horas Extras de la ubicación y detectar que el
-- empleado sigue debiendo horas, o que ya las compensó).
-- =============================================================================

BEGIN;

CREATE TABLE public.planilla_saldo_horas_negativas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id),
    saldo_horas NUMERIC NOT NULL DEFAULT 0 CHECK (saldo_horas >= 0),
    actualizado_por UUID,
    actualizado_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (empleado_id)
);

CREATE INDEX idx_planilla_saldo_horas_negativas_tenant ON public.planilla_saldo_horas_negativas (tenant_id);

ALTER TABLE public.planilla_saldo_horas_negativas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_saldo_horas_negativas_select_tenant"
    ON public.planilla_saldo_horas_negativas FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

-- Sin dependencia de quincena_modulo_ubicacion_estado a propósito: este saldo
-- no vive scoped a una quincena ni a su estado de cierre, así que no aplica
-- el mismo guard de "módulo no confirmado" que usa planilla_horas_extras_manual.
CREATE POLICY "planilla_saldo_horas_negativas_insert_admin_preparador"
    ON public.planilla_saldo_horas_negativas FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_saldo_horas_negativas_update_admin_preparador"
    ON public.planilla_saldo_horas_negativas FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

COMMIT;
