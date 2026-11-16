-- Migration: corregir exceso_sobre del Tramo II quincenal de Renta ISR (IMPL-188)
-- Author: @alexis
-- Description: CONFIRMADO con evidencia oficial — el Decreto Ejecutivo No. 10 (Diario Oficial,
--              San Salvador, 30 de abril de 2025, Ministerio de Hacienda, "docs/Tablas de
--              renta.pdf") y el archivo de cálculo corregido que Imporfrut compartió en respuesta
--              a nuestra pregunta sobre los casos Solorzano/Batres ("Calculo Renta 2da Quincena
--              Septiembre 2026.xlsx") coinciden en el mismo valor: el Tramo II quincenal
--              (ingresos $275.01–$447.62) tiene exceso_sobre = $275.00, NO $236.00 — el valor que
--              traía la tabla desde el seed original (`20260817090000`), remanente de la tasa
--              pre-reforma de 2015 que nunca se actualizó tras la ampliación de la base exenta a
--              $275.00 quincenales.
--
--              Único cambio real: exceso_sobre del Tramo II quincenal, de 236.00 a 275.00. Monto
--              fijo ($8.83), tasa (10%) y el resto de los tramos (I/III/IV) ya coincidían con la
--              tabla oficial del Decreto — confirmado comparando los 4 tramos completos. Las
--              tablas de recálculo semestral/anual (`periodo = 'semestral_junio'/'anual_diciembre'`,
--              migración 20260906090400) YA traían los valores oficiales correctos desde que se
--              cargaron — no tienen el mismo defecto, se verificaron de nuevo contra este mismo
--              Decreto y coinciden exactas.
--
--              HALLAZGO ADICIONAL (no requiere cambio de código): el caso Solorzano del DRN
--              original ($0 de Renta, cuando debía dar ~$31) NO era un problema de esta tabla —
--              su base real ($453.75) cae en Tramo III, que ya estaba correcto. Imporfrut
--              confirmó que el $0 original venía de aplicar un "recálculo" (mecanismo pensado para
--              los ajustes de junio/diciembre del propio Decreto, ver Art. f) en vez de la tabla
--              cerrada quincenal normal. El motor real (`calcular_planilla_empleado`) siempre usó
--              la tabla cerrada quincenal para el cálculo normal — nunca tuvo este bug.
--
--              CA3 (análisis de impacto — el ticket pide decidir con Gilda el mecanismo de ajuste
--              de lo ya retenido, no corregirlo solo): este UPDATE corrige la tabla hacia ADELANTE
--              — no recalcula ninguna quincena `aprobada_cerrada` retroactivamente. Para medir el
--              alcance real, correr en modo solo lectura:
--
--              SELECT q.nombre, e.nombre_completo, c.base_renta, c.renta_isr
--              FROM planilla_calculo_empleado c
--              JOIN quincenas q ON q.id = c.quincena_id
--              JOIN planilla_empleados e ON e.id = c.empleado_id
--              WHERE q.estado = 'aprobada_cerrada'
--                AND c.base_renta BETWEEN 275.01 AND 447.62
--              ORDER BY q.fecha_inicio;

BEGIN;

UPDATE public.planilla_renta_tramos
SET exceso_sobre = 275.00
WHERE periodo = 'quincenal' AND orden = 2 AND exceso_sobre = 236.00;

COMMIT;
