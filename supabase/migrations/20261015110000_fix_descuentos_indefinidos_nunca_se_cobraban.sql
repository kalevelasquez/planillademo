-- Migration: BUG REAL DE PLATA — los descuentos "indefinidos" nunca se cobraban
-- Author: @alexis
-- Description: Hallazgo propio (2026-10-15, revisando una observación de Gilda sobre el módulo
--              de Descuentos, sin ticket de Jira todavía). `procesar_cuotas_descuentos_quincena`
--              (20260808090000, redefinida en 20260809090000) filtraba
--              `AND d.monto_total IS NOT NULL` en el WHERE que decide qué descuentos procesar
--              cada quincena. El comentario original decía "CA2: indefinidos nunca finalizan, se
--              excluyen acá" — la intención real (US-DESC-04/IMPL-61) era que un descuento
--              indefinido NUNCA pase a `estado = 'completado'` automáticamente, pero el código
--              terminó excluyéndolo del procesamiento COMPLETO, no solo de esa transición.
--
--              Consecuencia real: un descuento indefinido (el caso donde el Preparador no define
--              monto_total/numero_cuotas, solo monto_quincenal — ej. una cuota de sindicato sin
--              plazo fijo) nunca generaba fila en `planilla_descuento_eventos`. El motor de
--              cálculo real (`calcular_planilla_empleado`, Paso 14) SOLO lee esa tabla de
--              eventos, nunca `planilla_descuentos` directamente — así que ese descuento se veía
--              "Activo" en pantalla pero jamás se le descontaba un centavo al empleado, para
--              siempre, sin ningún error ni aviso.
--
--              Mismo filtro roto, mismo bug, en `contar_anticipos_descuentos_pendientes`
--              (20260907270000, redefinida en 20260908200000) — el "gate" que debería bloquear
--              "Calcular Planilla" si hay descuentos sin procesar esta quincena. Con el filtro
--              roto, un descuento indefinido tampoco contaba como "pendiente", así que el gate
--              nunca forzaba su procesamiento.
--
--              NO se toca `src/ui/features/planilla/_ia_herramientas/..._ampliar_ia_herramientas_
--              consulta.sql` (línea con el mismo filtro) — ahí el filtro es correcto a propósito:
--              esa consulta reporta "saldo pendiente" (monto_total - monto_pagado), que no tiene
--              sentido para un descuento sin monto_total definido.
--
--              Fix: quitar el filtro del WHERE en ambas funciones reales, y que el cálculo de
--              monto/finalización trate `monto_total IS NULL` como "cobra el monto_quincenal
--              completo esta quincena, nunca se marca completado" — exactamente la intención
--              original del comentario, pero implementada donde corresponde.
--
--              Alcance: esta migración corrige el comportamiento HACIA ADELANTE únicamente — no
--              recalcula retroactivamente ninguna quincena `aprobada_cerrada`. Si hay descuentos
--              indefinidos activos en quincenas ya cerradas que nunca se cobraron, hace falta una
--              decisión de negocio aparte (¿se cobra retroactivo, se perdona, se ajusta a mano?)
--              antes de tocar datos históricos.

BEGIN;

CREATE OR REPLACE FUNCTION public.procesar_cuotas_descuentos_quincena(
    p_quincena_id UUID,
    p_user_id UUID
) RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_descuento RECORD;
    v_monto NUMERIC;
    v_nuevo_monto_pagado NUMERIC;
    v_procesados INT := 0;
BEGIN
    FOR v_descuento IN
        SELECT d.* FROM public.planilla_descuentos d
        JOIN public.planilla_descuento_categorias c ON c.id = d.categoria_id
        WHERE d.tenant_id = v_tenant_id
          AND d.estado = 'activo'
          -- 2026-10-15: se quitó "AND d.monto_total IS NOT NULL" — ese filtro excluía del
          -- procesamiento COMPLETO a los descuentos indefinidos (nunca generaban evento, nunca
          -- se cobraban). La intención original (nunca marcarlos "completado") se maneja abajo,
          -- en el CASE de v_monto/estado, no excluyéndolos de este loop.
          AND NOT (c.tipo = 'fijo' AND d.validado_at IS NULL) -- US-DESC-05 CA1
          AND NOT EXISTS (
              SELECT 1 FROM public.planilla_descuento_eventos e
              WHERE e.descuento_id = d.id AND e.quincena_id = p_quincena_id
          )
        FOR UPDATE OF d
    LOOP
        v_monto := CASE
            WHEN v_descuento.monto_total IS NOT NULL
                THEN LEAST(v_descuento.monto_quincenal, v_descuento.monto_total - v_descuento.monto_pagado)
            ELSE v_descuento.monto_quincenal
        END;

        INSERT INTO public.planilla_descuento_eventos (tenant_id, descuento_id, quincena_id, tipo, monto, registrado_por)
        VALUES (v_tenant_id, v_descuento.id, p_quincena_id, 'pago', v_monto, p_user_id);

        v_nuevo_monto_pagado := v_descuento.monto_pagado + v_monto;

        UPDATE public.planilla_descuentos
        SET monto_pagado = v_nuevo_monto_pagado,
            cuotas_pagadas = v_descuento.cuotas_pagadas + 1,
            -- Un descuento indefinido (monto_total NULL) nunca se autocompleta — sigue
            -- "activo" para siempre, hasta que alguien lo pause/cancele a mano (US-DESC-04 CA2).
            estado = CASE
                WHEN v_descuento.monto_total IS NOT NULL AND v_nuevo_monto_pagado >= v_descuento.monto_total THEN 'completado'
                ELSE 'activo'
            END,
            updated_at = now()
        WHERE id = v_descuento.id;

        v_procesados := v_procesados + 1;
    END LOOP;

    RETURN v_procesados;
END;
$$;

-- Redefinición basada en la vigente (20260908200000) — único cambio real: se quita el mismo
-- "AND d.monto_total IS NOT NULL" del conteo de descuentos pendientes, por la misma razón de
-- arriba. La parte de anticipos (fecha_vale) queda intacta.
CREATE OR REPLACE FUNCTION public.contar_anticipos_descuentos_pendientes(p_quincena_id UUID)
RETURNS TABLE(anticipos_pendientes INT, descuentos_pendientes INT)
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_quincena_fecha_inicio DATE;
BEGIN
    SELECT fecha_inicio INTO v_quincena_fecha_inicio
    FROM public.quincenas
    WHERE id = p_quincena_id AND tenant_id = v_tenant_id;

    RETURN QUERY
    SELECT
        (
            SELECT COUNT(*)::INT
            FROM public.planilla_anticipos a
            WHERE a.tenant_id = v_tenant_id
              AND a.estado = 'activo'
              AND a.fecha_vale <= v_quincena_fecha_inicio
              AND NOT EXISTS (
                  SELECT 1 FROM public.planilla_anticipo_pagos p
                  WHERE p.anticipo_id = a.id AND p.quincena_id = p_quincena_id
              )
        ),
        (
            SELECT COUNT(*)::INT
            FROM public.planilla_descuentos d
            JOIN public.planilla_descuento_categorias c ON c.id = d.categoria_id
            WHERE d.tenant_id = v_tenant_id
              AND d.estado = 'activo'
              AND NOT (c.tipo = 'fijo' AND d.validado_at IS NULL)
              AND NOT EXISTS (
                  SELECT 1 FROM public.planilla_descuento_eventos e
                  WHERE e.descuento_id = d.id AND e.quincena_id = p_quincena_id
              )
        );
END;
$$;

COMMIT;
