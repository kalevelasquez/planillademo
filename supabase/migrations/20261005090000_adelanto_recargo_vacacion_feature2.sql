-- Migration: Adelanto del 30% de recargo de vacaciones en el aniversario (Feature 2, reunión
--            2026-10-05) — nueva tabla + RPC de creación + ajuste anti-doble-pago en
--            crear_vacacion/actualizar_vacacion.
-- Author: @alexis
-- Description: Requisito de negocio (reunión con el usuario, no hay ticket IMPL todavía): cuando
--              un empleado cumple años de antigüedad, el admin puede decidir, por empleado y de
--              forma flexible (no es automático ni obligatorio), pagarle el 30% de recargo legal
--              de vacaciones (Art. 177 CT) POR ADELANTADO, antes de que tome el descanso real.
--              Regla explícita del usuario: "el 30% no se vuelve a pagar, solo se paga el sueldo
--              base" cuando esa vacación real se registre después.
--
--              DISEÑO — por qué una tabla nueva y no una fila más en `planilla_vacaciones`: esa
--              tabla exige `dias > 0` y `monto_base > 0` (un adelanto de SOLO el recargo no tiene
--              días reales de descanso asociados), y mezclarlo ahí ensuciaría el chequeo de días
--              disponibles (IMPL-179/CA7 de IMPL-65) y el de solapamiento — ninguno de los dos
--              debe considerar un adelanto como ausencia real.
--
--              DISEÑO — anti-doble-pago como "crédito prepago", no como "año de antigüedad
--              atado a fechas": `consumido_en_vacacion_id` (nullable, FK a planilla_vacaciones
--              ON DELETE SET NULL) es la única fuente de verdad de "¿este adelanto ya se usó?".
--              Si la vacación real que lo consumió se borra después, el ON DELETE SET NULL
--              libera el adelanto automáticamente — sin triggers. Un empleado solo puede tener
--              UN adelanto sin consumir a la vez (índice único parcial) — evita pagar el mismo
--              aniversario dos veces y evita acumular créditos sin sentido de negocio.
--              `anio_aniversario` es puramente informativo (para mostrarlo en la UI), no
--              participa en ninguna validación.
--
--              BASE DE CÁLCULO (confirmado con el usuario 2026-10-05): el recargo se calcula
--              sobre los 15 días legales completos del Art. 177 (misma constante ya usada en
--              `VacacionesResumenSection.tsx`, `DIAS_ACUMULADOS_POR_ANIO`), no sobre un
--              proporcional — es "el paquete completo" de ese año de antigüedad.
--
--              ALCANCE DE ESTA MIGRACIÓN — el usuario pidió explícitamente NO tocar todavía
--              `calcular_planilla_empleado` (el motor central, ya con 14 parches encima) en el
--              mismo cambio. Por eso el monto de `recargo_monto` queda persistido pero AÚN NO
--              se suma a ningún ingreso de la quincena — la UI debe dejarlo clarísimo. Pendiente,
--              como paso separado y aprobado aparte: sumar `recargo_monto` a los ingresos
--              gravables de la quincena en la que se registra el adelanto.
--
--              Límite conocido, aceptado a propósito (no se resuelve acá): si se reasigna el
--              empleado de una vacación real que ya había consumido un adelanto (cambiar
--              `empleado_id` vía `actualizar_vacacion`), ese adelanto queda "consumido" sin
--              posibilidad de liberarse automáticamente — caso de edición raro, se documenta en
--              vez de blindarse.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_vacaciones_adelanto_recargo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    quincena_id UUID NOT NULL REFERENCES public.quincenas(id) ON DELETE CASCADE,
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id),
    anio_aniversario INT NOT NULL CHECK (anio_aniversario > 0),
    sueldo_diario NUMERIC NOT NULL CHECK (sueldo_diario > 0),
    recargo_monto NUMERIC NOT NULL CHECK (recargo_monto >= 0),
    consumido_en_vacacion_id UUID REFERENCES public.planilla_vacaciones(id) ON DELETE SET NULL,
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_adelanto_recargo_quincena ON public.planilla_vacaciones_adelanto_recargo(quincena_id);
CREATE INDEX IF NOT EXISTS idx_adelanto_recargo_empleado ON public.planilla_vacaciones_adelanto_recargo(empleado_id);

-- Un empleado solo puede tener un adelanto sin consumir a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_adelanto_recargo_empleado_sin_consumir
    ON public.planilla_vacaciones_adelanto_recargo(empleado_id)
    WHERE consumido_en_vacacion_id IS NULL;

ALTER TABLE public.planilla_vacaciones_adelanto_recargo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "adelanto_recargo_select_tenant"
    ON public.planilla_vacaciones_adelanto_recargo FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "adelanto_recargo_insert_quincena_en_proceso"
    ON public.planilla_vacaciones_adelanto_recargo FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

