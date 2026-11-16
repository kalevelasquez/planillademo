-- Migration: Eliminar el overload duplicado de fn_calcular_renta_isr (bloqueaba TODO cálculo)
-- Author: @alexis
-- Description: Reporte UAT — "Calcular Planilla" fallaba para el 100% de los empleados con
--              "function public.fn_calcular_renta_isr(uuid, numeric, date) is not unique".
--
--              Causa raíz: 20260906090400_fix_recalculo_renta_semestral_tablas_oficiales.sql
--              le agregó un 4to parámetro a fn_calcular_renta_isr (`p_periodo TEXT DEFAULT
--              'quincenal'`) usando CREATE OR REPLACE FUNCTION. En Postgres, la identidad de una
--              función es su nombre + la lista de tipos de parámetros — agregar un parámetro
--              (aunque tenga DEFAULT) NO reemplaza la función existente, crea un OVERLOAD nuevo.
--              Quedaron conviviendo dos funciones: la original de 3 argumentos (creada en
--              20260819090000_create_calcular_planilla_empleado.sql) y la nueva de 4. Al llamarla
--              con 3 argumentos (Paso 12 del motor, Aguinaldo, el fix de AFP jubilado), Postgres
--              encuentra DOS candidatos válidos — el de 3 args exacto y el de 4 args usando su
--              default — y no puede elegir: "is not unique". Rompía el 100% de los cálculos.
--
--              Fix: eliminar el overload viejo de 3 argumentos. La versión de 4 argumentos ya
--              tiene DEFAULT 'quincenal', así que las llamadas existentes con 3 argumentos siguen
--              funcionando idéntico, ahora sin ambigüedad (un solo candidato posible).

BEGIN;

DROP FUNCTION IF EXISTS public.fn_calcular_renta_isr(UUID, NUMERIC, DATE);

COMMIT;
