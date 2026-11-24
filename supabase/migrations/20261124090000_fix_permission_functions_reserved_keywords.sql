-- Fix: has_permission / get_permission_scope rompían con acciones que son palabras reservadas.
--
-- Causa raíz: format('... can_%I ...', p_action) con %I cita los identificadores que son
-- palabras reservadas de Postgres. 'create' y 'delete' lo son, así que se generaba
-- `can_"create"` / `"delete"_scope` → ERROR 42601 syntax error at or near "create".
-- Efecto: cualquier INSERT con policy has_permission('<recurso>', 'create') fallaba (ej. clientes).
--
-- Solución: usar %s. Es seguro porque p_action se valida contra una whitelist cerrada
-- ANTES de construir la consulta, así que nunca llega texto arbitrario al SQL dinámico.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_permission_scope(
    p_resource TEXT,
    p_action TEXT -- 'view', 'edit', 'delete'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_scope TEXT;
    v_roles TEXT[];
    v_query TEXT;
BEGIN
    -- Whitelist obligatoria: es lo que hace seguro el %s de abajo
    IF p_action NOT IN ('view', 'edit', 'delete') THEN
        RETURN NULL;
    END IF;

    SELECT get_auth_roles() INTO v_roles;

    v_query := format(
        'SELECT scope FROM (
            SELECT %1$s_scope as scope,
                   CASE %1$s_scope
                     WHEN ''all'' THEN 3
                     WHEN ''team'' THEN 2
                     WHEN ''own'' THEN 1
                     ELSE 0
                   END as rank
            FROM public.permission_matrix
            WHERE tenant_id = get_auth_tenant_id()
            AND role_name = ANY($1)
            AND resource = $2
            AND can_%1$s = true
        ) s ORDER BY rank DESC LIMIT 1', p_action
    );

    EXECUTE v_query INTO v_scope USING v_roles, p_resource;

    RETURN v_scope;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_permission(
    p_resource TEXT,
    p_action TEXT -- 'view', 'create', 'edit', 'delete', 'export', 'approve'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_has BOOLEAN;
    v_roles TEXT[];
    v_query TEXT;
BEGIN
    -- Whitelist obligatoria: es lo que hace seguro el %s de abajo
    IF p_action NOT IN ('view', 'create', 'edit', 'delete', 'export', 'approve') THEN
        RETURN FALSE;
    END IF;

    SELECT get_auth_roles() INTO v_roles;

    v_query := format(
        'SELECT EXISTS (
            SELECT 1 FROM public.permission_matrix
            WHERE tenant_id = get_auth_tenant_id()
            AND role_name = ANY($1)
            AND resource = $2
            AND can_%s = true
        )', p_action
    );

    EXECUTE v_query INTO v_has USING v_roles, p_resource;

    RETURN COALESCE(v_has, false);
END;
$$;

COMMIT;
