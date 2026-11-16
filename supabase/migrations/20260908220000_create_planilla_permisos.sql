-- Migration: Permisos de empleados (IMPL-163 / US-PER-00, US-PER-01)
-- Author: @alexis
-- Description: Cada fila es UN día calendario para UN empleado, no un rango — necesario
--              porque la granularidad (día completo / medio día / horas) puede variar día a
--              día dentro de un mismo trámite (ej. "la tarde de hoy" + "todo el día de
--              mañana", CA2 de US-PER-01). `grupo_id` agrupa visualmente las filas de un mismo
--              trámite multi-día sin acoplar su edición/borrado — cada fila se edita/borra
--              independientemente, mismo criterio que `planilla_incapacidades`.
--
--              Sin RPC propio — INSERT/UPDATE/DELETE directo protegido por RLS (mismo patrón
--              que `planilla_incapacidades`, 20260801090000): no hay ningún campo derivado que
--              calcular server-side al escribir.
--
--              Sin UNIQUE(empleado_id, fecha): un mismo día puede tener 2 filas legítimas
--              (medio día mañana con_goce + medio día tarde sin_goce).
--
--              FUERA DE ALCANCE (historia futura, no parte de IMPL-164/165): el motor de
--              cálculo (`calcular_planilla_empleado`) todavía no lee esta tabla — CA4 de
--              US-PER-01 ("sin goce se descuenta del cálculo de la quincena") queda pendiente
--              de ese enganche, que no está definido en los criterios de aceptación actuales.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_permisos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    quincena_id UUID NOT NULL REFERENCES public.quincenas(id) ON DELETE CASCADE,
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id),
    grupo_id UUID NOT NULL DEFAULT gen_random_uuid(),
    fecha DATE NOT NULL,
    granularidad TEXT NOT NULL CHECK (granularidad IN ('dia_completo', 'medio_dia', 'horas')),
    turno TEXT CHECK (turno IN ('manana', 'tarde')),
    horas NUMERIC(4,2) CHECK (horas IS NULL OR (horas > 0 AND horas <= 24)),
    tipo TEXT NOT NULL CHECK (tipo IN ('con_goce', 'sin_goce')),
    motivo TEXT NOT NULL CHECK (btrim(motivo) <> ''),
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,

    CONSTRAINT planilla_permisos_granularidad_consistente CHECK (
        (granularidad = 'dia_completo' AND turno IS NULL AND horas IS NULL) OR
        (granularidad = 'medio_dia'    AND turno IS NOT NULL AND horas IS NULL) OR
        (granularidad = 'horas'        AND turno IS NULL AND horas IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_planilla_permisos_quincena ON public.planilla_permisos(quincena_id);
CREATE INDEX IF NOT EXISTS idx_planilla_permisos_grupo ON public.planilla_permisos(grupo_id);

ALTER TABLE public.planilla_permisos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_permisos_select_tenant"
    ON public.planilla_permisos FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_permisos_insert_quincena_en_proceso"
    ON public.planilla_permisos FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

CREATE POLICY "planilla_permisos_update_quincena_en_proceso"
    ON public.planilla_permisos FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_permisos_delete_quincena_en_proceso"
    ON public.planilla_permisos FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_permisos ON public.planilla_permisos;
CREATE TRIGGER tr_audit_planilla_permisos
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_permisos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

COMMIT;
