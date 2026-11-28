-- =============================================================================
-- ROLLBACK de 20261201090000_habilitar_tienda_demo.sql (F1 / B4.6)
--
-- Se aplica a MANO en el SQL Editor (staging primero). Apaga la tienda: el catalogo publico deja
-- de devolver datos (la landing y /tienda muestran "Catalogo no disponible") y la rama "tienda" de
-- handle_new_user vuelve a no crear `customers`. No borra datos: los `customers` ya creados por
-- altas de tienda (si hubo) quedan; revisalos antes de volver a habilitar.
-- Idempotente y autoverificable.
-- =============================================================================

BEGIN;

UPDATE public.tenants SET store_enabled = false WHERE store_enabled;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants WHERE store_enabled) THEN
    RAISE EXCEPTION 'B4.6 DOWN VERIFY FAIL: aun hay un tenant con la tienda habilitada';
  END IF;
END
$verify$;

-- Comprobacion (debe devolver 0 filas):
-- SELECT id, name FROM public.tenants WHERE store_enabled;

COMMIT;
