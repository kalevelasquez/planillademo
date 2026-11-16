-- Migration: Descuentos — código de visualización DF-XXX (IMPL-56 / US-DESC-00, IMPL-57)
-- Author: @alexis
-- Description: CA4 de US-DESC-00 pide mostrar un "código (DF-XXX)" por fila en el panel
--              consolidado — es un identificador de visualización, no algo que el usuario
--              ingresa. Se genera con una secuencia global (no por tenant: es solo un correlativo
--              de despliegue, no un número de control legal/fiscal, así que no hace falta
--              partirlo por tenant).

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.planilla_descuentos_codigo_seq;

ALTER TABLE public.planilla_descuentos
    ADD COLUMN IF NOT EXISTS codigo TEXT UNIQUE
    DEFAULT ('DF-' || LPAD(nextval('public.planilla_descuentos_codigo_seq')::text, 3, '0'));

UPDATE public.planilla_descuentos
SET codigo = 'DF-' || LPAD(nextval('public.planilla_descuentos_codigo_seq')::text, 3, '0')
WHERE codigo IS NULL;

ALTER TABLE public.planilla_descuentos ALTER COLUMN codigo SET NOT NULL;

COMMIT;
