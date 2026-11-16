-- Migration: Enable Realtime for Orders Notification (US-HIS-03 CA4)
-- Author: @arquitecto / Antigravity
-- Date: 2026-03-20

BEGIN;

-- 1. Habilitar el seguimiento de cambios completos en la tabla orders
-- Esto permite que el payload.old en JS tenga todos los datos para comparar estados
ALTER TABLE public.orders REPLICA IDENTITY FULL;

-- 2. Asegurar que la publicación supabase_realtime incluya las tablas necesarias
-- Nota: Usamos un bloque anónimo para evitar errores si ya existen en la publicación
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        -- Intentar añadir la tabla, ignorando si ya está
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Table orders already in publication or error: %', SQLERRM;
        END;

        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.user_profiles;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Table user_profiles already in publication or error: %', SQLERRM;
        END;
    END IF;
END $$;

COMMIT;
