-- Migration: Permisos como módulo obligatorio (IMPL-16 US-QNA-06 CA3, corrección de septiembre 2026)
-- Author: @alexis
-- Description: La lista de módulos obligatorios en quincenas Normal/Aguinaldo está duplicada
--              en 3 lugares de la base (2 CHECK constraints + el RPC `enviar_a_aprobacion`,
--              más el array del frontend en `modulosQuincenaService.ts`) — hay que mantener
--              los 4 sincronizados. Esta migración toca los 3 lados de base de datos.
--
--              Sin backfill de datos: `inicializarEstados` en el frontend ya auto-sana la fila
--              faltante en la primera carga del checklist tras el deploy (a diferencia de
--              20260724090000, que sí necesitó backfill porque bloqueaba INSERTs vía RLS).
--
--              Nota de riesgo PRE-EXISTENTE, no introducida por este cambio:
--              `enviar_a_aprobacion` nunca filtró por `tipo_quincena` — corre igual para
--              Quincena 25 que para Normal/Aguinaldo, aunque el frontend salta el checklist
--              entero para Quincena 25. Si aparece en QA, no es una regresión de acá.

BEGIN;

ALTER TABLE public.quincena_modulo_estado
    DROP CONSTRAINT IF EXISTS quincena_modulo_estado_modulo_check;
ALTER TABLE public.quincena_modulo_estado
    ADD CONSTRAINT quincena_modulo_estado_modulo_check
    CHECK (modulo IN (
        'horas_extras', 'viaticos', 'vacaciones', 'bonificaciones', 'anticipos', 'incapacidades', 'descuentos', 'permisos'
    ));

ALTER TABLE public.quincena_modulo_ubicacion_estado
    DROP CONSTRAINT IF EXISTS quincena_modulo_ubicacion_estado_modulo_check;
ALTER TABLE public.quincena_modulo_ubicacion_estado
    ADD CONSTRAINT quincena_modulo_ubicacion_estado_modulo_check
    CHECK (modulo IN (
        'horas_extras', 'viaticos', 'vacaciones', 'bonificaciones', 'anticipos', 'incapacidades', 'descuentos', 'permisos'
    ));

-- Redefinición basada en la vigente (20260907380000_admin_copia_notificaciones_y_restaurar_guard_reapertura.sql)
-- — único cambio real: agregar 'permisos' al array de módulos obligatorios.
CREATE OR REPLACE FUNCTION public.enviar_a_aprobacion(p_quincena_id UUID)
RETURNS public.quincenas
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.quincenas;
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_modulos_faltantes INT;
    v_total_activos INT;
    v_calculo_count INT;
    v_reabierta_at TIMESTAMPTZ;
    v_calculo_obsoleto_count INT;
    v_nombre_ejecutor TEXT;
BEGIN
    SELECT COUNT(*) INTO v_modulos_faltantes
    FROM unnest(ARRAY['horas_extras', 'viaticos', 'vacaciones', 'bonificaciones', 'anticipos', 'incapacidades', 'descuentos', 'permisos']) AS m
    WHERE NOT EXISTS (
        SELECT 1 FROM public.quincena_modulo_estado qme
        WHERE qme.quincena_id = p_quincena_id AND qme.modulo = m AND qme.estado = 'confirmado'
    );

    IF v_modulos_faltantes > 0 THEN
        RAISE EXCEPTION 'El checklist de módulos no está completo — quedan % módulo(s) sin confirmar.', v_modulos_faltantes;
    END IF;

    SELECT COUNT(*) INTO v_total_activos
    FROM public.planilla_empleados
    WHERE tenant_id = v_tenant_id AND deleted_at IS NULL AND estado = 'activo';

    SELECT COUNT(*) INTO v_calculo_count
    FROM public.planilla_calculo_empleado
    WHERE quincena_id = p_quincena_id;

    IF v_total_activos = 0 OR v_calculo_count < v_total_activos THEN
        RAISE EXCEPTION 'El Cálculo de Planilla no está completo para todos los empleados activos.';
    END IF;

    SELECT reabierta_at INTO v_reabierta_at FROM public.quincenas WHERE id = p_quincena_id;

    IF v_reabierta_at IS NOT NULL THEN
        SELECT COUNT(*) INTO v_calculo_obsoleto_count
        FROM public.planilla_calculo_empleado
        WHERE quincena_id = p_quincena_id AND calculado_at < v_reabierta_at;

        IF v_calculo_obsoleto_count > 0 THEN
            RAISE EXCEPTION 'Esta quincena fue reabierta después del último cálculo de % empleado(s) — volvé a "Calcular Planilla de esta Quincena" antes de enviar a aprobación.', v_calculo_obsoleto_count;
        END IF;
    END IF;

    UPDATE public.quincenas
    SET estado = 'enviada_aprobacion', enviada_por = auth.uid(), enviada_at = now()
    WHERE id = p_quincena_id AND estado = 'en_proceso'
    RETURNING * INTO v_result;

    IF v_result.id IS NULL THEN
        RAISE EXCEPTION 'No tiene permisos para enviar esta quincena, o no está en estado En Proceso.';
    END IF;

    SELECT full_name INTO v_nombre_ejecutor FROM public.user_profiles WHERE id = auth.uid();

    PERFORM public.fn_notificar_aprobadores_planilla(
        v_tenant_id, 'quincena_enviada_aprobacion',
        'Quincena enviada a aprobación',
        format('La quincena "%s" está lista para tu revisión. Enviada por %s.', v_result.etiqueta_estandar, COALESCE(v_nombre_ejecutor, 'un preparador')),
        p_quincena_id
    );

    RETURN v_result;
END;
$$;

COMMIT;
