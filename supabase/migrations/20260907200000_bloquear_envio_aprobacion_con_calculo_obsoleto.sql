-- Migration: Bloquear "Enviar a Aprobación" con cálculo obsoleto tras reabrir (2026-08-13)
-- Author: @alexis
-- Description: Auditoría crítica módulo por módulo (hallazgo crítico #5): `reabrir_quincena`
--              vuelve la quincena a 'en_proceso' pero nunca invalida las filas ya existentes
--              en `planilla_calculo_empleado` — si el Preparador corrige datos tras la
--              reapertura y olvida volver a apretar "Calcular Planilla", `enviar_a_aprobacion`
--              solo contaba filas (nunca comparaba fechas), así que la quincena se podía
--              reenviar y aprobar cargando los montos de ANTES de la corrección, sin ninguna
--              advertencia. Se agrega un chequeo: si existe algún registro de cálculo con
--              `calculado_at` anterior a `reabierta_at`, se bloquea el envío con un mensaje
--              claro pidiendo recalcular. No se borra ni se marca nada — el cálculo sigue
--              disponible para consulta, solo se bloquea la transición mientras esté desfasado.

BEGIN;

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
BEGIN
    SELECT COUNT(*) INTO v_modulos_faltantes
    FROM unnest(ARRAY['horas_extras', 'viaticos', 'vacaciones', 'bonificaciones', 'anticipos', 'incapacidades', 'descuentos']) AS m
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

    -- Bugfix (auditoría, hallazgo crítico #5): si la quincena se reabrió después del último
    -- cálculo de algún empleado, esos montos pueden no reflejar correcciones hechas post-reapertura.
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

    PERFORM public.fn_notificar_aprobadores_planilla(
        v_tenant_id, 'quincena_enviada_aprobacion',
        'Quincena enviada a aprobación',
        format('La quincena "%s" está lista para tu revisión.', v_result.etiqueta_estandar),
        p_quincena_id
    );

    RETURN v_result;
END;
$$;

COMMIT;
