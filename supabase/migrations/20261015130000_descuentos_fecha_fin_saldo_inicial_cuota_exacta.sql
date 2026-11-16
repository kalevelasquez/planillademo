-- Migration: Descuentos — fecha de finalización, saldo inicial al dar de alta, cuota exacta
-- Author: @alexis
-- Description: Observación de Gilda/Imporfrut (2026-10-15), 3 pedidos sobre el alta de un
--              descuento (confirmados con el usuario antes de implementar, cada uno con su propia
--              decisión de diseño):
--
--              1. Fecha de finalización (fecha_fin, opcional): hasta ahora la vigencia de un
--                 descuento era 100% por saldo (monto_total/monto_pagado, o indefinido para
--                 siempre). Con fecha_fin definida, `procesar_cuotas_descuentos_quincena` sigue
--                 cobrando mientras la quincena procesada empiece antes de esa fecha; la quincena
--                 que CONTIENE fecha_fin todavía cobra (último pago), y desde ahí el descuento se
--                 marca 'completado' sin importar el saldo pendiente — aplica igual a descuentos
--                 finitos e indefinidos (uno indefinido con fecha_fin simplemente deja de ser
--                 "para siempre").
--
--              2. Saldo inicial al dar de alta (p_monto_pagado_inicial/p_cuotas_pagadas_inicial
--                 en crear_descuento, default 0): para cargar un descuento que el empleado YA
--                 viene pagando desde antes de existir en el sistema, sin "empezar de cero". Solo
--                 tiene sentido con monto_total definido (si no, no hay saldo contra qué validar)
--                 — se valida que no supere el total ni que las cuotas ya pagadas igualen o
--                 superen el número de cuotas total.
--
--              3. Cuota exacta en vez de número de cuotas (p_cuota_exacta en crear_descuento/
--                 actualizar_descuento): alternativa a monto_total + numero_cuotas. El usuario
--                 ingresa monto_total + la cuota quincenal exacta que ya conoce, y el sistema
--                 deriva numero_cuotas = CEIL(monto_total / cuota_exacta) — la ÚLTIMA cuota puede
--                 salir más chica, lo cual YA maneja el motor real (LEAST(monto_quincenal,
--                 monto_total - monto_pagado) en procesar_cuotas_descuentos_quincena, desde el fix
--                 de 20261015110000), no hace falta tocarlo para este caso.
--
--              Los 3 puntos son independientes — un descuento puede combinar cualquiera de los 3,
--              o ninguno (comportamiento anterior intacto, todos los parámetros nuevos son
--              opcionales con default).

BEGIN;

ALTER TABLE public.planilla_descuentos ADD COLUMN IF NOT EXISTS fecha_fin DATE;
COMMENT ON COLUMN public.planilla_descuentos.fecha_fin IS 'Opcional. Al llegar esta fecha, el descuento se completa automáticamente (ver procesar_cuotas_descuentos_quincena) sin importar el saldo pendiente.';

CREATE OR REPLACE FUNCTION public.crear_descuento(
    p_empleado_id UUID,
    p_categoria_id UUID,
    p_institucion TEXT,
    p_monto_quincenal NUMERIC,
    p_monto_total NUMERIC,
    p_numero_cuotas INT,
    p_user_id UUID,
    p_fecha_fin DATE DEFAULT NULL,
    p_cuota_exacta NUMERIC DEFAULT NULL,
    p_monto_pagado_inicial NUMERIC DEFAULT 0,
    p_cuotas_pagadas_inicial INT DEFAULT 0
) RETURNS public.planilla_descuentos
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.planilla_descuentos;
    v_monto_quincenal NUMERIC;
    v_numero_cuotas INT;
    v_categoria_nombre TEXT;
