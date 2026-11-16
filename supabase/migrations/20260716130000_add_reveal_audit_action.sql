-- Migration: Nuevo valor de auditoría REVEAL (IMPL-3 / US-EMP-01 CA2)
-- Author: @alexis
-- Description: El perfil de empleado enmascara DUI, NIT y número de cuenta por defecto.
--              Revelarlos es una acción explícita que debe quedar auditada, distinta de
--              CREATE/UPDATE/DELETE. Se agrega al enum audit_action el mismo patrón usado
--              en 20260317000009_auth_audit_events.sql para LOGIN_FAILED/LOGOUT/etc.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.audit_action'::regtype AND enumlabel = 'REVEAL') THEN
        ALTER TYPE public.audit_action ADD VALUE 'REVEAL';
    END IF;
END $$;

COMMIT;
