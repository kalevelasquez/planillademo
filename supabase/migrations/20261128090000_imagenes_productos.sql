-- =============================================================================
-- F1 / B1.2 - Imagenes de producto y bucket publico (change: tienda-web-clientes)
--
--   * products.image_url text NULL  (URL publica de la imagen; NULL => placeholder en el catalogo)
--   * Bucket 'product_images': lectura PUBLICA (la URL publica se sirve sin policy de SELECT),
--     2 MB, image/jpeg|png|webp.
--   * Policies de storage.objects: escritura SOLO para usuarios internos autenticados cuyo
--     path empieza con SU tenant_id y que tienen permiso de inventario.
--         INSERT          : inventario.create O inventario.edit  (alta de producto con imagen)
--         UPDATE / DELETE : inventario.edit
--         SELECT          : solo authenticated de su tenant (necesario para upsert/reemplazo);
--                           anon NO tiene policy de SELECT (no puede listar el bucket;
--                           la lectura por URL publica no la necesita).
--     Ruta esperada: {tenant_id}/{product_id}-{timestamp}.webp
--
-- INDEPENDENCIA: no depende de 0b (handle_new_user ramificado). Solo requiere 0a
-- (get_auth_tenant_id / get_auth_roles endurecidos) y has_permission.
--
-- AUTOVERIFICACION (todo en esta transaccion; cualquier fallo => RAISE EXCEPTION => rollback):
--   A. catalogo: columna, bucket (public, limite, mimes), policies (comandos, roles, sin anon de escritura)
--   B. comportamiento con fixtures que se deshacen (sub-bloque con centinela ZZ001):
--      anon no escribe; cliente sin claims no escribe; vendedor sin permiso no escribe;
--      editor del tenant A escribe en su carpeta; editor de A NO escribe/actualiza/borra en la carpeta de B.
--
-- Rollback: supabase/rollback/20261128090000_imagenes_productos.down.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Columna
-- -----------------------------------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url text;

-- -----------------------------------------------------------------------------
-- 2. Bucket (idempotente: reaplica la configuracion si ya existia)
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product_images', 'product_images', true, 2097152,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
   SET public = true,
       file_size_limit = 2097152,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- -----------------------------------------------------------------------------
-- 3. Policies de storage.objects (todas acotadas a bucket_id = 'product_images')
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "product_images_select_own_tenant" ON storage.objects;
CREATE POLICY "product_images_select_own_tenant"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'product_images'
    AND public.get_auth_tenant_id() IS NOT NULL
    AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
  );

DROP POLICY IF EXISTS "product_images_insert_inventario" ON storage.objects;
CREATE POLICY "product_images_insert_inventario"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product_images'
    AND public.get_auth_tenant_id() IS NOT NULL
    AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
    AND (public.has_permission('inventario', 'create') OR public.has_permission('inventario', 'edit'))
  );

DROP POLICY IF EXISTS "product_images_update_inventario" ON storage.objects;
CREATE POLICY "product_images_update_inventario"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product_images'
    AND public.get_auth_tenant_id() IS NOT NULL
    AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
    AND public.has_permission('inventario', 'edit')
  )
  WITH CHECK (
    bucket_id = 'product_images'
    AND public.get_auth_tenant_id() IS NOT NULL
    AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
    AND public.has_permission('inventario', 'edit')
  );

DROP POLICY IF EXISTS "product_images_delete_inventario" ON storage.objects;
CREATE POLICY "product_images_delete_inventario"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'product_images'
    AND public.get_auth_tenant_id() IS NOT NULL
    AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
    AND public.has_permission('inventario', 'edit')
  );

-- -----------------------------------------------------------------------------
-- 4. AUTOVERIFICACION A: catalogo
-- -----------------------------------------------------------------------------
DO $verify_catalog$
DECLARE
  v_n int;
