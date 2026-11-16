-- ============================================================
-- Migración: Sincronización de Último Login (US-AUD-04)
-- Autor: @operador — ImporFrut
-- Fecha: 2026-03-17
-- Descripción: Activa el trigger para sincronizar last_sign_in_at 
--              desde auth.users hacia public.user_profiles.
-- ============================================================

BEGIN;

-- 1. CREACIÓN DEL TRIGGER EN AUTH.USERS
-- Nota: La función public.sync_user_status_and_login ya fue definida
-- en la migración US-AUTH-06 (20260312180000_multi_role_support.sql).

DROP TRIGGER IF EXISTS tr_sync_auth_user ON auth.users;

CREATE TRIGGER tr_sync_auth_user
AFTER UPDATE ON auth.users
FOR EACH ROW
WHEN (
    OLD.last_sign_in_at IS DISTINCT FROM NEW.last_sign_in_at 
    OR OLD.email IS DISTINCT FROM NEW.email
)
EXECUTE FUNCTION public.sync_user_status_and_login();

-- 2. BACKFILL: Sincronizar datos históricos
-- Asegura que los usuarios que ya han iniciado sesión tengan su fecha reflejada.
UPDATE public.user_profiles up
SET last_login_at = au.last_sign_in_at
FROM auth.users au
WHERE up.id = au.id
  AND au.last_sign_in_at IS NOT NULL;

COMMIT;
