-- Migration to secure UPDATE operations on user_profiles
-- 1. Create function to validate profile updates
CREATE OR REPLACE FUNCTION public.check_admin_profile_update()
RETURNS TRIGGER AS $$
DECLARE
    v_updater_role TEXT;
BEGIN
    -- 1. Protect critical columns from being changed
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Not allowed to change user Profile ID';
    END IF;

    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
        RAISE EXCEPTION 'Not allowed to change user Tenant ID';
    END IF;

    -- 2. If it's another user's profile or if the role is being changed
    -- Only ADMIN can perform this action
    IF NEW.id != auth.uid() OR NEW.role IS DISTINCT FROM OLD.role THEN
        -- Get the role of the user performing the update
        SELECT role INTO v_updater_role 
        FROM public.user_profiles 
        WHERE id = auth.uid();
        
        IF v_updater_role IS DISTINCT FROM 'ADMIN' THEN
            RAISE EXCEPTION 'Solo un Administrador puede actualizar roles y modificar perfiles de otros empleados';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create the trigger on user_profiles
DROP TRIGGER IF EXISTS tr_check_admin_profile_update ON public.user_profiles;
CREATE TRIGGER tr_check_admin_profile_update
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.check_admin_profile_update();
