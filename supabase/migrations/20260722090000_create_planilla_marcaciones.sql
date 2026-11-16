-- Migration: Marcaciones Validadas + Vínculo con Reloj Marcador (IMPL-20 / US-HEX-04)
-- Author: @alexis
-- Description: (1) Agrega `codigo_reloj_marcador` a `planilla_empleados` — no existía ningún
--              campo que vinculara un empleado con el ID que usa su reloj marcador físico,
--              necesario para CA1 (empleado no encontrado → Error). (2) Crea
--              `planilla_marcaciones`, la primera tabla que persiste datos reales de Horas
--              Extras — solo se escribe UNA vez, al confirmar la importación ya validada
--              (CA8); no hay UPDATE porque toda edición ocurre en memoria antes de ese único
--              INSERT. RLS bloquea INSERT/DELETE una vez que `quincena_modulo_estado` para
--              'horas_extras' de esa quincena ya está 'confirmado' — reabrir para corregir
--              es alcance de re-apertura (IMPL-102), no de esta historia.

BEGIN;

ALTER TABLE public.planilla_empleados ADD COLUMN IF NOT EXISTS codigo_reloj_marcador TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_planilla_empleados_codigo_reloj
    ON public.planilla_empleados (tenant_id, codigo_reloj_marcador)
    WHERE codigo_reloj_marcador IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.planilla_marcaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    quincena_id UUID NOT NULL REFERENCES public.quincenas(id) ON DELETE CASCADE,
    ubicacion_id UUID NOT NULL REFERENCES public.planilla_ubicaciones(id),
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id),
    entrada TIMESTAMP NOT NULL,
    salida TIMESTAMP NOT NULL CHECK (salida > entrada),
    id_usuario_archivo TEXT NOT NULL,
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planilla_marcaciones_quincena ON public.planilla_marcaciones(quincena_id);
CREATE INDEX IF NOT EXISTS idx_planilla_marcaciones_empleado ON public.planilla_marcaciones(empleado_id);

ALTER TABLE public.planilla_marcaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_marcaciones_select_tenant"
    ON public.planilla_marcaciones FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_marcaciones_insert_modulo_no_confirmado"
    ON public.planilla_marcaciones FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND NOT EXISTS (
            SELECT 1 FROM public.quincena_modulo_estado qme
            WHERE qme.quincena_id = planilla_marcaciones.quincena_id
              AND qme.modulo = 'horas_extras'
              AND qme.estado = 'confirmado'
        )
    );

CREATE POLICY "planilla_marcaciones_delete_modulo_no_confirmado"
    ON public.planilla_marcaciones FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND NOT EXISTS (
            SELECT 1 FROM public.quincena_modulo_estado qme
            WHERE qme.quincena_id = planilla_marcaciones.quincena_id
              AND qme.modulo = 'horas_extras'
              AND qme.estado = 'confirmado'
        )
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_marcaciones ON public.planilla_marcaciones;
CREATE TRIGGER tr_audit_planilla_marcaciones
    AFTER INSERT OR DELETE ON public.planilla_marcaciones
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

COMMIT;
