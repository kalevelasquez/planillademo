-- Migration: marcar quincenas de datos de prueba para que no contaminen reportes (IMPL-187)
-- Author: @alexis
-- Description: `seed_datos_2025_clonar_quincenas_impl169.sql` clona quincenas ya cerradas hacia
--              un año anterior para poder probar la Constancia de Retenciones (IMPL-169) en UAT.
--              Las quincenas clonadas quedan con `tipo = 'normal'` y `estado = 'aprobada_cerrada'`,
--              idénticas a datos reales — ningún reporte puede distinguirlas. El filtro de
--              `fecha_inicio >= fecha_ingreso` que IMPL-182 agregó a la Constancia de Salario las
--              excluye solo para empleados que ingresaron DESPUÉS del período clonado — un
--              empleado con antigüedad real anterior a esa fecha seguiría arrastrando el clon en
--              la Constancia de Salario y en cualquier otro reporte histórico (Retenciones anual,
--              Liquidación, Aguinaldo).
--
--              Opción (b) del ticket (marcar, no eliminar): se agrega la columna `es_prueba`,
--              explícita y reutilizable por cualquier reporte futuro, en vez de (a) borrar las
--              filas — evita perder el fixture que IMPL-169 todavía podría necesitar para
--              regresión manual. El filtro se centraliza en `seleccionarQuincenasElegibles`
--              (constanciaSalarioUtils.ts, IMPL-182) — no se repite pantalla por pantalla.

BEGIN;

ALTER TABLE public.quincenas
    ADD COLUMN IF NOT EXISTS es_prueba BOOLEAN NOT NULL DEFAULT false;

-- Marca las quincenas ya clonadas por el seed de IMPL-169 — identificadas por el nombre literal
-- que ese script les asigna (ver seed_datos_2025_clonar_quincenas_impl169.sql).
UPDATE public.quincenas
SET es_prueba = true
WHERE nombre = 'CLON 2025 (datos de prueba IMPL-169)';

COMMIT;
