-- Remove blocking triggers and functions from previous migration
DROP TRIGGER IF EXISTS tr_check_admin_profile_update ON public.user_profiles;
DROP FUNCTION IF EXISTS public.check_admin_profile_update();

-- Remove any old policies for UPDATE
DROP POLICY IF EXISTS "Admins can update profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Enable update for users based on email" ON public.user_profiles;
DROP POLICY IF EXISTS "Admins can update colleagues" ON public.user_profiles;

-- Create robust permissive policy for ADMINS to update profiles in their tenant
CREATE POLICY "Admins can update colleagues"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_profiles AS me
        WHERE me.id = auth.uid()
        AND me.role = 'admin' -- lowercase role validation
        AND me.tenant_id = public.user_profiles.tenant_id -- Must be in same tenant
    )
);
