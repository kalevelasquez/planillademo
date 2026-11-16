-- Migración para eliminar columnas antiguas de precios y renombrar la principal

ALTER TABLE products DROP COLUMN IF EXISTS price_empleado;
ALTER TABLE products DROP COLUMN IF EXISTS price_mayoreo;
ALTER TABLE products RENAME COLUMN price_cliente TO price;