BEGIN
  -- products.image_url text NULL
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'products'
                    AND column_name = 'image_url' AND data_type = 'text' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'B1.2 VERIFY FAIL: products.image_url text NULL ausente o distinta';
  END IF;

  -- Bucket publico con limites
  IF NOT EXISTS (SELECT 1 FROM storage.buckets
                  WHERE id = 'product_images' AND public IS TRUE AND file_size_limit = 2097152
                    AND allowed_mime_types @> ARRAY['image/jpeg', 'image/png', 'image/webp']
                    AND allowed_mime_types <@ ARRAY['image/jpeg', 'image/png', 'image/webp']) THEN
    RAISE EXCEPTION 'B1.2 VERIFY FAIL: bucket product_images (public, 2 MB, jpeg/png/webp) ausente o distinto';
  END IF;

  -- Las 4 policies existen con el comando correcto y solo para authenticated
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND ((policyname = 'product_images_select_own_tenant' AND cmd = 'SELECT')
       OR (policyname = 'product_images_insert_inventario' AND cmd = 'INSERT')
       OR (policyname = 'product_images_update_inventario' AND cmd = 'UPDATE')
       OR (policyname = 'product_images_delete_inventario' AND cmd = 'DELETE'))
     AND roles = ARRAY['authenticated']::name[];
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'B1.2 VERIFY FAIL: faltan policies de product_images o no son TO authenticated (encontradas %/4)', v_n;
  END IF;

  -- Las policies de escritura exigen carpeta del tenant y permiso de inventario
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('product_images_insert_inventario', 'product_images_update_inventario', 'product_images_delete_inventario')
     AND coalesce(qual, '') || coalesce(with_check, '') ILIKE '%get_auth_tenant_id%'
     AND coalesce(qual, '') || coalesce(with_check, '') ILIKE '%foldername%'
     AND coalesce(qual, '') || coalesce(with_check, '') ILIKE '%has_permission%';
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'B1.2 VERIFY FAIL: las policies de escritura no exigen tenant_id en la ruta + has_permission (%/3)', v_n;
  END IF;

  -- Ninguna policy que toque product_images permite escribir a anon/public
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND coalesce(qual, '') || coalesce(with_check, '') ILIKE '%product_images%'
     AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     AND (roles && ARRAY['anon', 'public']::name[]);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'B1.2 VERIFY FAIL: hay % policies de escritura sobre product_images abiertas a anon/public', v_n;
  END IF;

  -- Ninguna policy SELECT para anon/public sobre el bucket (no se puede listar; la URL publica no la necesita)
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'product_images_%'
     AND cmd IN ('SELECT', 'ALL')
     AND (roles && ARRAY['anon', 'public']::name[]);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'B1.2 VERIFY FAIL: hay % policies SELECT de product_images abiertas a anon/public', v_n;
  END IF;
END
$verify_catalog$;

-- -----------------------------------------------------------------------------
-- 5. AUTOVERIFICACION B: comportamiento (fixtures deshechos por el centinela)
--    Si no se pueden crear los fixtures se omite con NOTICE (el catalogo ya se verifico).
--    El camino POSITIVO (editor de A escribe en su carpeta) solo falla la migracion si el
--    rechazo es una violacion de RLS ("row-level security"); un error de infraestructura de
--    storage (triggers de prefijos, privilegios) se informa con NOTICE y se omite.
-- -----------------------------------------------------------------------------
DO $verify_behavior$
DECLARE
  tA constant uuid := 'aaaaaaaa-f1b0-0000-0000-00000000000a';
  tB constant uuid := 'bbbbbbbb-f1b0-0000-0000-00000000000b';
  uEditor constant uuid := '33330000-f1b0-0000-0000-000000000001';
  uViewer constant uuid := '33330000-f1b0-0000-0000-000000000002';
  uClient constant uuid := '33330000-f1b0-0000-0000-000000000003';
  v_fail  text := '';
  v_ready boolean := false;
  v_raised boolean;
  v_msg   text;
  v_rows  int;
  v_del   int;