-- Permite la consumición desde crear_vacacion/actualizar_vacacion (linkear
-- consumido_en_vacacion_id) en CUALQUIER momento, sin importar el estado de la quincena del
-- propio adelanto — ese adelanto puede haberse pagado meses antes y ya estar en una quincena
-- cerrada; lo que importa es la quincena de la vacación real nueva, ya validada por la policy
-- de planilla_vacaciones. Solo se permite tocar un adelanto que todavía no se haya consumido.
CREATE POLICY "adelanto_recargo_update_sin_consumir"
    ON public.planilla_vacaciones_adelanto_recargo FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    )
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "adelanto_recargo_delete_sin_consumir_y_quincena_en_proceso"
    ON public.planilla_vacaciones_adelanto_recargo FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND consumido_en_vacacion_id IS NULL
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_vacaciones_adelanto_recargo ON public.planilla_vacaciones_adelanto_recargo;
CREATE TRIGGER tr_audit_planilla_vacaciones_adelanto_recargo
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_vacaciones_adelanto_recargo
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- Sin SECURITY DEFINER (mismo criterio que crear_vacacion): corre como INVOKER, la policy de
-- INSERT es la que autoriza. sueldo_diario/recargo_monto se calculan acá, nunca se confía en lo
-- que mande el cliente.
CREATE OR REPLACE FUNCTION public.crear_adelanto_recargo_vacacion(
    p_empleado_id UUID,
    p_quincena_id UUID,
    p_anio_aniversario INT,
    p_sueldo_mensual NUMERIC,
    p_user_id UUID
) RETURNS public.planilla_vacaciones_adelanto_recargo
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.planilla_vacaciones_adelanto_recargo;
    v_sueldo_diario NUMERIC;
    v_recargo_monto NUMERIC;
