-- Migration: Nuevos valores de auditoría para acciones críticas de Planilla (IMPL-107 / US-AUD-06)
-- Author: @alexis
-- Description: US-AUD-06 CA1 — mismo patrón ya usado 2 veces en el proyecto para extender
--              el enum audit_action sin tabla nueva (20260317000009_auth_audit_events.sql
--              para LOGIN_FAILED/LOGOUT/etc., 20260716130000_add_reveal_audit_action.sql
--              para REVEAL). CA3 ya se cumple con esto solo: se reutiliza audit_log/
--              log_custom_audit tal cual, cero tablas nuevas para Planilla.
--
--              Estas acciones se loguean client-side (mismo criterio que REVEAL en
--              SensitiveField.tsx) inmediatamente después de que el RPC/mutación real
--              tiene éxito — nunca antes, para no auditar una acción que falló.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.audit_action'::regtype AND enumlabel = 'CIERRE') THEN
        ALTER TYPE public.audit_action ADD VALUE 'CIERRE';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.audit_action'::regtype AND enumlabel = 'RE_APERTURA') THEN
        ALTER TYPE public.audit_action ADD VALUE 'RE_APERTURA';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.audit_action'::regtype AND enumlabel = 'APROBACION') THEN
        ALTER TYPE public.audit_action ADD VALUE 'APROBACION';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.audit_action'::regtype AND enumlabel = 'RECHAZO') THEN
        ALTER TYPE public.audit_action ADD VALUE 'RECHAZO';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.audit_action'::regtype AND enumlabel = 'SUSPENSION_DESCUENTO') THEN
        ALTER TYPE public.audit_action ADD VALUE 'SUSPENSION_DESCUENTO';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.audit_action'::regtype AND enumlabel = 'EDICION_SUELDO') THEN
        ALTER TYPE public.audit_action ADD VALUE 'EDICION_SUELDO';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.audit_action'::regtype AND enumlabel = 'CONFIRMACION_MODULO') THEN
        ALTER TYPE public.audit_action ADD VALUE 'CONFIRMACION_MODULO';
    END IF;
END $$;

COMMIT;
