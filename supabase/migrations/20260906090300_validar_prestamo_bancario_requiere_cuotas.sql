-- Migration: Descuentos — "Préstamo bancario" siempre requiere cuotas (IMPL-56 / US-DESC-01 CA2)
-- Author: @alexis
-- Description: Confirmado por Imporfrut (revisión historia por historia): la categoría
--              "Préstamo bancario" nunca puede quedar indefinida — el monto total del préstamo
--              siempre se conoce, así que monto_total/numero_cuotas son obligatorios para ella
--              específicamente (a diferencia del resto de categorías, que sí pueden ser
--              indefinidas por diseño, ver 20260805090000_create_planilla_descuentos.sql).
--
--              No es un CHECK de tabla porque Postgres no permite subconsultas contra otra tabla
--              en un CHECK constraint — se valida dentro del RPC, mismo criterio ya usado en el
--              proyecto para reglas de negocio que dependen de una fila relacionada (ej. la
--              autorización de Gerencia General en crear_anticipo).
--
--              Match por NOMBRE literal de la categoría, no por un flag dedicado — es la única
--              categoría con esta regla especial hoy; si el catálogo permite renombrarla, esta
--              validación dejaría de aplicar (riesgo aceptado, coherente con que el catálogo es
--              configurable por el propio admin del tenant).

BEGIN;

CREATE OR REPLACE FUNCTION public.crear_descuento(
    p_empleado_id UUID,
    p_categoria_id UUID,
    p_institucion TEXT,
    p_monto_quincenal NUMERIC,
    p_monto_total NUMERIC,
    p_numero_cuotas INT,
    p_user_id UUID
) RETURNS public.planilla_descuentos
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.planilla_descuentos;
    v_monto_quincenal NUMERIC;
    v_categoria_nombre TEXT;
BEGIN
    SELECT nombre INTO v_categoria_nombre
    FROM public.planilla_descuento_categorias
    WHERE id = p_categoria_id;

    IF v_categoria_nombre = 'Préstamo bancario' AND (p_monto_total IS NULL OR p_numero_cuotas IS NULL) THEN
        RAISE EXCEPTION 'La categoría "Préstamo bancario" siempre debe tener monto total y número de cuotas — nunca puede quedar indefinida.';
    END IF;

    v_monto_quincenal := CASE
        WHEN p_monto_total IS NOT NULL AND p_numero_cuotas IS NOT NULL
            THEN ROUND(p_monto_total / p_numero_cuotas, 2)
        ELSE p_monto_quincenal
    END;

    INSERT INTO public.planilla_descuentos (
        tenant_id, empleado_id, categoria_id, institucion, monto_quincenal,
        monto_total, numero_cuotas, created_by
    ) VALUES (
        public.get_auth_tenant_id(), p_empleado_id, p_categoria_id, p_institucion, v_monto_quincenal,
        p_monto_total, p_numero_cuotas, p_user_id
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

COMMIT;
