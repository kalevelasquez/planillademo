-- Migration: Certificados de Incapacidad (IMPL-41 / US-INC-01)
-- Author: @alexis
-- Description: Registro de certificados de incapacidad (CIT). La cobertura/subsidio
--              (con_subsidio, dias_cubiertos_imporfrut, dia_inicio_subsidio_isss) se calcula
--              SIEMPRE de forma automática y estricta (CA5 — sin excepción manual posible) vía
--              `calcularCoberturaIncapacidad` en el cliente, y se persiste como snapshot al
--              momento del registro (no se recalcula en cada lectura) — mismo criterio que
--              `monto_total` en horas extras/viáticos: si la regla de negocio cambia en el
--              futuro, los registros ya emitidos conservan el cálculo vigente al momento de
--              crearse, no se reinterpretan retroactivamente. `trabajo_durante_incapacidad` +
--              `monto_bono_trabajado` son de US-INC-04 (Bono 10%) — la línea de ISR real que
--              consume ese monto depende del Motor de Cálculo (IMPL-85), que no existe todavía.
--              El módulo 'incapacidades' del checklist de quincena ya existía preparado desde
--              IMPL-16 (quincena_modulo_estado) — no hace falta tocar esa tabla.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_incapacidades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    quincena_id UUID NOT NULL REFERENCES public.quincenas(id) ON DELETE CASCADE,
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id),
    numero_cit TEXT NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL CHECK (fecha_fin >= fecha_inicio),
    tipo TEXT NOT NULL CHECK (tipo IN ('enfermedad_comun', 'accidente_trabajo', 'maternidad')),
    dias INT NOT NULL CHECK (dias > 0),
    con_subsidio BOOLEAN NOT NULL,
    dias_cubiertos_imporfrut INT NOT NULL DEFAULT 0 CHECK (dias_cubiertos_imporfrut >= 0),
    dia_inicio_subsidio_isss INT,
    trabajo_durante_incapacidad BOOLEAN NOT NULL DEFAULT false,
    monto_bono_trabajado NUMERIC CHECK (monto_bono_trabajado >= 0),
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planilla_incapacidades_quincena ON public.planilla_incapacidades(quincena_id);

ALTER TABLE public.planilla_incapacidades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_incapacidades_select_tenant"
    ON public.planilla_incapacidades FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_incapacidades_insert_quincena_en_proceso"
    ON public.planilla_incapacidades FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

CREATE POLICY "planilla_incapacidades_update_quincena_en_proceso"
    ON public.planilla_incapacidades FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_incapacidades_delete_quincena_en_proceso"
    ON public.planilla_incapacidades FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_incapacidades ON public.planilla_incapacidades;
CREATE TRIGGER tr_audit_planilla_incapacidades
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_incapacidades
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- US-INC-02 (IMPL-44) — reutiliza el mecanismo de adjuntos de Viáticos (US-VIA-08), no lo
-- duplica: solo se extiende el CHECK de `tipo_registro` para aceptar 'incapacidad'. El nombre
-- del constraint sigue la convención por defecto de Postgres para CHECK inline sin nombre
-- (<tabla>_<columna>_check); si no coincidiera al aplicar, hay que resolverlo dinámicamente
-- (ver precedente en 20260317160000_allow_negative_stock.sql).
ALTER TABLE public.planilla_viatico_documentos
    DROP CONSTRAINT IF EXISTS planilla_viatico_documentos_tipo_registro_check;
ALTER TABLE public.planilla_viatico_documentos
    ADD CONSTRAINT planilla_viatico_documentos_tipo_registro_check
    CHECK (tipo_registro IN ('por_ruta', 'fijos_variables', 'kilometraje', 'incapacidad'));

COMMIT;
