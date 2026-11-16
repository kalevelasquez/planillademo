-- 1. Agregar columna status a auth.users via public.profiles (o user_profiles según tu esquema)
-- Nota: Ajusta 'public.profiles' a 'public.user_profiles' si esa es la tabla que usas actualmente.
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'PENDING';

-- Actualizar filas existentes a ACTIVE si ya estaban confirmadas
UPDATE public.user_profiles p
SET status = 'ACTIVE'
FROM auth.users u
WHERE p.id = u.id AND u.email_confirmed_at IS NOT NULL;

-- 2. Asegurar ON DELETE CASCADE en la Foreign Key para que el Delete-then-Invite funcione
-- Si tu Foreign Key tiene otro nombre, reemplaza 'user_profiles_id_fkey' por el nombre real.
ALTER TABLE public.user_profiles
DROP CONSTRAINT IF EXISTS user_profiles_id_fkey;

ALTER TABLE public.user_profiles
ADD CONSTRAINT user_profiles_id_fkey
FOREIGN KEY (id)
REFERENCES auth.users(id)
ON DELETE CASCADE;

-- 3. Crear la función sincronizadora
CREATE OR REPLACE FUNCTION sync_user_status()
RETURNS TRIGGER AS $$
BEGIN
    -- Si el email es confirmado (cambia de nulo a una fecha válida)
    IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
        UPDATE public.user_profiles
        SET status = 'ACTIVE'
        WHERE id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Crear el Trigger en auth.users
DROP TRIGGER IF EXISTS on_user_confirmed_update_profile ON auth.users;

CREATE TRIGGER on_user_confirmed_update_profile
AFTER UPDATE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION sync_user_status();