BEGIN
    SELECT nombre INTO v_categoria_nombre
    FROM public.planilla_descuento_categorias
    WHERE id = p_categoria_id;

    v_numero_cuotas := p_numero_cuotas;
    v_monto_quincenal := p_monto_quincenal;

    -- "Cuota exacta" tiene prioridad sobre "número de cuotas" si ambas llegan definidas (la UI
    -- solo manda una de las dos, nunca las dos a la vez).
    IF p_monto_total IS NOT NULL AND p_cuota_exacta IS NOT NULL THEN
        v_numero_cuotas := CEIL(p_monto_total / p_cuota_exacta)::INT;
        v_monto_quincenal := p_cuota_exacta;
    ELSIF p_monto_total IS NOT NULL AND p_numero_cuotas IS NOT NULL THEN
        v_monto_quincenal := ROUND(p_monto_total / p_numero_cuotas, 2);
    END IF;

    IF v_categoria_nombre = 'Préstamo bancario' AND (p_monto_total IS NULL OR v_numero_cuotas IS NULL) THEN
        RAISE EXCEPTION 'La categoría "Préstamo bancario" siempre debe tener monto total y número de cuotas — nunca puede quedar indefinida.';
    END IF;

    IF p_monto_pagado_inicial > 0 OR p_cuotas_pagadas_inicial > 0 THEN
        IF p_monto_total IS NULL THEN
            RAISE EXCEPTION 'Solo se puede registrar un saldo inicial en un descuento con monto total definido.';
        END IF;
        IF p_monto_pagado_inicial > p_monto_total THEN
            RAISE EXCEPTION 'El monto ya pagado no puede superar el monto total.';
        END IF;
        IF p_cuotas_pagadas_inicial >= v_numero_cuotas THEN
            RAISE EXCEPTION 'Las cuotas ya pagadas no pueden ser mayores o iguales al número total de cuotas.';
        END IF;
    END IF;

    INSERT INTO public.planilla_descuentos (
        tenant_id, empleado_id, categoria_id, institucion, monto_quincenal,
        monto_total, numero_cuotas, monto_pagado, cuotas_pagadas, fecha_fin, created_by
    ) VALUES (
        public.get_auth_tenant_id(), p_empleado_id, p_categoria_id, p_institucion, v_monto_quincenal,
        p_monto_total, v_numero_cuotas, COALESCE(p_monto_pagado_inicial, 0), COALESCE(p_cuotas_pagadas_inicial, 0),
        p_fecha_fin, p_user_id
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.actualizar_descuento(
    p_descuento_id UUID,
    p_categoria_id UUID,
    p_institucion TEXT,
    p_monto_quincenal NUMERIC,
    p_monto_total NUMERIC,
    p_numero_cuotas INT,
    p_fecha_fin DATE DEFAULT NULL,
    p_cuota_exacta NUMERIC DEFAULT NULL
) RETURNS public.planilla_descuentos
LANGUAGE plpgsql
AS $$
DECLARE
    v_descuento public.planilla_descuentos;
    v_result public.planilla_descuentos;
    v_monto_quincenal NUMERIC;
    v_numero_cuotas INT;
BEGIN
    SELECT * INTO v_descuento FROM public.planilla_descuentos WHERE id = p_descuento_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Descuento no encontrado.';
    END IF;

    v_numero_cuotas := p_numero_cuotas;

    IF p_monto_total IS NOT NULL AND p_cuota_exacta IS NOT NULL THEN
        -- La cuota exacta ES el monto a cobrar, tal cual — no se recalcula contra lo ya pagado
        -- (a diferencia del modo "número de cuotas" de abajo), es un dato fijo que el usuario
        -- conoce de antemano (ej. ya viene de un contrato de préstamo).
        v_numero_cuotas := CEIL(p_monto_total / p_cuota_exacta)::INT;
        v_monto_quincenal := p_cuota_exacta;
    ELSIF p_monto_total IS NOT NULL AND p_numero_cuotas IS NOT NULL THEN
        v_monto_quincenal := CASE WHEN v_descuento.cuotas_pagadas > 0 THEN
            ROUND(
                (p_monto_total - v_descuento.monto_pagado)
                / GREATEST(p_numero_cuotas - v_descuento.cuotas_pagadas, 1),
                2
            )
        ELSE
            ROUND(p_monto_total / p_numero_cuotas, 2)
        END;
    ELSE
        v_monto_quincenal := p_monto_quincenal;
    END IF;

    UPDATE public.planilla_descuentos
    SET categoria_id = p_categoria_id,
        institucion = p_institucion,
        monto_quincenal = v_monto_quincenal,
        monto_total = p_monto_total,
        numero_cuotas = v_numero_cuotas,
        fecha_fin = p_fecha_fin,
        updated_at = now()
    WHERE id = p_descuento_id
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

-- Redefinición basada en la vigente (20261015110000) — único cambio real: manejo de fecha_fin.
-- El filtro WHERE del loop y el cálculo de v_monto quedan intactos.
CREATE OR REPLACE FUNCTION public.procesar_cuotas_descuentos_quincena(
    p_quincena_id UUID,
    p_user_id UUID
) RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_quincena_fecha_inicio DATE;
    v_quincena_fecha_fin DATE;
    v_descuento RECORD;
    v_monto NUMERIC;
    v_nuevo_monto_pagado NUMERIC;
    v_procesados INT := 0;
BEGIN
    SELECT fecha_inicio, fecha_fin INTO v_quincena_fecha_inicio, v_quincena_fecha_fin
    FROM public.quincenas
    WHERE id = p_quincena_id AND tenant_id = v_tenant_id;

    FOR v_descuento IN
        SELECT d.* FROM public.planilla_descuentos d
        JOIN public.planilla_descuento_categorias c ON c.id = d.categoria_id
        WHERE d.tenant_id = v_tenant_id
          AND d.estado = 'activo'
          AND NOT (c.tipo = 'fijo' AND d.validado_at IS NULL) -- US-DESC-05 CA1
          AND NOT EXISTS (
              SELECT 1 FROM public.planilla_descuento_eventos e
              WHERE e.descuento_id = d.id AND e.quincena_id = p_quincena_id
          )
        FOR UPDATE OF d
    LOOP
        -- 2026-10-15 (fecha_fin): si el plazo ya venció ANTES de que empiece esta quincena (ej.
        -- se saltearon quincenas sin procesar este descuento), no corresponde cobrar nada más —
        -- se completa directo, sin generar evento de pago.
        IF v_descuento.fecha_fin IS NOT NULL AND v_descuento.fecha_fin < v_quincena_fecha_inicio THEN
            UPDATE public.planilla_descuentos
            SET estado = 'completado', updated_at = now()
            WHERE id = v_descuento.id;
            CONTINUE;
        END IF;

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
            estado = CASE
                -- La quincena que CONTIENE fecha_fin todavía cobra (arriba), pero de acá en más
                -- el descuento se completa sin importar el saldo pendiente.
                WHEN v_descuento.fecha_fin IS NOT NULL AND v_descuento.fecha_fin <= v_quincena_fecha_fin THEN 'completado'
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

COMMIT;
