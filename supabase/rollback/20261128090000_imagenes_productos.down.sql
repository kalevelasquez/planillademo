-- =============================================================================
-- ROLLBACK de 20261128090000_imagenes_productos.sql (F1 / B1.2)
--
-- Se aplica como MIGRACION HACIA ADELANTE (copiar a supabase/migrations con un timestamp nuevo).
-- ORDEN: si 20261128100000_rpcs_catalogo_tienda esta aplicada, revertirla ANTES
-- (las RPCs leen products.image_url).
--
--   * Quita las policies de product_images.
--   * El bucket NO se borra (Supabase bloquea el DELETE directo sobre storage.* y se perderian
--     las imagenes): se deja PRIVADO. Borrarlo, si se quiere, es via Storage API/dashboard.
--   * Elimina products.image_url (se pierden las URLs guardadas; los archivos siguen en el bucket).
-- Autoverificable.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS "product_images_select_own_tenant" ON storage.objects;
DROP POLICY IF EXISTS "product_images_insert_inventario" ON storage.objects;
DROP POLICY IF EXISTS "product_images_update_inventario" ON storage.objects;
DROP POLICY IF EXISTS "product_images_delete_inventario" ON storage.objects;

UPDATE storage.buckets SET public = false WHERE id = 'product_images';

ALTER TABLE public.products DROP COLUMN IF EXISTS image_url;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
              AND policyname LIKE 'product_images_%') THEN
    RAISE EXCEPTION 'B1.2 DOWN VERIFY FAIL: quedan policies de product_images';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'product_images' AND public) THEN
    RAISE EXCEPTION 'B1.2 DOWN VERIFY FAIL: el bucket product_images sigue publico';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'image_url') THEN
    RAISE EXCEPTION 'B1.2 DOWN VERIFY FAIL: products.image_url sigue existiendo';
  END IF;
END
$verify$;

COMMIT;
