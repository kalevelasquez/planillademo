-- Migration: Auditoría de Roles, Permisos y Despachadores (US-AUD-06)
-- Autor: Antigravity — ImporFrut
-- Fecha: 2026-03-17
-- Descripción: Extiende el sistema de auditoría para incluir la matriz de permisos
--              y la gestión de despachadores, que no estaban siendo registrados.

BEGIN;

-- Añadir audit triggers a tablas faltantes
DO $$ 
DECLARE
    t text;
BEGIN
    -- Incluimos permission_matrix (Roles y Permisos) y dispatchers
    FOR t IN SELECT unnest(ARRAY['permission_matrix', 'dispatchers'])
    LOOP
        -- Eliminar trigger si ya existía para evitar duplicados
        EXECUTE format('DROP TRIGGER IF EXISTS tr_audit_%I ON public.%I', t, t);
        
        -- Crear el trigger de auditoría llamando a fn_capture_audit()
        -- Esta función ya maneja tenant_id, user_id y los valores old/new
        EXECUTE format('CREATE TRIGGER tr_audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit()', t, t);
    END LOOP;
END $$;

-- Asegurar que la función de semilla de permisos también está auditada (logs manuales si fuera necesario, 
-- pero como la semilla hace inserts, el trigger anterior ya lo capturará).

COMMIT;
