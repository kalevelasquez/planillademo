-- Migration: permitir editar Feriados y Días Exentos de Penalización (defecto UAT, 2026-09-02)
-- Author: @alexis
-- Description: `planilla_feriados` y `planilla_dias_exentos_penalizacion` solo tenían policies
--              de INSERT/DELETE — no existía forma de editar un registro ya creado (corregir una
--              fecha o el nombre/nota sin borrar y volver a dar de alta). Se agrega la policy de
--              UPDATE (mismo criterio admin-only que INSERT/DELETE) y se extiende el trigger de
--              auditoría de ambas tablas para capturar también el evento UPDATE.

BEGIN;

CREATE POLICY "planilla_feriados_update_admin"
    ON public.planilla_feriados FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_dias_exentos_update_admin"
    ON public.planilla_dias_exentos_penalizacion FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_feriados ON public.planilla_feriados;
CREATE TRIGGER tr_audit_planilla_feriados
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_feriados
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

DROP TRIGGER IF EXISTS tr_audit_planilla_dias_exentos ON public.planilla_dias_exentos_penalizacion;
CREATE TRIGGER tr_audit_planilla_dias_exentos
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_dias_exentos_penalizacion
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

COMMIT;
