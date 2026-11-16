-- Migration: Agregar "Horas Regulares" a Carga Manual de Horas Extra (IMPL-25 / US-HEX-06 CA1)
-- Author: @alexis
-- Description: CA1 exige la columna "Horas Regulares" en la tabla de Carga Manual, capturada
--              directamente por el Preparador (a diferencia de Reloj Marcador, donde ese mismo
--              concepto siempre se calcula, nunca es editable). Puramente informativa/de
--              auditoría: no participa en `calcular_planilla_empleado`, que solo lee
--              `monto_total` de esta tabla (ver Paso 3, 20260819090000_create_calcular_
--              planilla_empleado.sql) — no hay que tocar el motor de cálculo.

BEGIN;

ALTER TABLE public.planilla_horas_extras_manual
    ADD COLUMN IF NOT EXISTS horas_regulares NUMERIC NOT NULL DEFAULT 0 CHECK (horas_regulares >= 0);

COMMIT;
