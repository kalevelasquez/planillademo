-- Migration: completar_ubicacion_modulo — eliminar el overload duplicado de 4 parámetros
-- Author: @alexis
-- Description: BUG en producción (reportado por el usuario al confirmar una importación de
--              Horas Extras): "function public.completar_ubicacion_modulo(uuid, uuid, unknown,
--              uuid) is not unique" (SQLSTATE 42725).
--
--              Causa raíz: la migración 20260908240000 quiso "extender, no duplicar" el RPC
--              agregándole un 5to parámetro opcional (`p_via_sin_registros BOOLEAN DEFAULT
--              false`). Pero en Postgres, `CREATE OR REPLACE FUNCTION` con una cantidad de
--              parámetros DISTINTA a la función existente no la reemplaza — crea un OVERLOAD
--              nuevo. Quedaron dos funciones coexistiendo: la original de 4 parámetros
--              (20260724090000) y la nueva de 5 con default (20260908240000). Cualquier llamado
--              con exactamente 4 argumentos posicionales es ambiguo entre ambas — y eso es
--              justo lo que hace `confirmar_importacion_reloj_marcador`
--              (`agregar_empleado_no_detectado.sql:81`, `PERFORM
--              public.completar_ubicacion_modulo(p_quincena_id, p_ubicacion_id, 'horas_extras',
--              p_user_id)`), así que TODA importación de Horas Extras fallaba al confirmar desde
--              que se aplicó 20260908240000. El llamado desde el frontend
--              (`modulosQuincenaService.ts`) nunca se vio afectado porque siempre manda los 5
--              parámetros con nombre vía PostgREST, lo cual resuelve sin ambigüedad.
--
--              Fix: DROP de la función de 4 parámetros. La de 5 parámetros (con
--              `p_via_sin_registros` default `false`) queda como única — cualquier llamado viejo
--              de 4 argumentos ahora la resuelve a ella sin ambigüedad, con el mismo
--              comportamiento de siempre (via_sin_registros=false).

BEGIN;

DROP FUNCTION IF EXISTS public.completar_ubicacion_modulo(UUID, UUID, TEXT, UUID);

COMMIT;
