-- Migration: Vacaciones — validar que no se registren más días de los acumulados (IMPL-65 CA7)
-- Author: @alexis
-- Description: Defecto real UAT (IMPL-179): se pudo registrar una vacación de 30 días para una
--              empleada con solo 22.5 días acumulados, sin ninguna advertencia ni bloqueo.
--              CA7 de IMPL-65 exige esta validación y nunca se había implementado, ni acá ni en
--              el cliente — `crear_vacacion`/`actualizar_vacacion` solo validaban solapamiento
--              de fechas (20260907300000), nunca el saldo disponible.
--
--              El check se agrega en el RPC (no solo en el modal) porque es el único punto por
--              el que TODO cliente pasa — mismo criterio que el chequeo de solapamiento ya
--              existente en estas mismas funciones, y que el trigger de incapacidades
--              (fn_validar_solapamiento_incapacidad) para tablas sin RPC propio.
--
--              "Acumulados" replica en SQL la misma fórmula de VacacionesResumenSection.tsx
--              (15 días/año de servicio, Código de Trabajo Art. 177, IMPL-7): años completos +
--              meses del año en curso / 12, redondeado a 1 decimal. "Gozados previos" replica
--              la misma convención ya documentada en 20260907300000: SOLO cuenta
--              `NOT no_gozada` — una vacación `no_gozada` es un bono pagado (Bono con Renta 10%,
--              DRN §9.3), no ocupa saldo de días de descanso, así que el chequeo de esta
--              migración se omite por completo cuando `p_no_gozada = true` (no se está tocando
--              esa convención, solo respetándola).
--
--              Se re-crea `crear_vacacion`/`actualizar_vacacion` completo porque Postgres no
--              permite parchear el cuerpo de una función PL/pgSQL existente — esta versión
--              PRESERVA el chequeo de solapamiento y el parámetro `p_conciliado` de
--              20260907300000; si se omitiera cualquiera de los dos se revertiría en silencio.

BEGIN;

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
BEGIN
    -- Bugfix (hallazgo UAT): una vacación `no_gozada` es un bono pagado, no ausencia real —
    -- no debe bloquear ni ser bloqueada por el chequeo de solapamiento (misma convención que
    -- aplican los consumidores de ausencias del proyecto, ver cabecera de 20260907300000).
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

    -- IMPL-179 (CA7 de IMPL-65) — no permitir registrar más días de vacación GOZADA de los
    -- acumulados por antigüedad menos lo ya gozado. `no_gozada` queda afuera a propósito (ver
    -- cabecera).
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

    INSERT INTO public.planilla_vacaciones (
        tenant_id, quincena_id, empleado_id, fecha_inicio, fecha_fin, dias,
        sueldo_diario, monto_base, recargo_30, monto_total, no_gozada, conciliado, created_by
    ) VALUES (
        public.get_auth_tenant_id(), p_quincena_id, p_empleado_id, p_fecha_inicio, p_fecha_fin, v_dias,
        v_sueldo_diario, v_monto_base, v_recargo_30, v_monto_base + v_recargo_30, p_no_gozada, p_conciliado, p_user_id
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

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

    -- Mismo fix que crear_vacacion: las vacaciones `no_gozada` (bono pagado) no ocupan tiempo
    -- de ausencia, se excluyen del chequeo de solapamiento.
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

    -- IMPL-179 (CA7 de IMPL-65) — mismo chequeo que crear_vacacion, excluyendo este propio
    -- registro de la suma de "ya gozados" (se está reemplazando su valor, no sumándolo aparte).
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

    RETURN v_result;
END;
$$;

COMMIT;
