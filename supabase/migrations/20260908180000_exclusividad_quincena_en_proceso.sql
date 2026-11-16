-- Migration: Exclusividad de Quincena Activa por tipo (IMPL-156 / US-QNA-10, CA1/CA2/CA3)
-- Author: @alexis
-- Description: hasta ahora el sistema permitía múltiples quincenas 'en_proceso' del mismo
--              tipo al mismo tiempo (ej. 1ra y 2da Quincena de Agosto ambas en_proceso) —
--              causa raíz confirmada de IMPL-150/IMPL-152/IMPL-154 (defectos UAT donde una
--              acción real terminaba operando sobre la quincena "más reciente no cerrada" en
--              vez de la que el usuario realmente quería, vía `encontrarQuincenaActiva`).
--
--              CA1: índice único parcial — solo una quincena 'en_proceso' por (tenant, tipo).
--              El predicado NO cubre 'reabierta', así que CA3 (varias reabiertas en paralelo,
--              sin restricción) se cumple gratis, sin código adicional.
--
--              CA2: create_quincena ahora bloquea preventivamente con un mensaje específico
--              (mismo estilo que la excepción de solapamiento de fechas que ya existía) si ya
--              hay una quincena 'en_proceso' de ese tipo — antes de siquiera chequear fechas.
--              El índice de CA1 es el guardrail real a nivel de datos; esta excepción es la
--              que da el mensaje amigable que el frontend ya sabe extraer (extraerMensajeError).

BEGIN;

-- CA1 + CA3
CREATE UNIQUE INDEX idx_quincenas_una_en_proceso_por_tipo
    ON public.quincenas(tenant_id, tipo)
    WHERE estado = 'en_proceso' AND deleted_at IS NULL;

-- CA2
CREATE OR REPLACE FUNCTION public.create_quincena(
    p_tipo TEXT,
    p_nombre TEXT,
    p_etiqueta_estandar TEXT,
    p_fecha_inicio DATE,
    p_fecha_fin DATE,
    p_dias_habiles INT
)
RETURNS public.quincenas
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.quincenas;
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_solapada BOOLEAN;
    v_existente_en_proceso RECORD;
    v_tipo_label TEXT;
BEGIN
    v_tipo_label := CASE p_tipo
        WHEN 'normal' THEN 'Normal'
        WHEN 'aguinaldo' THEN 'Aguinaldo'
        WHEN 'quincena_25' THEN 'Quincena 25'
        ELSE p_tipo
    END;

    SELECT id, nombre INTO v_existente_en_proceso
    FROM public.quincenas
    WHERE tenant_id = v_tenant_id
      AND tipo = p_tipo
      AND estado = 'en_proceso'
      AND deleted_at IS NULL
    LIMIT 1;

    IF v_existente_en_proceso.id IS NOT NULL THEN
        RAISE EXCEPTION 'Ya existe una quincena % en proceso (%) — debes enviarla a aprobación y cerrarla antes de crear la siguiente.', v_tipo_label, v_existente_en_proceso.nombre;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.quincenas
        WHERE tenant_id = v_tenant_id
          AND tipo = p_tipo
          AND deleted_at IS NULL
          AND fecha_inicio <= p_fecha_fin
          AND fecha_fin >= p_fecha_inicio
    ) INTO v_solapada;

    IF v_solapada THEN
        RAISE EXCEPTION 'Ya existe una quincena de tipo "%" con un rango de fechas que se superpone (%  a  %)', p_tipo, p_fecha_inicio, p_fecha_fin;
    END IF;

    INSERT INTO public.quincenas (
        tenant_id, tipo, nombre, etiqueta_estandar, fecha_inicio, fecha_fin, dias_habiles, created_by
    ) VALUES (
        v_tenant_id, p_tipo, p_nombre, p_etiqueta_estandar, p_fecha_inicio, p_fecha_fin, p_dias_habiles, auth.uid()
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

COMMIT;
