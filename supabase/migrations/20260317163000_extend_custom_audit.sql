-- ============================================================
-- Migración: Extensión de Auditoría para Detalles Personalizados
-- Autor: @arquitecto — ImporFrut
-- Fecha: 2026-03-17
-- Descripción: Permite que log_custom_audit reciba un objeto JSONB 
--              de detalles para registrar información adicional 
--              (ej. formato de exportación, filtros aplicados).
-- ============================================================

CREATE OR REPLACE FUNCTION public.log_custom_audit(
    p_action public.audit_action,
    p_resource_type TEXT,
    p_resource_id UUID DEFAULT NULL,
    p_details JSONB DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_headers JSONB := current_setting('request.headers', true)::jsonb;
    v_tenant_id UUID := public.get_auth_tenant_id();
BEGIN
    INSERT INTO public.audit_log (
        tenant_id, 
        user_id, 
        user_email, 
        action, 
        resource_type, 
        resource_id,
        new_values, -- Almacenamos los detalles aquí para que sean visibles en el visor de cambios
        ip_address, 
        user_agent
    ) VALUES (
        v_tenant_id,
        auth.uid(),
        auth.jwt() ->> 'email',
        p_action,
        p_resource_type,
        p_resource_id,
        p_details,
        (v_headers ->> 'x-forwarded-for')::INET,
        v_headers ->> 'user-agent'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
