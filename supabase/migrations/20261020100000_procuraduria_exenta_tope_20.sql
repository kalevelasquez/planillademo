-- Migration: Procuraduría exenta del tope 20% de descuentos no obligatorios
-- Author: @alexis
-- Description: Hallazgo real (2026-10-20) investigando la pregunta del tope del 20% —
--              `docs/formatos-reportes/Planilla 1ra quincena abril 2026.xlsx`, hoja "Descuentos":
--              el empleado Santos Ramírez José Alberto (sueldo quincenal $204.40) tiene un
--              descuento de "PROCURADURIA" de $75 (36.7% de su sueldo él solo, 51.6% sumado a su
--              préstamo bancario) aplicado COMPLETO, sin ningún indicio de diferimiento.
--
--              La categoría "Procuraduría" (sembrada en 20260909110000) quedó con
--              `tipo='variable'` — hoy SÍ se somete al tope del 20% (Paso 14 de
--              `calcular_planilla_empleado` lee `c.tipo` directo de esta tabla). Pero un
--              descuento de Procuraduría es un EMBARGO JUDICIAL (pensión alimenticia u orden de
--              la Procuraduría General), no un préstamo voluntario del empleado — no se puede
--              diferir a discreción del Preparador. Mismo criterio que Préstamo
--              bancario/Financiera/Vivienda/Vehículo (ya `tipo='fijo'`): compromiso ya aprobado,
--              se aplica siempre completo.
--
--              Cambio AISLADO: solo el seed de la categoría. No hace falta tocar
--              `calcular_planilla_empleado` — ya lee `c.tipo` dinámicamente de esta tabla en cada
--              corrida, así que el motor respeta el cambio sin re-crear la función.

BEGIN;

UPDATE public.planilla_descuento_categorias
SET tipo = 'fijo'
WHERE nombre = 'Procuraduría' AND tipo = 'variable';

COMMIT;
