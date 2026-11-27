-- =============================================================================
-- F1 / B1.3 - RPCs del catalogo publico de la tienda (change: tienda-web-clientes)
--
--   store_list_products(p_tenant_id, p_search, p_limit, p_offset)
--   store_get_product(p_tenant_id, p_product_key)
--
-- Contrato (spec store-public-catalog):
--   * SECURITY DEFINER + search_path fijo; EXECUTE solo para anon y authenticated (REVOKE a PUBLIC).
--   * Solo tenants con store_enabled (y activos), validado en servidor.
--   * Solo columnas seguras: product_key (md5 opaco), name, caliber, quality, price, image_url,
--     availability ('Disponible'|'Agotado'). NUNCA cantidades, costos, proveedor, marca, lotes ni ids.
--   * Agrupado por nombre+calibre+calidad (products guarda UN LOTE por fila); el precio y la imagen
--     salen del lote activo mas antiguo con stock (o del mas reciente si esta agotado).
--   * Productos inactivos no aparecen. p_limit se acota a 1..100; p_search se escapa (LIKE seguro).
--   * Detalle inexistente / otro tenant / tienda deshabilitada => 0 filas.
--
-- Funcion interna store_catalog_groups(uuid): SIN EXECUTE para anon/authenticated; solo la llaman
-- las dos RPCs (DEFINER, mismo dueno).
--
-- INDEPENDENCIA DE 0b: esta migracion crea tenants.store_enabled y su indice unico parcial con
-- IF NOT EXISTS y las MISMAS definiciones que 0b (20261127100000), de modo que 0b es un no-op
-- sobre ese esquema cuando se aplique despues.
--
-- AUTOVERIFICACION (cualquier fallo => RAISE EXCEPTION => rollback total):
--   A. catalogo: columna/indice, columnas del RETURNS, DEFINER, search_path, STABLE, grants
--   B. comportamiento con fixtures que se deshacen (centinela ZZ001): payload, agrupacion, precio
--      del lote antiguo, Agotado, inactivo, tienda deshabilitada/inexistente, busqueda, limites,
--      acceso directo a products como anon, detalle inexistente/cross-tenant.
--
-- Rollback: supabase/rollback/20261128100000_rpcs_catalogo_tienda.down.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Esquema necesario (idempotente, identico a 0b)
-- -----------------------------------------------------------------------------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS store_enabled boolean NOT NULL DEFAULT false;

-- A lo sumo UN tenant con tienda habilitada (v1).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_single_store_enabled
  ON public.tenants ((true)) WHERE store_enabled;

