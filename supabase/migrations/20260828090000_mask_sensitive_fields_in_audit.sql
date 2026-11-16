-- Migration: Enmascarar campos sensibles de empleados en audit_log (IMPL-107 / US-SEC-07 CA3)
-- Author: @alexis
-- Description: US-SEC-07 CA1/CA3 — DUI, NIT y número de cuenta ya se enmascaran en pantalla
--              (SensitiveField.tsx, desde US-EMP-01/IMPL-3) y el historial de cambios ya los
--              enmascara al renderizar (HistorialCambiosSection.tsx). Pero el trigger
--              genérico fn_capture_audit guarda `to_jsonb(OLD)`/`to_jsonb(NEW)` completos —
--              el valor CRUDO de esas 3 columnas queda en texto plano dentro de
--              audit_log.old_values/new_values para CUALQUIER fila de planilla_empleados,
--              protegido solo por la RLS de esa tabla, no por el enmascarado visual.
--
--              Decisión (confirmada con el usuario): CA3 ("no aparece en texto plano... en
--              el detalle del log de auditoría") se interpreta a nivel de DATO almacenado,
--              no solo de presentación. Se extiende fn_capture_audit (CREATE OR REPLACE,
--              mismo cuerpo que 20260317113000_fix_audit_service_role_context.sql) para
--              remover esas 3 claves del JSONB antes del INSERT, únicamente cuando
--              TG_TABLE_NAME = 'planilla_empleados' — el resto de las ~40 tablas auditadas
--              por este mismo trigger no se ven afectadas.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_capture_audit()
RETURNS TRIGGER AS $$
DECLARE
    v_headers JSONB := current_setting('request.headers', true)::jsonb;
    v_user_id UUID := auth.uid();
    v_user_email TEXT := auth.jwt() ->> 'email';
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_action public.audit_action;
    v_old_values JSONB;
    v_new_values JSONB;
BEGIN
    v_action := CASE
        WHEN TG_OP = 'INSERT' THEN 'CREATE'::public.audit_action
        WHEN TG_OP = 'UPDATE' THEN 'UPDATE'::public.audit_action
        WHEN TG_OP = 'DELETE' THEN 'DELETE'::public.audit_action
        ELSE 'UPDATE'::public.audit_action
    END;

    IF v_tenant_id IS NULL THEN
        BEGIN
            IF TG_TABLE_NAME = 'tenants' THEN
                v_tenant_id := NEW.id;
            ELSE
                v_tenant_id := NEW.tenant_id;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            BEGIN
                IF TG_TABLE_NAME = 'tenants' THEN
                    v_tenant_id := OLD.id;
                ELSE
                    v_tenant_id := OLD.tenant_id;
                END IF;
            EXCEPTION WHEN OTHERS THEN
                NULL;
            END;
        END;
    END IF;

    IF v_user_id IS NULL THEN
        v_user_email := COALESCE(v_user_email, 'system-admin@imporfrut.com');
    END IF;

    v_old_values := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
    v_new_values := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;

    -- US-SEC-07 CA1/CA3: dui/nit/numero_cuenta nunca en texto plano en audit_log.
    IF TG_TABLE_NAME = 'planilla_empleados' THEN
        v_old_values := v_old_values - 'dui' - 'nit' - 'numero_cuenta';
        v_new_values := v_new_values - 'dui' - 'nit' - 'numero_cuenta';
    END IF;

    INSERT INTO public.audit_log (
        tenant_id, user_id, user_email, action, resource_type, resource_id,
        old_values, new_values, ip_address, user_agent
    ) VALUES (
        v_tenant_id, v_user_id, v_user_email,
        v_action,
        TG_TABLE_NAME,
        CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
        v_old_values,
        v_new_values,
        (v_headers ->> 'x-forwarded-for')::INET,
        v_headers ->> 'user-agent'
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Fallo en auditoría: %', SQLERRM;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
