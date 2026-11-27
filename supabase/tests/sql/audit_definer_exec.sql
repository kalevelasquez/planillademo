-- =============================================================================
-- audit_definer_exec.sql  (SOLO LECTURA, no modifica nada)
-- Change: tienda-web-clientes / tarea A0.4 (hallazgo H4)
--
-- Lista las funciones SECURITY DEFINER que pueden ejecutar `anon` y/o `authenticated`.
-- Cuando exista el signup de tienda, cualquier cliente registrado es `authenticated`,
-- asi que toda DEFINER ejecutable sin chequeo de tenant/permiso es un riesgo.
--
-- COMO CORRERLO (el usuario): SQL Editor de STAGING (y luego produccion), pegar y
-- ejecutar. Exportar el resultado (CSV) o pegar las filas en el chat para el triage.
-- La salida decide que funciones extra se blindan en la migracion 0c (tarea A2.2).
--
-- Como leer las columnas:
--   anon_exec / auth_exec   quien puede ejecutarla hoy
--   missing_search_path     true = DEFINER sin SET search_path (riesgo de hijacking)
--   has_auth_check          true = el cuerpo menciona get_auth_tenant_id/auth.uid/
--                           has_permission/assert_internal_user (heuristica, NO garantia)
--   risk                    CRITICO: anon puede ejecutar y no hay chequeo aparente
--                           ALTO:    authenticated puede ejecutar y no hay chequeo aparente
--                           REVISAR: tiene chequeo aparente pero falta search_path o es anon
--                           OK:      chequeo aparente + search_path fijo + sin anon
-- =============================================================================

SELECT *
FROM (
  SELECT
    n.nspname                                              AS schema,
    p.proname                                              AS function_name,
    pg_get_function_identity_arguments(p.oid)              AS args,
    pg_get_userbyid(p.proowner)                            AS owner,
    has_function_privilege('anon', p.oid, 'EXECUTE')       AS anon_exec,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
    NOT EXISTS (
      SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c WHERE c LIKE 'search_path=%'
    )                                                      AS missing_search_path,
    (   p.prosrc ILIKE '%get_auth_tenant_id%'
     OR p.prosrc ILIKE '%auth.uid()%'
     OR p.prosrc ILIKE '%has_permission%'
     OR p.prosrc ILIKE '%assert_internal_user%'
     OR p.prosrc ILIKE '%auth.role()%')                    AS has_auth_check,
    CASE
      WHEN has_function_privilege('anon', p.oid, 'EXECUTE')
       AND NOT (p.prosrc ILIKE '%get_auth_tenant_id%' OR p.prosrc ILIKE '%auth.uid()%'
             OR p.prosrc ILIKE '%has_permission%' OR p.prosrc ILIKE '%assert_internal_user%'
             OR p.prosrc ILIKE '%auth.role()%')              THEN 'CRITICO'
      WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND NOT (p.prosrc ILIKE '%get_auth_tenant_id%' OR p.prosrc ILIKE '%auth.uid()%'
             OR p.prosrc ILIKE '%has_permission%' OR p.prosrc ILIKE '%assert_internal_user%'
             OR p.prosrc ILIKE '%auth.role()%')              THEN 'ALTO'
      WHEN has_function_privilege('anon', p.oid, 'EXECUTE')
        OR NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c WHERE c LIKE 'search_path=%')
                                                             THEN 'REVISAR'
      ELSE 'OK'
    END                                                    AS risk
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef
    AND p.prokind = 'f'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'auth', 'storage', 'extensions',
                          'graphql', 'graphql_public', 'realtime', 'vault', 'pgsodium',
                          'pgsodium_masks', 'supabase_functions', 'supabase_migrations',
                          'net', 'pgbouncer', 'cron', 'pgtle', 'pg_toast')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')  -- no de extensiones
) f
WHERE f.anon_exec OR f.auth_exec
ORDER BY CASE f.risk WHEN 'CRITICO' THEN 0 WHEN 'ALTO' THEN 1 WHEN 'REVISAR' THEN 2 ELSE 3 END,
         f.schema, f.function_name;