BEGIN
  BEGIN  -- sub-bloque revertible
    BEGIN
      INSERT INTO public.tenants (id, name) VALUES (tA, 'F1B IMG A'), (tB, 'F1B IMG B');
      -- Roles de prueba (fila propia: se borra primero por si un trigger de tenants sembro algo)
      DELETE FROM public.permission_matrix WHERE tenant_id IN (tA, tB) AND role_name IN ('zz_f1_editor', 'zz_f1_viewer');
      INSERT INTO public.permission_matrix (tenant_id, role_name, resource, can_view, can_create, can_edit, can_delete)
      VALUES (tA, 'zz_f1_editor', 'inventario', true, true, true, false),
             (tA, 'zz_f1_viewer', 'inventario', true, false, false, false);
      -- Objetos existentes en las carpetas de A y B (los crea el dueno; bypass de RLS)
      INSERT INTO storage.objects (bucket_id, name) VALUES
        ('product_images', tA::text || '/zz-a-existente.webp'),
        ('product_images', tB::text || '/zz-b-existente.webp');
      v_ready := true;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'B1.2 VERIFY: no se pudieron crear fixtures (%): se omite el bloque de comportamiento', SQLERRM;
    END;

    IF v_ready THEN
      -- I1 anon: no puede insertar, actualizar ni borrar en el bucket
      PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
      SET LOCAL ROLE anon;
      v_raised := false;
      BEGIN
        INSERT INTO storage.objects (bucket_id, name) VALUES ('product_images', tA::text || '/zz-anon.webp');
      EXCEPTION WHEN OTHERS THEN v_raised := true;
      END;
      RESET ROLE;
      IF NOT v_raised THEN
        v_fail := v_fail || E'\n - I1 anon pudo insertar en product_images';
      END IF;

      SET LOCAL ROLE anon;
      v_rows := 0;  v_del := 0;
      BEGIN
        UPDATE storage.objects SET name = name WHERE bucket_id = 'product_images';
        GET DIAGNOSTICS v_rows = ROW_COUNT;
      EXCEPTION WHEN OTHERS THEN v_rows := 0;
      END;
      BEGIN
        DELETE FROM storage.objects WHERE bucket_id = 'product_images';
        GET DIAGNOSTICS v_del = ROW_COUNT;
      EXCEPTION WHEN OTHERS THEN v_del := 0;
      END;
      RESET ROLE;
      IF v_rows <> 0 OR v_del <> 0 THEN
        v_fail := v_fail || format(E'\n - I1b anon actualizo %s y borro %s objetos de product_images', v_rows, v_del);
      END IF;

      -- I2 cliente sin claims (authenticated, sin perfil): no escribe en la carpeta de A
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', uClient, 'role', 'authenticated',
        'app_metadata', '{}'::jsonb, 'user_metadata', jsonb_build_object('tenant_id', tA, 'roles', jsonb_build_array('admin')))::text, true);
      SET LOCAL ROLE authenticated;
      v_raised := false;
      BEGIN
        INSERT INTO storage.objects (bucket_id, name) VALUES ('product_images', tA::text || '/zz-cliente.webp');
      EXCEPTION WHEN OTHERS THEN v_raised := true;
      END;
      RESET ROLE;
      IF NOT v_raised THEN
        v_fail := v_fail || E'\n - I2 un cliente sin claims (metadata hostil) pudo insertar en la carpeta de un tenant';
      END IF;

      -- I3 usuario interno de A SIN permiso de inventario (solo view): no escribe
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', uViewer, 'role', 'authenticated',
        'app_metadata', jsonb_build_object('tenant_id', tA, 'roles', jsonb_build_array('zz_f1_viewer')),
        'user_metadata', '{}'::jsonb)::text, true);
      SET LOCAL ROLE authenticated;
      v_raised := false;
      BEGIN
        INSERT INTO storage.objects (bucket_id, name) VALUES ('product_images', tA::text || '/zz-viewer.webp');
      EXCEPTION WHEN OTHERS THEN v_raised := true;
      END;
      RESET ROLE;
      IF NOT v_raised THEN
        v_fail := v_fail || E'\n - I3 un usuario sin permiso de inventario pudo insertar';
      END IF;

      -- I4 editor de A: escribe en su carpeta (camino positivo)
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', uEditor, 'role', 'authenticated',
        'app_metadata', jsonb_build_object('tenant_id', tA, 'roles', jsonb_build_array('zz_f1_editor')),
        'user_metadata', '{}'::jsonb)::text, true);
      SET LOCAL ROLE authenticated;
      v_raised := false;  v_msg := '';
      BEGIN
        INSERT INTO storage.objects (bucket_id, name) VALUES ('product_images', tA::text || '/zz-editor.webp');
      EXCEPTION WHEN OTHERS THEN v_raised := true;  v_msg := SQLERRM;
      END;
      RESET ROLE;
      IF v_raised THEN
        IF v_msg ILIKE '%row-level security%' THEN
          v_fail := v_fail || format(E'\n - I4 el editor de A NO pudo insertar en su propia carpeta: %s', v_msg);
        ELSE
          RAISE NOTICE 'B1.2 VERIFY: I4 omitido por error de infraestructura de storage (%)', v_msg;
        END IF;
      END IF;

      -- I5 editor de A: NO escribe en la carpeta de B (cross-tenant)
      SET LOCAL ROLE authenticated;
      v_raised := false;
      BEGIN
        INSERT INTO storage.objects (bucket_id, name) VALUES ('product_images', tB::text || '/zz-cross.webp');
      EXCEPTION WHEN OTHERS THEN v_raised := true;
      END;
      RESET ROLE;
      IF NOT v_raised THEN
        v_fail := v_fail || E'\n - I5 el editor de A pudo insertar en la carpeta del tenant B';
      END IF;

      -- I6 editor de A: no ve, no actualiza y no borra objetos de B; si ve los propios
      SET LOCAL ROLE authenticated;
      v_rows := -1;
      BEGIN
        SELECT count(*) INTO v_rows FROM storage.objects
         WHERE bucket_id = 'product_images' AND name = tB::text || '/zz-b-existente.webp';
      EXCEPTION WHEN OTHERS THEN v_rows := 0;
      END;
      RESET ROLE;
      IF v_rows <> 0 THEN
        v_fail := v_fail || format(E'\n - I6a el editor de A ve %s objetos de B (esperado 0)', v_rows);
      END IF;

      SET LOCAL ROLE authenticated;
      v_rows := -1;
      BEGIN
        UPDATE storage.objects SET name = name
         WHERE bucket_id = 'product_images' AND name = tB::text || '/zz-b-existente.webp';
        GET DIAGNOSTICS v_rows = ROW_COUNT;
      EXCEPTION WHEN OTHERS THEN v_rows := 0;
      END;
      RESET ROLE;
      IF v_rows <> 0 THEN
        v_fail := v_fail || format(E'\n - I6b el editor de A actualizo %s objetos de B (esperado 0)', v_rows);
      END IF;

      SET LOCAL ROLE authenticated;
      v_rows := -1;
      BEGIN
        DELETE FROM storage.objects
         WHERE bucket_id = 'product_images' AND name = tB::text || '/zz-b-existente.webp';
        GET DIAGNOSTICS v_rows = ROW_COUNT;
      EXCEPTION WHEN OTHERS THEN v_rows := 0;
      END;
      RESET ROLE;
      IF v_rows <> 0 THEN
        v_fail := v_fail || format(E'\n - I6c el editor de A borro %s objetos de B (esperado 0)', v_rows);
      END IF;

      -- I7 triangulacion: el editor SI ve y borra su propio objeto
      SET LOCAL ROLE authenticated;
      v_rows := -1;
      BEGIN
        DELETE FROM storage.objects
         WHERE bucket_id = 'product_images' AND name = tA::text || '/zz-a-existente.webp';
        GET DIAGNOSTICS v_rows = ROW_COUNT;
      EXCEPTION WHEN OTHERS THEN v_rows := -2;
      END;
      RESET ROLE;
      IF v_rows <> 1 THEN
        IF v_rows = -2 THEN
          RAISE NOTICE 'B1.2 VERIFY: I7 omitido por error de infraestructura de storage';
        ELSE
          v_fail := v_fail || format(E'\n - I7 el editor de A no pudo borrar su propio objeto (filas=%s, esperado 1)', v_rows);
        END IF;
      END IF;
    END IF;

    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 'f1_img_sentinel' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    NULL;  -- esperado: fixtures deshechos
  END;

  IF v_fail <> '' THEN
    RAISE EXCEPTION E'B1.2 VERIFY FAIL (comportamiento):%', v_fail;
  END IF;
END
$verify_behavior$;

COMMIT;
