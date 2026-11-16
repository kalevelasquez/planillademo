-- 1. Add email column to user_profiles
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS email VARCHAR;

-- 2. Backfill existing data from auth.users
UPDATE public.user_profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id;

-- 3. Update the handle_new_user function to insert email upon creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, full_name, role, tenant_id, email)
  VALUES (
    NEW.id, 
    NEW.raw_user_meta_data->>'full_name', 
    COALESCE(NEW.raw_user_meta_data->>'role', 'vendedor'),
    (NEW.raw_user_meta_data->>'tenant_id')::UUID,
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Update the sync_user_status function to keep email synchronized if changed
CREATE OR REPLACE FUNCTION sync_user_status()
RETURNS TRIGGER AS $$
BEGIN
    -- Synchronize email updates from auth.users
    IF NEW.email IS DISTINCT FROM OLD.email THEN
        UPDATE public.user_profiles
        SET email = NEW.email
        WHERE id = NEW.id;
    END IF;

    -- Synchronize status to ACTIVE when email_confirmed_at is populated
    IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
        UPDATE public.user_profiles
        SET status = 'ACTIVE'
        WHERE id = NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
