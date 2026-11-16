-- ============================================================
-- Migración: Optimización de Consultas de Auditoría (US-AUD-02)
-- Autor: @operador — ImporFrut
-- Fecha: 2026-03-17
-- Descripción: Añade índices específicos para los filtros de la UI
--              y verifica la consistencia de las políticas RLS.
-- ============================================================

BEGIN;

-- 1. ÍNDICES PARA FILTROS DE CA2 (Optimización de Rendimiento)
-- El filtro por tenant_id ya existe, pero necesitamos optimizar por campos de búsqueda comunes.
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log(action);
-- El índice idx_audit_log_resource ya cubre (resource_type, resource_id), pero resource_type solo es útil para búsquedas.
-- Note: resource_type es TEXT, se beneficia de B-TREE.

-- 2. VERIFICACIÓN Y REFUERZO DE RLS (CA1)
-- Aseguramos que solo Admin y Supervisor puedan leer. 
-- La política ya existe pero la "refrescamos" para asegurar que usa las funciones blindadas v3/final.
DROP POLICY IF EXISTS "audit_log_select_policy" ON public.audit_log;

CREATE POLICY "audit_log_select_policy_v2" ON public.audit_log
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id() 
    AND (
        'admin' = ANY(public.get_auth_roles()) 
        OR 'supervisor' = ANY(public.get_auth_roles())
    )
);

-- 3. PERMITIR INSERCIÓN AUTOMÁTICA (Triggers)
-- Las inserciones las hacen los triggers (SECURITY DEFINER), pero la política debe permitirlo.
DROP POLICY IF EXISTS "audit_log_insert_policy" ON public.audit_log;
CREATE POLICY "audit_log_insert_policy_v2" ON public.audit_log
FOR INSERT TO authenticated
WITH CHECK (tenant_id = public.get_auth_tenant_id());

COMMIT;
