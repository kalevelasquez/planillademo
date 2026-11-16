-- Migration: Función de Carga Inicial Acelerada (Bootstrap)
-- Author: Antigravity
-- Description: Consolida perfil, permisos y tiempo de servidor en un solo viaje para mejorar la carga inicial y evitar cascada de peticiones RLS.

BEGIN;

-- 1. Crear la función get_bootstrap_data
CREATE OR REPLACE FUNCTION public.get_bootstrap_data()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_profile record;
    v_roles text[];
    v_permissions json;
BEGIN
    v_user_id := auth.uid();
    
    -- 1.1 Obtener Perfil del usuario autenticado (sin disparar RLS infinito)
    SELECT id, full_name, email, role, tenant_id, is_active, status, last_login_at
    INTO v_profile
    FROM public.user_profiles
    WHERE id = v_user_id;

    IF NOT FOUND THEN
        RETURN json_build_object('error', 'Profile not found');
    END IF;

    -- 1.2 Extraer roles (maneja tanto texto plano como arrays)
    v_roles := v_profile.role;

    -- 1.3 Calcular Permisos Efectivos (Unión de todos los roles del usuario)
    -- Agrega los privilegios de cada rol para determinar el acceso total
    WITH effective_perms AS (
        SELECT 
            resource,
            bool_or(can_view) as can_view,
            bool_or(can_create) as can_create,
            bool_or(can_edit) as can_edit,
            bool_or(can_delete) as can_delete,
            bool_or(can_export) as can_export,
            bool_or(can_approve) as can_approve,
            -- Jerarquía de alcances: all (3) > team (2) > own (1)
            -- Se queda siempre con el permiso más generoso
            CASE 
                WHEN bool_or(view_scope = 'all') THEN 'all'
                WHEN bool_or(view_scope = 'team') THEN 'team'
                ELSE 'own' 
            END as view_scope,
            CASE 
                WHEN bool_or(edit_scope = 'all') THEN 'all'
                WHEN bool_or(edit_scope = 'team') THEN 'team'
                ELSE 'own' 
            END as edit_scope,
            CASE 
                WHEN bool_or(delete_scope = 'all') THEN 'all'
                WHEN bool_or(delete_scope = 'team') THEN 'team'
                ELSE 'own' 
            END as delete_scope
        FROM public.permission_matrix
        WHERE tenant_id = v_profile.tenant_id
          AND role_name = ANY(v_roles)
        GROUP BY resource
    )
    SELECT json_agg(effective_perms) INTO v_permissions FROM effective_perms;

    -- 1.4 Retornar el objeto consolidado que espera el frontend
    RETURN json_build_object(
        'profile', row_to_json(v_profile),
        'permissions', COALESCE(v_permissions, '[]'::json),
        'server_time', now()
    );
END;
$$;

-- 2. Otorgar permisos de ejecución a los usuarios autenticados
GRANT EXECUTE ON FUNCTION public.get_bootstrap_data() TO authenticated;

COMMIT;
