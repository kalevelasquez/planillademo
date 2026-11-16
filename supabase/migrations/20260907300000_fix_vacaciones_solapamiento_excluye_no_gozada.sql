-- Migration: Vacaciones — el chequeo de solapamiento no debe contar vacaciones NO GOZADAS
-- Author: @alexis
-- Description: Hallazgo UAT (IMPL-144/defecto): registrar vacaciones falla para empleados
--              específicos (caso reportado: Bernardo Solorzano) con el mensaje de solapamiento,
--              mientras que para otros empleados el mismo flujo funciona.
--
--              Causa raíz: el chequeo de solapamiento agregado en `20260907220000` trata TODAS
--              las filas de `planilla_vacaciones` como tiempo de ausencia, pero el proyecto ya
--              establece la convención opuesta para `no_gozada = true` — es un BONO pagado
--              (mecanismo "Bono con Renta 10%", DRN §9.3), el empleado NO estuvo ausente esos
--              días. La excluyen a propósito todos los consumidores de ausencias:
--                - `ImportacionMarcacionesSection.tsx` -> `vacaciones.filter((v) => !v.no_gozada)`
--                - `VacacionesResumenSection.tsx` -> días gozados = `NOT no_gozada`
--                - `marcacionesValidacionUtils.ts` -> "no_gozada=true ... no son ausencia real"
--                - Motor de cálculo (Paso 5) -> `FILTER (WHERE NOT no_gozada)`
--
--              Si el empleado tiene un bono no gozado cuyo rango cubre las fechas intentadas
--              (típico: se registra por el período del aniversario), registrar la vacación REAL
--              en el mismo rango disparaba un falso positivo y el RPC rechazaba el guardado.
--
--              Fix: excluir `no_gozada = true` del lado de `planilla_vacaciones` en los 3
--              chequeos (crear_vacacion, actualizar_vacacion, fn_validar_solapamiento_
--              incapacidad). Las incapacidades y las vacaciones gozadas SÍ siguen contando
--              como ausencia real — no se relaja el chequeo, solo se alinea con la convención
--              ya documentada. Se re-crea `crear_vacacion` completo porque Postgres no permite
--              parchear un solo parámetro de una función PL/pgSQL existente — esta versión
--              PRESERVA el parámetro `p_conciliado` agregado en `20260907290000` (si se
--              omitiera, se revertiría silenciosamente ese fix).

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
BEGIN
    -- Bugfix (hallazgo UAT): una vacación `no_gozada` es un bono pagado, no ausencia real —
    -- no debe bloquear ni ser bloqueada por el chequeo de solapamiento (misma convención que
    -- aplican los consumidores de ausencias del proyecto, ver cabecera de esta migración).
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

-- Mismo criterio para incapacidades: el lado de `planilla_vacaciones` del trigger excluye las
-- `no_gozada` (bono pagado, no ausencia real). Incapacidad-vs-incapacidad y
-- incapacidad-vs-vacación gozada siguen bloqueadas.
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
        WHERE empleado_id = NEW.empleado_id AND NOT no_gozada
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