-- -----------------------------------------------------------------------------
-- 2. Funcion interna: grupos del catalogo de un tenant habilitado
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.store_catalog_groups(p_tenant_id uuid)
RETURNS TABLE (
  product_key  text,
  name         text,
  caliber      text,
  quality      text,
  price        numeric,
  image_url    text,
  availability text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH lots AS (
    SELECT
      md5(lower(p.name) || '|' || coalesce(p.caliber, '') || '|' || coalesce(p.quality, '')) AS k,
      p.name, p.caliber, p.quality, p.price, p.image_url,
      p.available_quantity AS q,
      (p.available_quantity > 0) AS has_stock,
      p.entry_date, p.created_at
    FROM public.products p
    JOIN public.tenants t ON t.id = p.tenant_id
    WHERE p.tenant_id = p_tenant_id
      AND t.store_enabled
      AND coalesce(t.is_active, true)
      AND p.status = 'active'
  )
  SELECT
    l.k AS product_key,
    -- nombre/calibre/calidad/precio del lote "representativo":
    -- con stock primero, el mas antiguo; sin stock, el mas reciente
    (array_agg(l.name    ORDER BY l.has_stock DESC,
                CASE WHEN l.has_stock THEN l.entry_date END ASC NULLS LAST,
                CASE WHEN l.has_stock THEN l.created_at END ASC NULLS LAST,
                l.entry_date DESC NULLS LAST, l.created_at DESC NULLS LAST))[1] AS name,
    (array_agg(l.caliber ORDER BY l.has_stock DESC,
                CASE WHEN l.has_stock THEN l.entry_date END ASC NULLS LAST,
                CASE WHEN l.has_stock THEN l.created_at END ASC NULLS LAST,
                l.entry_date DESC NULLS LAST, l.created_at DESC NULLS LAST))[1] AS caliber,
    (array_agg(l.quality ORDER BY l.has_stock DESC,
                CASE WHEN l.has_stock THEN l.entry_date END ASC NULLS LAST,
                CASE WHEN l.has_stock THEN l.created_at END ASC NULLS LAST,
                l.entry_date DESC NULLS LAST, l.created_at DESC NULLS LAST))[1] AS quality,
    (array_agg(l.price   ORDER BY l.has_stock DESC,
                CASE WHEN l.has_stock THEN l.entry_date END ASC NULLS LAST,
                CASE WHEN l.has_stock THEN l.created_at END ASC NULLS LAST,
                l.entry_date DESC NULLS LAST, l.created_at DESC NULLS LAST))[1] AS price,
    -- imagen: la del mismo orden, pero la primera que no sea NULL
    (array_agg(l.image_url ORDER BY l.has_stock DESC,
                CASE WHEN l.has_stock THEN l.entry_date END ASC NULLS LAST,
                CASE WHEN l.has_stock THEN l.created_at END ASC NULLS LAST,
                l.entry_date DESC NULLS LAST, l.created_at DESC NULLS LAST)
       FILTER (WHERE l.image_url IS NOT NULL AND btrim(l.image_url) <> ''))[1] AS image_url,
    CASE WHEN sum(l.q) > 0 THEN 'Disponible' ELSE 'Agotado' END AS availability
  FROM lots l
  GROUP BY l.k;
$$;

REVOKE ALL ON FUNCTION public.store_catalog_groups(uuid) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. RPCs publicas
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.store_list_products(
  p_tenant_id uuid,
  p_search    text DEFAULT NULL,
  p_limit     int  DEFAULT 48,
  p_offset    int  DEFAULT 0
)
RETURNS TABLE (
  product_key  text,
  name         text,
  caliber      text,
  quality      text,
  price        numeric,
  image_url    text,
  availability text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT g.product_key, g.name, g.caliber, g.quality, g.price, g.image_url, g.availability
  FROM public.store_catalog_groups(p_tenant_id) g
  WHERE nullif(btrim(coalesce(p_search, '')), '') IS NULL
     OR g.name    ILIKE '%' || replace(replace(replace(left(btrim(p_search), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%'
     OR g.caliber ILIKE '%' || replace(replace(replace(left(btrim(p_search), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%'
     OR g.quality ILIKE '%' || replace(replace(replace(left(btrim(p_search), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  ORDER BY g.name, g.caliber, g.quality, g.product_key
  LIMIT greatest(1, least(coalesce(p_limit, 48), 100))
  OFFSET greatest(0, coalesce(p_offset, 0));
$$;

CREATE OR REPLACE FUNCTION public.store_get_product(
  p_tenant_id   uuid,
  p_product_key text
)
RETURNS TABLE (
  product_key  text,
  name         text,
  caliber      text,
  quality      text,
  price        numeric,
  image_url    text,
  availability text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT g.product_key, g.name, g.caliber, g.quality, g.price, g.image_url, g.availability
  FROM public.store_catalog_groups(p_tenant_id) g
  WHERE g.product_key = lower(btrim(coalesce(p_product_key, '')))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.store_list_products(uuid, text, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_get_product(uuid, text)             FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_list_products(uuid, text, int, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_get_product(uuid, text)             TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. AUTOVERIFICACION A: catalogo
-- -----------------------------------------------------------------------------
DO $verify_catalog$
DECLARE
  v_fn  text;
  v_oid oid;
  v_res text;
  v_cfg text;
  v_n   int;
  c_cols constant text := 'product_key text, name text, caliber text, quality text, price numeric, image_url text, availability text';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'tenants'
                    AND column_name = 'store_enabled' AND data_type = 'boolean'
                    AND is_nullable = 'NO' AND column_default = 'false') THEN
    RAISE EXCEPTION 'B1.3 VERIFY FAIL: tenants.store_enabled boolean NOT NULL DEFAULT false ausente o distinta';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname = 'uq_tenants_single_store_enabled'
                    AND i.indisunique AND i.indpred IS NOT NULL) THEN
    RAISE EXCEPTION 'B1.3 VERIFY FAIL: falta el indice unico parcial de tenants.store_enabled';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY['public.store_list_products(uuid,text,integer,integer)',
                              'public.store_get_product(uuid,text)'] LOOP
    v_oid := to_regprocedure(v_fn);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'B1.3 VERIFY FAIL: no existe %', v_fn;
    END IF;

    -- Columnas del RETURNS: exactamente las seguras, en orden
    v_res := pg_get_function_result(v_oid);
    IF v_res <> 'TABLE(' || c_cols || ')' THEN
      RAISE EXCEPTION 'B1.3 VERIFY FAIL: % devuelve columnas inesperadas: %', v_fn, v_res;
    END IF;

    -- DEFINER + search_path + STABLE
    SELECT p.proconfig::text INTO v_cfg FROM pg_proc p WHERE p.oid = v_oid;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid)
       OR coalesce(v_cfg, '') NOT ILIKE '%search_path%'
       OR (SELECT p.provolatile FROM pg_proc p WHERE p.oid = v_oid) <> 's' THEN
      RAISE EXCEPTION 'B1.3 VERIFY FAIL: % debe ser SECURITY DEFINER, STABLE y con search_path fijo', v_fn;
    END IF;

    -- Grants: anon y authenticated si; PUBLIC no
    IF NOT has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'B1.3 VERIFY FAIL: % no es ejecutable por anon y authenticated', v_fn;
    END IF;
    SELECT count(*) INTO v_n
      FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.grantee = 0;
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'B1.3 VERIFY FAIL: % sigue ejecutable por PUBLIC', v_fn;
    END IF;
  END LOOP;

  -- La funcion interna NO es ejecutable por anon/authenticated ni PUBLIC
  v_oid := to_regprocedure('public.store_catalog_groups(uuid)');
  IF v_oid IS NULL OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1.3 VERIFY FAIL: store_catalog_groups debe existir y no ser ejecutable por anon/authenticated';
  END IF;
  SELECT count(*) INTO v_n
    FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   WHERE p.oid = v_oid AND a.grantee = 0;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'B1.3 VERIFY FAIL: store_catalog_groups es ejecutable por PUBLIC';
  END IF;
END
$verify_catalog$;

-- -----------------------------------------------------------------------------
-- 5. AUTOVERIFICACION B: comportamiento con fixtures (se deshacen)
-- -----------------------------------------------------------------------------
DO $verify_behavior$
DECLARE
  tA constant uuid := 'aaaaaaaa-f1c0-0000-0000-00000000000a';  -- tienda habilitada
  tB constant uuid := 'bbbbbbbb-f1c0-0000-0000-00000000000b';  -- tienda deshabilitada
  tX constant uuid := 'dddddddd-f1c0-0000-0000-00000000000d';  -- inexistente
  v_fail  text := '';
  v_ready boolean := false;
  v_n     int;
  v_arr   text[];
  r       record;
  v_keyM  text;
  v_keyB  text;
  v_json  jsonb;
  v_keys  text[];
  v_raised boolean;
  v_lotid text;
BEGIN
  BEGIN  -- sub-bloque revertible
    BEGIN
      INSERT INTO public.tenants (id, name) VALUES (tA, 'F1C TIENDA'), (tB, 'F1C SIN TIENDA');
      -- Si ya hay un tenant con tienda (futuro), se apaga solo dentro de este sub-bloque
      UPDATE public.tenants SET store_enabled = false WHERE store_enabled;
      UPDATE public.tenants SET store_enabled = true WHERE id = tA;

      -- Un "producto" = un lote. ZZ Manzana: 3 lotes del mismo nombre+calibre+calidad (uno con otro case)
      INSERT INTO public.products (tenant_id, name, brand, caliber, quality, shipment_number, available_quantity, price, status, entry_date, image_url)
      VALUES
        (tA, 'ZZ Manzana', 'MarcaViejaSecreta', 'C1', 'Q1', 'SHIP-OLD-777', 3.00, 10.00, 'active', DATE '2026-01-01', 'https://img.test/zz-old.webp'),
        (tA, 'ZZ Manzana', 'MarcaNuevaSecreta', 'C1', 'Q1', 'SHIP-NEW-888', 5.00, 12.00, 'active', DATE '2026-02-01', NULL),
        (tA, 'ZZ MANZANA', 'OtraMarca',         'C1', 'Q1', 'SHIP-MID-999', 1.00, 11.00, 'active', DATE '2026-01-15', NULL),
        -- ZZ Pera: todo agotado; el precio sale del lote mas reciente (9)
        (tA, 'ZZ Pera', 'MarcaP1', 'C2', 'Q1', 'SHIP-P1', 0.00, 7.00, 'active', DATE '2026-01-01', NULL),
        (tA, 'ZZ Pera', 'MarcaP2', 'C2', 'Q1', 'SHIP-P2', 0.00, 9.00, 'active', DATE '2026-03-01', NULL),
        -- ZZ Uva: inactivo => no aparece
        (tA, 'ZZ Uva',  'MarcaU',  'C1', 'Q1', 'SHIP-U1', 50.00, 5.00, 'inactive', DATE '2026-01-01', NULL),
        -- ZZ Kiwi: otro calibre => otra tarjeta; stock con decimales para detectar fugas
        (tA, 'ZZ Kiwi', 'MarcaK',  'C9', 'Q2', 'SHIP-K1', 37.50, 4.25, 'active', DATE '2026-01-01', NULL),
        -- Producto del tenant sin tienda
        (tB, 'ZZ Mango', 'MarcaM', 'C1', 'Q1', 'SHIP-M1', 20.00, 6.00, 'active', DATE '2026-01-01', NULL);
      v_ready := true;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'B1.3 VERIFY: no se pudieron crear fixtures (%): se omite el bloque de comportamiento', SQLERRM;
    END;

    IF v_ready THEN
      v_keyM := md5(lower('ZZ Manzana') || '|C1|Q1');
      v_keyB := md5(lower('ZZ Mango') || '|C1|Q1');
      SELECT p.id::text INTO v_lotid FROM public.products p WHERE p.tenant_id = tA AND p.shipment_number = 'SHIP-OLD-777';

      -- Todas las llamadas se hacen como ANON
      PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
      SET LOCAL ROLE anon;

      -- C1 tenant habilitado: 3 tarjetas (Kiwi, Manzana agrupada, Pera); sin Uva (inactivo) ni Mango (otro tenant)
      SELECT array_agg(upper(x.name) ORDER BY x.name), count(*) INTO v_arr, v_n FROM public.store_list_products(tA) x;
      IF v_n <> 3 OR v_arr IS DISTINCT FROM ARRAY['ZZ KIWI', 'ZZ MANZANA', 'ZZ PERA'] THEN
        v_fail := v_fail || format(E'\n - C1 listado tenant habilitado: n=%s items=%s (esperado 3: Kiwi, Manzana, Pera)', v_n, v_arr);
      END IF;

      -- C2 manzana: agrupada, Disponible, precio del lote ANTIGUO con stock (10), imagen no nula del grupo
      SELECT * INTO r FROM public.store_list_products(tA) x WHERE x.product_key = v_keyM;
      IF r.product_key IS NULL OR r.availability <> 'Disponible' OR r.price IS DISTINCT FROM 10.00
         OR r.image_url IS DISTINCT FROM 'https://img.test/zz-old.webp' OR r.caliber <> 'C1' OR r.quality <> 'Q1' THEN
        v_fail := v_fail || format(E'\n - C2 manzana: key=%s disp=%s precio=%s imagen=%s (esp Disponible, 10.00, zz-old)', r.product_key, r.availability, r.price, r.image_url);
      END IF;

      -- C3 pera agotada: estado Agotado y precio del lote mas reciente (9)
      SELECT * INTO r FROM public.store_list_products(tA) x WHERE x.caliber = 'C2';
      IF r.product_key IS NULL OR r.availability <> 'Agotado' OR r.price IS DISTINCT FROM 9.00 OR r.image_url IS NOT NULL THEN
        v_fail := v_fail || format(E'\n - C3 pera agotada: key=%s disp=%s precio=%s imagen=%s (esp Agotado, 9.00, NULL)', r.product_key, r.availability, r.price, r.image_url);
      END IF;

      -- C4 kiwi disponible con stock 37.50, y sin sumar al resto
      SELECT * INTO r FROM public.store_list_products(tA) x WHERE x.caliber = 'C9';
      IF r.product_key IS NULL OR r.availability <> 'Disponible' OR r.price IS DISTINCT FROM 4.25 THEN
        v_fail := v_fail || format(E'\n - C4 kiwi: key=%s disp=%s precio=%s (esp Disponible, 4.25)', r.product_key, r.availability, r.price);
      END IF;

      -- C5 payload: llaves exactas y sin fuga de datos internos (stock, marca, lote, tenant, ids)
      SELECT array_agg(DISTINCT k ORDER BY k) INTO v_keys
        FROM public.store_list_products(tA) x, LATERAL jsonb_object_keys(to_jsonb(x)) k;
      IF v_keys IS DISTINCT FROM ARRAY['availability', 'caliber', 'image_url', 'name', 'price', 'product_key', 'quality'] THEN
        v_fail := v_fail || format(E'\n - C5 llaves del payload: %s', v_keys);
      END IF;
      SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_json FROM public.store_list_products(tA) x;
      IF (v_json::text LIKE '%37.5%' OR v_json::text ILIKE '%Secreta%' OR v_json::text ILIKE '%SHIP-%'
                      OR v_json::text LIKE '%' || v_lotid || '%' OR v_json::text LIKE '%' || tA::text || '%') THEN
        v_fail := v_fail || E'\n - C5b el JSON expone stock, marca, lote, id de lote o tenant';
      END IF;
      IF v_json = '[]'::jsonb THEN
        v_fail := v_fail || E'\n - C5c el payload esta vacio: la verificacion de fuga no es significativa';
      END IF;

      -- C6 tienda deshabilitada / tenant inexistente / NULL: sin datos (triangulado con C1: tA si devuelve)
      SELECT count(*) INTO v_n FROM public.store_list_products(tB);
      IF v_n <> 0 THEN v_fail := v_fail || format(E'\n - C6a tienda deshabilitada devolvio %s filas', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_list_products(tX);
      IF v_n <> 0 THEN v_fail := v_fail || format(E'\n - C6b tenant inexistente devolvio %s filas', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_list_products(NULL);
      IF v_n <> 0 THEN v_fail := v_fail || format(E'\n - C6c tenant NULL devolvio %s filas', v_n); END IF;

      -- C7 detalle: existente / inexistente / de otro tenant / con tienda deshabilitada
      SELECT count(*) INTO v_n FROM public.store_get_product(tA, v_keyM);
      IF v_n <> 1 THEN v_fail := v_fail || format(E'\n - C7a detalle existente devolvio %s filas (esp 1)', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_get_product(tA, upper(v_keyM));
      IF v_n <> 1 THEN v_fail := v_fail || format(E'\n - C7a2 detalle con key en mayusculas devolvio %s filas (esp 1)', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_get_product(tA, md5('no-existe'));
      IF v_n <> 0 THEN v_fail := v_fail || format(E'\n - C7b detalle inexistente devolvio %s filas', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_get_product(tA, v_keyB);
      IF v_n <> 0 THEN v_fail := v_fail || format(E'\n - C7c key de producto de OTRO tenant via tenant habilitado devolvio %s filas', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_get_product(tB, v_keyB);
      IF v_n <> 0 THEN v_fail := v_fail || format(E'\n - C7d detalle con tienda deshabilitada devolvio %s filas', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_get_product(tA, NULL);
      IF v_n <> 0 THEN v_fail := v_fail || format(E'\n - C7e detalle con key NULL devolvio %s filas', v_n); END IF;

      -- C8 busqueda: coincidencia, sin coincidencia, comodines escapados
      SELECT count(*) INTO v_n FROM public.store_list_products(tA, 'pera');
      IF v_n <> 1 THEN v_fail := v_fail || format(E'\n - C8a busqueda "pera": %s filas (esp 1)', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_list_products(tA, 'zz');
      IF v_n <> 3 THEN v_fail := v_fail || format(E'\n - C8b busqueda "zz": %s filas (esp 3)', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_list_products(tA, 'sandia');
      IF v_n <> 0 THEN v_fail := v_fail || format(E'\n - C8c busqueda sin coincidencias: %s filas (esp 0)', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_list_products(tA, '%');
      IF v_n <> 0 THEN v_fail := v_fail || format(E'\n - C8d el comodin %% NO se escapo: %s filas (esp 0)', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_list_products(tA, '_');
      IF v_n <> 0 THEN v_fail := v_fail || format(E'\n - C8e el comodin _ NO se escapo: %s filas (esp 0)', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_list_products(tA, '   ');
      IF v_n <> 3 THEN v_fail := v_fail || format(E'\n - C8f busqueda en blanco: %s filas (esp 3, sin filtro)', v_n); END IF;

      -- C9 limites y paginacion
      SELECT count(*) INTO v_n FROM public.store_list_products(tA, NULL, 1, 0);
      IF v_n <> 1 THEN v_fail := v_fail || format(E'\n - C9a limit=1: %s filas', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_list_products(tA, NULL, 0, 0);
      IF v_n <> 1 THEN v_fail := v_fail || format(E'\n - C9b limit=0 debe acotarse a 1: %s filas', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_list_products(tA, NULL, -5, 0);
      IF v_n <> 1 THEN v_fail := v_fail || format(E'\n - C9c limit=-5 debe acotarse a 1: %s filas', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_list_products(tA, NULL, 100000, 0);
      IF v_n <> 3 THEN v_fail := v_fail || format(E'\n - C9d limit enorme: %s filas (esp 3, acotado a 100)', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_list_products(tA, NULL, 2, 2);
      IF v_n <> 1 THEN v_fail := v_fail || format(E'\n - C9e limit=2 offset=2: %s filas (esp 1)', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_list_products(tA, NULL, 48, -3);
      IF v_n <> 3 THEN v_fail := v_fail || format(E'\n - C9f offset negativo debe acotarse a 0: %s filas (esp 3)', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_list_products(tA, NULL, NULL, NULL);
      IF v_n <> 3 THEN v_fail := v_fail || format(E'\n - C9g limit/offset NULL usan los defaults: %s filas (esp 3)', v_n); END IF;

      -- C10 acceso directo a las tablas como anon: 0 filas o sin privilegio
      v_n := 0;
      BEGIN
        SELECT count(*) INTO v_n FROM public.products;
      EXCEPTION WHEN insufficient_privilege THEN v_n := 0;
      END;
      IF v_n <> 0 THEN v_fail := v_fail || format(E'\n - C10a anon vio %s filas de products por SELECT directo', v_n); END IF;
      -- C11 funcion interna: anon NO puede llamarla
      v_raised := false;
      BEGIN
        PERFORM 1 FROM public.store_catalog_groups(tA);
      EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
      END;
      IF NOT v_raised THEN v_fail := v_fail || E'\n - C11 anon pudo ejecutar store_catalog_groups'; END IF;

      RESET ROLE;

      -- C12 un usuario authenticated cualquiera (cliente de tienda) tambien lista y no ve el tenant ajeno
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated',
        'app_metadata', '{}'::jsonb, 'user_metadata', '{}'::jsonb)::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO v_n FROM public.store_list_products(tA);
      IF v_n <> 3 THEN v_fail := v_fail || format(E'\n - C12a authenticated listo %s filas (esp 3)', v_n); END IF;
      SELECT count(*) INTO v_n FROM public.store_list_products(tB);
      IF v_n <> 0 THEN v_fail := v_fail || format(E'\n - C12b authenticated vio %s filas de una tienda deshabilitada', v_n); END IF;
      RESET ROLE;
    END IF;

    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 'f1_cat_sentinel' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN
    NULL;  -- esperado: fixtures deshechos
  END;

  IF v_fail <> '' THEN
    RAISE EXCEPTION E'B1.3 VERIFY FAIL (comportamiento):%', v_fail;
  END IF;
END
$verify_behavior$;

COMMIT;