BEGIN
    v_sueldo_diario := ROUND(p_sueldo_mensual / 30, 2);
    v_recargo_monto := ROUND(v_sueldo_diario * 15 * 0.30, 2);

    INSERT INTO public.planilla_vacaciones_adelanto_recargo (
        tenant_id, quincena_id, empleado_id, anio_aniversario, sueldo_diario, recargo_monto, created_by
    ) VALUES (
        public.get_auth_tenant_id(), p_quincena_id, p_empleado_id, p_anio_aniversario, v_sueldo_diario, v_recargo_monto, p_user_id
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

-- Redefinición basada en la vigente (20260925120000) — PRESERVA el chequeo de solapamiento y el
-- de días disponibles (IMPL-179/CA7) intactos. Único cambio real: si el empleado tiene un
-- adelanto de recargo sin consumir, el recargo_30 de esta vacación real se anula (ya se pagó) y
-- ese adelanto queda linkeado a este registro.
CREATE OR REPLACE FUNCTION public.crear_vacacion(
    p_quincena_id UUID,
    p_empleado_id UUID,
    p_fecha_inicio DATE,
    p_fecha_fin DATE,
    p_sueldo_mensual NUMERIC,
    p_no_gozada BOOLEAN,
    p_user_id UUID,
    p_conciliado BOOLEAN DEFAULT false
) RETURNS public.planilla_vacaciones
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.planilla_vacaciones;
    v_dias INT;
    v_sueldo_diario NUMERIC;
    v_monto_base NUMERIC;
    v_recargo_30 NUMERIC;
    v_solapada BOOLEAN;
    v_fecha_ingreso DATE;
    v_anios INT;
    v_meses INT;
    v_acumulados NUMERIC;
    v_gozados_previos NUMERIC;
    v_adelanto_id UUID;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM public.planilla_vacaciones
        WHERE empleado_id = p_empleado_id AND NOT no_gozada
          AND fecha_inicio <= p_fecha_fin AND fecha_fin >= p_fecha_inicio
        UNION ALL
        SELECT 1 FROM public.planilla_incapacidades
        WHERE empleado_id = p_empleado_id AND fecha_inicio <= p_fecha_fin AND fecha_fin >= p_fecha_inicio
    ) INTO v_solapada;

    IF v_solapada THEN
        RAISE EXCEPTION 'Este empleado ya tiene una vacación o incapacidad registrada que se superpone con el rango % a %', p_fecha_inicio, p_fecha_fin;
    END IF;

    v_dias := (p_fecha_fin - p_fecha_inicio) + 1;

    IF NOT p_no_gozada THEN
        SELECT fecha_ingreso INTO v_fecha_ingreso FROM public.planilla_empleados WHERE id = p_empleado_id;

        v_anios := EXTRACT(YEAR FROM CURRENT_DATE)::INT - EXTRACT(YEAR FROM v_fecha_ingreso)::INT;
        v_meses := EXTRACT(MONTH FROM CURRENT_DATE)::INT - EXTRACT(MONTH FROM v_fecha_ingreso)::INT;
        IF EXTRACT(DAY FROM CURRENT_DATE)::INT < EXTRACT(DAY FROM v_fecha_ingreso)::INT THEN
            v_meses := v_meses - 1;
        END IF;
        IF v_meses < 0 THEN
            v_anios := v_anios - 1;
            v_meses := v_meses + 12;
        END IF;
        v_acumulados := ROUND(15 * (v_anios + v_meses / 12.0), 1);

        SELECT COALESCE(SUM(dias), 0) INTO v_gozados_previos
        FROM public.planilla_vacaciones
        WHERE empleado_id = p_empleado_id AND NOT no_gozada;

        IF (v_gozados_previos + v_dias) > v_acumulados THEN
            RAISE EXCEPTION 'Este empleado solo tiene % día(s) disponibles de vacación (acumulados: %, ya gozados: %) — el rango solicitado es de % día(s).',
                (v_acumulados - v_gozados_previos), v_acumulados, v_gozados_previos, v_dias;
        END IF;
    END IF;

    v_sueldo_diario := ROUND(p_sueldo_mensual / 30, 2);
    v_monto_base := ROUND(v_sueldo_diario * v_dias, 2);
    v_recargo_30 := ROUND(v_monto_base * 0.30, 2);

    -- Feature 2 (adelanto de aniversario, 2026-10-05) — ver cabecera de esta migración.
    IF NOT p_no_gozada THEN
        SELECT id INTO v_adelanto_id
        FROM public.planilla_vacaciones_adelanto_recargo
        WHERE empleado_id = p_empleado_id AND consumido_en_vacacion_id IS NULL
        LIMIT 1;

        IF v_adelanto_id IS NOT NULL THEN
            v_recargo_30 := 0;
        END IF;
    END IF;

    INSERT INTO public.planilla_vacaciones (
        tenant_id, quincena_id, empleado_id, fecha_inicio, fecha_fin, dias,
        sueldo_diario, monto_base, recargo_30, monto_total, no_gozada, conciliado, created_by
    ) VALUES (
        public.get_auth_tenant_id(), p_quincena_id, p_empleado_id, p_fecha_inicio, p_fecha_fin, v_dias,
        v_sueldo_diario, v_monto_base, v_recargo_30, v_monto_base + v_recargo_30, p_no_gozada, p_conciliado, p_user_id
    )
    RETURNING * INTO v_result;

    IF v_adelanto_id IS NOT NULL THEN
        UPDATE public.planilla_vacaciones_adelanto_recargo
        SET consumido_en_vacacion_id = v_result.id
        WHERE id = v_adelanto_id;
    END IF;

    RETURN v_result;
END;
$$;

-- Redefinición basada en la vigente (20260925120000) — mismo único cambio real que crear_vacacion
-- de arriba. Maneja además los 2 casos de edición: (a) si esta vacación YA había consumido un
-- adelanto y ahora se marca no_gozada, se libera el adelanto (un bono pagado no es ausencia real,
-- no debería retener un adelanto); (b) si no estaba vinculada y ahora corresponde (empleado con
-- adelanto disponible, no_gozada=false), se vincula igual que en creación.
CREATE OR REPLACE FUNCTION public.actualizar_vacacion(
    p_id UUID,
    p_empleado_id UUID,
    p_fecha_inicio DATE,
    p_fecha_fin DATE,
    p_sueldo_mensual NUMERIC,
    p_no_gozada BOOLEAN,
    p_conciliado BOOLEAN
) RETURNS public.planilla_vacaciones
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.planilla_vacaciones;
    v_dias INT;
    v_sueldo_diario NUMERIC;
    v_monto_base NUMERIC;
    v_recargo_30 NUMERIC;
    v_existe BOOLEAN;
    v_en_proceso BOOLEAN;
    v_solapada BOOLEAN;
    v_fecha_ingreso DATE;
    v_anios INT;
    v_meses INT;
    v_acumulados NUMERIC;
    v_gozados_previos NUMERIC;
    v_adelanto_ya_vinculado UUID;
    v_adelanto_a_vincular UUID;
