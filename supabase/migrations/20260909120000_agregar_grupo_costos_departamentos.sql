-- Migration: Jerarquía Grupo de Costos > Departamento (IMPL-167 CA3)
-- Author: @alexis
-- Description: el reporte de Descuentos (US-EXP-11) agrupa jerárquicamente por
--              Departamento/Gerencia (ej. "GASTOS ADMINISTRATIVOS > GERENCIA GENERAL >
--              [empleados]"), pero `planilla_departamentos` hoy es un catálogo plano de un solo
--              nivel — no existe ningún campo con el nivel 1 (GASTOS ADMINISTRATIVOS / GASTOS DE
--              VENTAS / GASTO DE OPERACIONES). Se agrega una columna nullable `grupo_costos` en
--              vez de un catálogo nuevo con su propio CRUD/RLS: es aditivo, no rompe a los
--              consumidores actuales de `departamento` como texto libre, y es reversible.
--
--              El backfill usa los nombres de departamento REALES confirmados contra el Excel de
--              referencia de Imporfrut (`Planilla 1ra quincena abril 2026.xlsx`, hoja
--              "Descuentos") — incluye "PERSONAL DE TRASPORTE (MOTORISTAS)" tal cual está escrito
--              en el archivo real (typo de origen, no de esta migración).
--
--              ⚠️ Verificar antes de aplicar: correr `SELECT nombre FROM planilla_departamentos`
--              en la base real y confirmar que los nombres calzan exacto (mayúsculas/espacios)
--              con el `CASE` de abajo — si no calzan, ajustar el CASE antes de correr. Los
--              departamentos que no matcheen ninguna rama quedan `grupo_costos = NULL` y el
--              reporte los agrupa bajo "Sin clasificar", sin romperse.

BEGIN;

ALTER TABLE public.planilla_departamentos ADD COLUMN IF NOT EXISTS grupo_costos TEXT;

UPDATE public.planilla_departamentos SET grupo_costos = CASE trim(nombre)
    WHEN 'GERENCIA GENERAL' THEN 'GASTOS ADMINISTRATIVOS'
    WHEN 'GERENCIA DE COMPRAS' THEN 'GASTOS ADMINISTRATIVOS'
    WHEN 'PERSONAL ADMINISTRATIVO' THEN 'GASTOS ADMINISTRATIVOS'
    WHEN 'MENSAJERIA Y SERVICIOS VARIOS' THEN 'GASTOS ADMINISTRATIVOS'
    WHEN 'GERENCIA DE VENTAS' THEN 'GASTOS DE VENTAS'
    WHEN 'PERSONAL DE VENTAS' THEN 'GASTOS DE VENTAS'
    WHEN 'GERENCIA DE OPERACIONES' THEN 'GASTO DE OPERACIONES'
    WHEN 'JEFE DE BODEGA' THEN 'GASTO DE OPERACIONES'
    WHEN 'PERSONAL DE TRASPORTE (MOTORISTAS)' THEN 'GASTO DE OPERACIONES'
    WHEN 'AUXILIARES DE BODEGA' THEN 'GASTO DE OPERACIONES'
    WHEN 'AUXILIARES DE EMPAQUE' THEN 'GASTO DE OPERACIONES'
    ELSE NULL
END
WHERE grupo_costos IS NULL;

COMMIT;
