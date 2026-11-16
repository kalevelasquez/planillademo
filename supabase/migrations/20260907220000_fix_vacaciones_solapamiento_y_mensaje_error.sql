-- Migration: Vacaciones — 2 hallazgos de la auditoría corregidos (2026-08-13)
-- Author: @alexis
-- Description: Cuarta pasada de la auditoría crítica módulo por módulo:
--
--              1. Sin detección de solapamiento: dos vacaciones del mismo empleado con fechas
--                 solapadas, o una vacación solapada con una incapacidad ya registrada, se
--                 guardaban sin ninguna advertencia. Se agrega un chequeo manual dentro de
--                 `crear_vacacion`/`actualizar_vacacion` (mismo criterio que `create_quincena`:
--                 el proyecto no tiene precedente de EXCLUDE constraints/btree_gist) contra
--                 AMBAS tablas (`planilla_vacaciones` y `planilla_incapacidades`) para el mismo
--                 empleado.
--
--              2. `actualizar_vacacion` mostraba el genérico "Registro no encontrado" cuando en
--                 realidad la causa era que la quincena ya no está `en_proceso` (RLS bloquea el
--                 UPDATE, 0 filas afectadas, PL/pgSQL ve `NOT FOUND`) — mismo caso ya resuelto
--                 correctamente en `incapacidadesService.actualizar`/`vacacionesService.
--                 cambiarConciliado`, que sí distinguen "no existe" de "bloqueado por RLS". Se
--                 agrega un chequeo explícito ANTES del UPDATE (la función no es
--                 `SECURITY DEFINER`, así que el SELECT de chequeo sigue sujeto a la RLS de
--                 SELECT — solo tenant-scoped, no bloquea la lectura).
--
--              NOTA: el prorrateo de vacaciones/incapacidades cuyo rango cruza el límite de una
--              quincena (hallazgo relacionado, mayor alcance — requiere cambiar el motor de
--              cálculo para sumar por solape de fecha en vez de quincena_id exacto, y prorratear
--              el monto por días dentro de cada quincena) queda deliberadamente FUERA de esta
--              migración — es un cambio más profundo al motor de cálculo que amerita su propio
--              diseño dedicado, no apurarlo en la misma pasada que estos 2 fixes más contenidos.

BEGIN;

CREATE OR REPLACE FUNCTION public.crear_vacacion(
    p_quincena_id UUID,
    p_empleado_id UUID,
    p_fecha_inicio DATE,
    p_fecha_fin DATE,
    p_sueldo_mensual NUMERIC,
    p_no_gozada BOOLEAN,
    p_user_id UUID
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
BEGIN
    -- Bugfix (auditoría): antes se podía registrar una vacación solapada con otra vacación, o
    -- con una incapacidad, del mismo empleado, sin ninguna advertencia.
    SELECT EXISTS (
        SELECT 1 FROM public.planilla_vacaciones
        WHERE empleado_id = p_empleado_id AND fecha_inicio <= p_fecha_fin AND fecha_fin >= p_fecha_inicio
        UNION ALL
        SELECT 1 FROM public.planilla_incapacidades
        WHERE empleado_id = p_empleado_id AND fecha_inicio <= p_fecha_fin AND fecha_fin >= p_fecha_inicio
    ) INTO v_solapada;

    IF v_solapada THEN
        RAISE EXCEPTION 'Este empleado ya tiene una vacación o incapacidad registrada que se superpone con el rango % a %', p_fecha_inicio, p_fecha_fin;
    END IF;

    v_dias := (p_fecha_fin - p_fecha_inicio) + 1;
    v_sueldo_diario := ROUND(p_sueldo_mensual / 30, 2);
    v_monto_base := ROUND(v_sueldo_diario * v_dias, 2);
    v_recargo_30 := ROUND(v_monto_base * 0.30, 2);

    INSERT INTO public.planilla_vacaciones (
        tenant_id, quincena_id, empleado_id, fecha_inicio, fecha_fin, dias,
        sueldo_diario, monto_base, recargo_30, monto_total, no_gozada, created_by
    ) VALUES (
        public.get_auth_tenant_id(), p_quincena_id, p_empleado_id, p_fecha_inicio, p_fecha_fin, v_dias,
        v_sueldo_diario, v_monto_base, v_recargo_30, v_monto_base + v_recargo_30, p_no_gozada, p_user_id
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
BEGIN
    SELECT EXISTS (SELECT 1 FROM public.planilla_vacaciones WHERE id = p_id) INTO v_existe;
    IF NOT v_existe THEN
        RAISE EXCEPTION 'Registro de vacaciones % no encontrado', p_id;
    END IF;

    -- Bugfix (auditoría): antes, si la quincena ya no estaba en_proceso, el UPDATE de más abajo
    -- afectaba 0 filas por RLS y esta función lo confundía con "no encontrado" — este chequeo
    -- explícito (el SELECT sigue sujeto solo a la RLS de SELECT, tenant-scoped) da el mensaje
    -- correcto, igual que ya hacen incapacidadesService/vacacionesService.cambiarConciliado.
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
        WHERE empleado_id = p_empleado_id AND id != p_id AND fecha_inicio <= p_fecha_fin AND fecha_fin >= p_fecha_inicio
        UNION ALL
        SELECT 1 FROM public.planilla_incapacidades
        WHERE empleado_id = p_empleado_id AND fecha_inicio <= p_fecha_fin AND fecha_fin >= p_fecha_inicio
    ) INTO v_solapada;

    IF v_solapada THEN
        RAISE EXCEPTION 'Este empleado ya tiene una vacación o incapacidad registrada que se superpone con el rango % a %', p_fecha_inicio, p_fecha_fin;
    END IF;

    v_dias := (p_fecha_fin - p_fecha_inicio) + 1;
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

-- `planilla_incapacidades` no pasa por un RPC (crea/actualiza vía `.insert()`/`.update()`
-- directo desde `incapacidadesService.ts`) — un trigger es el lugar más simple para aplicar el
-- mismo chequeo de solapamiento sin cambiar esa arquitectura. Cubre incapacidad-vs-incapacidad
-- e incapacidad-vs-vacación para el mismo empleado (el caso vacación-vs-incapacidad ya lo cubren
-- crear_vacacion/actualizar_vacacion de arriba).
CREATE OR REPLACE FUNCTION public.fn_validar_solapamiento_incapacidad()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_solapada BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM public.planilla_incapacidades
        WHERE empleado_id = NEW.empleado_id AND id IS DISTINCT FROM NEW.id
          AND fecha_inicio <= NEW.fecha_fin AND fecha_fin >= NEW.fecha_inicio
        UNION ALL
        SELECT 1 FROM public.planilla_vacaciones
        WHERE empleado_id = NEW.empleado_id
          AND fecha_inicio <= NEW.fecha_fin AND fecha_fin >= NEW.fecha_inicio
    ) INTO v_solapada;

    IF v_solapada THEN
        RAISE EXCEPTION 'Este empleado ya tiene una vacación o incapacidad registrada que se superpone con el rango % a %', NEW.fecha_inicio, NEW.fecha_fin;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validar_solapamiento_incapacidad ON public.planilla_incapacidades;
CREATE TRIGGER tr_validar_solapamiento_incapacidad
    BEFORE INSERT OR UPDATE ON public.planilla_incapacidades
    FOR EACH ROW EXECUTE FUNCTION public.fn_validar_solapamiento_incapacidad();

COMMIT;