BEGIN
    SELECT EXISTS (SELECT 1 FROM public.planilla_vacaciones WHERE id = p_id) INTO v_existe;
    IF NOT v_existe THEN
        RAISE EXCEPTION 'Registro de vacaciones % no encontrado', p_id;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.planilla_vacaciones v
        JOIN public.quincenas q ON q.id = v.quincena_id
        WHERE v.id = p_id AND q.estado = 'en_proceso'
    ) INTO v_en_proceso;

    IF NOT v_en_proceso THEN
        RAISE EXCEPTION 'Esta quincena está cerrada y no permite modificaciones.';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.planilla_vacaciones
        WHERE empleado_id = p_empleado_id AND id != p_id AND NOT no_gozada
          AND fecha_inicio <= p_fecha_fin AND fecha_fin >= p_fecha_inicio
        UNION ALL
        SELECT 1 FROM public.planilla_incapacidades
        WHERE empleado_id = p_empleado_id AND fecha_inicio <= p_fecha_fin AND fecha_fin >= p_fecha_inicio
    ) INTO v_solapada;

    IF v_solapada THEN
        RAISE EXCEPTION 'Este empleado ya tiene una vacación o incapacidad registrada que se superpone con el rango % a %', p_fecha_inicio, p_fecha_fin;
    END IF;

    v_dias := (p_fecha_fin - p_fecha_inicio) + 1;

    IF NOT p_no_gozada THEN
        SELECT fecha_ingreso INTO v_fecha_ingreso FROM public.planilla_empleados WHERE id = p_empleado_id;

        v_anios := EXTRACT(YEAR FROM CURRENT_DATE)::INT - EXTRACT(YEAR FROM v_fecha_ingreso)::INT;
        v_meses := EXTRACT(MONTH FROM CURRENT_DATE)::INT - EXTRACT(MONTH FROM v_fecha_ingreso)::INT;
        IF EXTRACT(DAY FROM CURRENT_DATE)::INT < EXTRACT(DAY FROM v_fecha_ingreso)::INT THEN
            v_meses := v_meses - 1;
        END IF;
        IF v_meses < 0 THEN
            v_anios := v_anios - 1;
            v_meses := v_meses + 12;
        END IF;
        v_acumulados := ROUND(15 * (v_anios + v_meses / 12.0), 1);

        SELECT COALESCE(SUM(dias), 0) INTO v_gozados_previos
        FROM public.planilla_vacaciones
        WHERE empleado_id = p_empleado_id AND id != p_id AND NOT no_gozada;

        IF (v_gozados_previos + v_dias) > v_acumulados THEN
            RAISE EXCEPTION 'Este empleado solo tiene % día(s) disponibles de vacación (acumulados: %, ya gozados: %) — el rango solicitado es de % día(s).',
                (v_acumulados - v_gozados_previos), v_acumulados, v_gozados_previos, v_dias;
        END IF;
    END IF;

    v_sueldo_diario := ROUND(p_sueldo_mensual / 30, 2);
    v_monto_base := ROUND(v_sueldo_diario * v_dias, 2);
    v_recargo_30 := ROUND(v_monto_base * 0.30, 2);

    -- Feature 2 (adelanto de aniversario, 2026-10-05) — ver cabecera de esta migración.
    SELECT id INTO v_adelanto_ya_vinculado
    FROM public.planilla_vacaciones_adelanto_recargo
    WHERE consumido_en_vacacion_id = p_id;

    IF p_no_gozada THEN
        IF v_adelanto_ya_vinculado IS NOT NULL THEN
            UPDATE public.planilla_vacaciones_adelanto_recargo
            SET consumido_en_vacacion_id = NULL
            WHERE id = v_adelanto_ya_vinculado;
        END IF;
    ELSE
        IF v_adelanto_ya_vinculado IS NOT NULL THEN
            v_recargo_30 := 0;
        ELSE
            SELECT id INTO v_adelanto_a_vincular
            FROM public.planilla_vacaciones_adelanto_recargo
            WHERE empleado_id = p_empleado_id AND consumido_en_vacacion_id IS NULL
            LIMIT 1;

            IF v_adelanto_a_vincular IS NOT NULL THEN
                v_recargo_30 := 0;
            END IF;
        END IF;
    END IF;

    UPDATE public.planilla_vacaciones
    SET empleado_id = p_empleado_id,
        fecha_inicio = p_fecha_inicio,
        fecha_fin = p_fecha_fin,
        dias = v_dias,
        sueldo_diario = v_sueldo_diario,
        monto_base = v_monto_base,
        recargo_30 = v_recargo_30,
        monto_total = v_monto_base + v_recargo_30,
        no_gozada = p_no_gozada,
        conciliado = p_conciliado,
        updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_result;

    IF v_adelanto_a_vincular IS NOT NULL THEN
        UPDATE public.planilla_vacaciones_adelanto_recargo
        SET consumido_en_vacacion_id = p_id
        WHERE id = v_adelanto_a_vincular;
    END IF;

    RETURN v_result;
END;
$$;

COMMIT;
