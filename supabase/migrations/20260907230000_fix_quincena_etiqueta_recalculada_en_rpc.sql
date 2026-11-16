-- Migration: create_quincena recalcula la etiqueta estándar en vez de confiar en el cliente
-- Author: @alexis
-- Description: Quinta pasada de la auditoría crítica módulo por módulo (hallazgo importante
--              de Quincenas): `create_quincena` guardaba literalmente cualquier
--              `p_etiqueta_estandar` que mandara el cliente, sin re-validar que coincidiera con
--              `p_tipo`/`p_fecha_inicio`/`p_fecha_fin`. La única "protección" (CA4 de US-QNA-01,
--              detectar rango irregular y pedir confirmación) es 100% client-side en
--              `quincenaUtils.ts:generarEtiquetaEstandar` — cosmética desde la perspectiva de la
--              API, un cliente distinto al oficial podía guardar cualquier etiqueta arbitraria.
--
--              Se recalcula la etiqueta server-side con la misma regla exacta que
--              `generarEtiquetaEstandar` (aguinaldo/quincena_25/1ra-2da quincena de mes
--              calendario), incluyendo el mismo formato de fallback para el caso borde de rango
--              irregular (CA4) que ya usa el modal. El parámetro `p_etiqueta_estandar` queda sin
--              uso — se mantiene en la firma para no romper el contrato del RPC ya usado por
--              `quincenasService.createQuincena`.

BEGIN;

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
    v_etiqueta TEXT;
    v_tipo_label TEXT;
    v_mes_nombre TEXT;
    v_anio INT := EXTRACT(YEAR FROM p_fecha_inicio);
    v_dia_inicio INT := EXTRACT(DAY FROM p_fecha_inicio);
    v_dia_fin INT := EXTRACT(DAY FROM p_fecha_fin);
    v_mismo_mes BOOLEAN := date_trunc('month', p_fecha_inicio) = date_trunc('month', p_fecha_fin);
    v_ultimo_dia_mes INT := EXTRACT(DAY FROM (date_trunc('month', p_fecha_inicio) + interval '1 month - 1 day'));
BEGIN
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

    v_tipo_label := CASE p_tipo WHEN 'normal' THEN 'Normal' WHEN 'aguinaldo' THEN 'Aguinaldo' WHEN 'quincena_25' THEN 'Quincena 25' ELSE p_tipo END;
    v_mes_nombre := CASE EXTRACT(MONTH FROM p_fecha_inicio)
        WHEN 1 THEN 'Enero' WHEN 2 THEN 'Febrero' WHEN 3 THEN 'Marzo' WHEN 4 THEN 'Abril'
        WHEN 5 THEN 'Mayo' WHEN 6 THEN 'Junio' WHEN 7 THEN 'Julio' WHEN 8 THEN 'Agosto'
        WHEN 9 THEN 'Septiembre' WHEN 10 THEN 'Octubre' WHEN 11 THEN 'Noviembre' ELSE 'Diciembre'
    END;

    IF p_tipo = 'aguinaldo' THEN
        v_etiqueta := 'Aguinaldo ' || v_anio::TEXT;
    ELSIF p_tipo = 'quincena_25' THEN
        v_etiqueta := 'Quincena 25 ' || v_anio::TEXT;
    ELSIF v_mismo_mes AND v_dia_inicio = 1 AND v_dia_fin = 15 THEN
        v_etiqueta := '1ra Quincena de ' || v_mes_nombre || ' ' || v_anio::TEXT;
    ELSIF v_mismo_mes AND v_dia_inicio = 16 AND v_dia_fin = v_ultimo_dia_mes THEN
        v_etiqueta := '2da Quincena de ' || v_mes_nombre || ' ' || v_anio::TEXT;
    ELSE
        -- Rango irregular (CA4 de US-QNA-01) — mismo formato de fallback que ya usa
        -- NuevaQuincenaModal.tsx cuando generarEtiquetaEstandar devuelve advertencia=true.
        v_etiqueta := v_tipo_label || ' ' || p_fecha_inicio::TEXT || ' - ' || p_fecha_fin::TEXT;
    END IF;

    INSERT INTO public.quincenas (
        tenant_id, tipo, nombre, etiqueta_estandar, fecha_inicio, fecha_fin, dias_habiles, created_by
    ) VALUES (
        v_tenant_id, p_tipo, p_nombre, v_etiqueta, p_fecha_inicio, p_fecha_fin, p_dias_habiles, auth.uid()
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

COMMIT;
