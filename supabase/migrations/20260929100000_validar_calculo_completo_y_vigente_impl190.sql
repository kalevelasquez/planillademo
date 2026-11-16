-- Migration: guardia de cálculo completo/vigente al enviar Y al aprobar-cerrar (IMPL-190 CA2/CA3)
-- Author: @alexis
-- Description: Hallazgo real en UAT: la "1a Quincena de Agosto 2026" llegó a `aprobada_cerrada`
--              con 0 filas en `planilla_calculo_empleado` pese a tener novedades registradas (un
--              viático fijo de Rina Manzo) — investigado contra el código real: es imposible
--              llegar a ese estado por el flujo normal de las RPCs (con al menos un empleado
--              activo), porque `enviar_a_aprobacion` ya exige cálculo completo y nada borra filas
--              de `planilla_calculo_empleado` después. Lo más consistente con la evidencia es que
--              esa quincena puntual se creó por script directo en Supabase Studio (mismo patrón
--              documentado en IMPL-187/`seed_datos_2025_clonar_quincenas_impl169.sql`), no un bug
--              de la UI — pero el ticket señala, con razón, dos debilidades reales de diseño que
--              vale la pena cerrar igual, como defensa en profundidad:
--
--              CA2: `aprobar_y_cerrar_quincena` NUNCA revalidó que el cálculo esté completo —
--              confía ciegamente en que `enviar_a_aprobacion` ya lo garantizó. Si alguna vez esa
--              garantía se rompe (dato manipulado a mano, o un bug futuro en la RPC anterior),
--              nada lo detiene en la transición siguiente.
--
--              CA3: ninguna de las 2 RPCs rechazaba una quincena con novedades registradas
--              DESPUÉS del último cálculo, salvo el caso puntual de "reabierta después del
--              cálculo" (guard ya existente desde 20260907200000). Un preparador puede agregar un
--              viático o una hora extra sobre una quincena YA calculada, sin haber pasado por
--              Reabrir, y nada lo obliga a recalcular antes de enviar/cerrar.
--
--              DECISIÓN DE DISEÑO — por qué se extrae una función compartida en vez de duplicar
--              el chequeo en las 2 RPCs: la propia migración 20260907380000 (ver su cabecera)
--              documenta un bug real ya ocurrido en este proyecto por esta exacta razón — un
--              CREATE OR REPLACE de `enviar_a_aprobacion` pisó sin querer un guard que otra
--              migración le había agregado antes, porque el guard vivía duplicado inline en vez de
--              en un solo lugar. Se extrae `fn_validar_calculo_completo_y_vigente` para que
--              `enviar_a_aprobacion` Y `aprobar_y_cerrar_quincena` compartan la MISMA
--              implementación — un cambio futuro solo se escribe una vez.
--
--              Tablas cubiertas en el chequeo de novedades recientes (CA3): las 9 que
--              `calcular_planilla_empleado` lee directo por `quincena_id` (permisos, horas extras
--              manuales, viáticos fijos/variables, por ruta, por kilometraje, vacaciones,
--              bonificaciones, otros ingresos, incapacidades) + las 2 tablas de EVENTOS de
--              descuentos/anticipos (`planilla_descuento_eventos`/`planilla_anticipo_pagos`,
--              columna `registrado_at` — la tabla principal de descuento/anticipo NO tiene
--              `quincena_id` propio, vive across-quincenas). `planilla_marcaciones` (reloj
--              marcador crudo) queda AFUERA a propósito: el motor no la lee directo, lee
--              `planilla_horas_extras_manual` (ya agregada/confirmada) — incluir la cruda daría
--              falsos positivos mientras el Preparador todavía está ajustando marcaciones sin
--              haber confirmado el módulo.
--
--              CA1 (diagnóstico) queda documentado en el ticket de Jira, no en código — depende
--              de una consulta de solo lectura sobre el dato real de UAT que el usuario corre por
--              su cuenta. CA4 (corregir la quincena de agosto en UAT: reabrir, calcular, cerrar)
--              es una acción operativa sobre datos reales, no un cambio de código.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_validar_calculo_completo_y_vigente(p_quincena_id UUID, p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_total_activos INT;
    v_calculo_count INT;
    v_min_calculado_at TIMESTAMPTZ;
    v_reabierta_at TIMESTAMPTZ;
    v_calculo_obsoleto_count INT;
    v_novedades_recientes INT;
BEGIN
    SELECT COUNT(*) INTO v_total_activos
    FROM public.planilla_empleados
    WHERE tenant_id = p_tenant_id AND deleted_at IS NULL AND estado = 'activo';

    SELECT COUNT(*), MIN(calculado_at) INTO v_calculo_count, v_min_calculado_at
    FROM public.planilla_calculo_empleado
    WHERE quincena_id = p_quincena_id;

    IF v_total_activos = 0 OR v_calculo_count < v_total_activos THEN
        RAISE EXCEPTION 'El Cálculo de Planilla no está completo para todos los empleados activos.';
    END IF;

    -- Reapertura después del último cálculo (20260907200000) — cubre correcciones a novedades
    -- YA existentes (un UPDATE no cambia su created_at, por eso este chequeo es distinto del de
    -- abajo, no redundante).
    SELECT reabierta_at INTO v_reabierta_at FROM public.quincenas WHERE id = p_quincena_id;

    IF v_reabierta_at IS NOT NULL THEN
        SELECT COUNT(*) INTO v_calculo_obsoleto_count
        FROM public.planilla_calculo_empleado
        WHERE quincena_id = p_quincena_id AND calculado_at < v_reabierta_at;

        IF v_calculo_obsoleto_count > 0 THEN
            RAISE EXCEPTION 'Esta quincena fue reabierta después del último cálculo de % empleado(s) — volvé a "Calcular Planilla de esta Quincena" antes de continuar.', v_calculo_obsoleto_count;
        END IF;
    END IF;

    -- IMPL-190 CA3 — novedades NUEVAS registradas después del último cálculo, sin necesidad de
    -- reapertura de por medio (el gap real que detectó el ticket).
    SELECT COUNT(*) INTO v_novedades_recientes
    FROM (
        SELECT created_at AS ts FROM public.planilla_permisos WHERE quincena_id = p_quincena_id
        UNION ALL SELECT created_at AS ts FROM public.planilla_horas_extras_manual WHERE quincena_id = p_quincena_id
        UNION ALL SELECT created_at AS ts FROM public.planilla_viaticos_fijos_variables WHERE quincena_id = p_quincena_id
        UNION ALL SELECT created_at AS ts FROM public.planilla_viaticos_por_ruta WHERE quincena_id = p_quincena_id
        UNION ALL SELECT created_at AS ts FROM public.planilla_viaticos_kilometraje WHERE quincena_id = p_quincena_id
        UNION ALL SELECT created_at AS ts FROM public.planilla_vacaciones WHERE quincena_id = p_quincena_id
        UNION ALL SELECT created_at AS ts FROM public.planilla_bonificaciones WHERE quincena_id = p_quincena_id
        UNION ALL SELECT created_at AS ts FROM public.planilla_otros_ingresos WHERE quincena_id = p_quincena_id
        UNION ALL SELECT created_at AS ts FROM public.planilla_incapacidades WHERE quincena_id = p_quincena_id
        UNION ALL SELECT registrado_at AS ts FROM public.planilla_descuento_eventos WHERE quincena_id = p_quincena_id
        UNION ALL SELECT registrado_at AS ts FROM public.planilla_anticipo_pagos WHERE quincena_id = p_quincena_id
    ) novedades
    WHERE ts > v_min_calculado_at;

    IF v_novedades_recientes > 0 THEN
        RAISE EXCEPTION 'Se registraron % novedad(es) después del último cálculo de esta quincena — volvé a "Calcular Planilla de esta Quincena" antes de continuar.', v_novedades_recientes;
    END IF;
END;
$$;

-- Redefinición basada en la vigente (20260908230000) — único cambio real: los 4 DECLARE y el
-- bloque de validación de cálculo/reapertura se reemplazan por una sola llamada a la función
-- compartida de arriba.
CREATE OR REPLACE FUNCTION public.enviar_a_aprobacion(p_quincena_id UUID)
RETURNS public.quincenas
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.quincenas;
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_modulos_faltantes INT;
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

    PERFORM public.fn_validar_calculo_completo_y_vigente(p_quincena_id, v_tenant_id);

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

-- Redefinición basada en la vigente (20260907380000) — único cambio real: agrega la llamada a
-- fn_validar_calculo_completo_y_vigente ANTES del UPDATE a aprobada_cerrada (CA2 — antes esta RPC
-- no revalidaba el cálculo en absoluto).
CREATE OR REPLACE FUNCTION public.aprobar_y_cerrar_quincena(p_quincena_id UUID, p_comentario TEXT DEFAULT NULL)
RETURNS public.quincenas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_quincena public.quincenas;
    v_nombre_ejecutor TEXT;
BEGIN
    SELECT * INTO v_quincena FROM public.quincenas
    WHERE id = p_quincena_id AND tenant_id = public.get_auth_tenant_id()
    FOR UPDATE;

    IF v_quincena.id IS NULL THEN
        RAISE EXCEPTION 'Quincena no encontrada.';
    END IF;

    IF NOT ('admin' = ANY(public.get_auth_roles()) OR 'aprobador_planilla' = ANY(public.get_auth_roles())) THEN
        RAISE EXCEPTION 'No tiene permisos de Aprobador.';
    END IF;

    IF v_quincena.estado <> 'enviada_aprobacion' THEN
        RAISE EXCEPTION 'La quincena no está pendiente de aprobación.';
    END IF;

    IF v_quincena.enviada_por IS NOT NULL AND v_quincena.enviada_por = auth.uid() THEN
        RAISE EXCEPTION 'No puede aprobar una quincena que usted mismo envió a aprobación.';
    END IF;

    PERFORM public.fn_validar_calculo_completo_y_vigente(p_quincena_id, v_quincena.tenant_id);

    UPDATE public.quincenas
    SET estado = 'aprobada_cerrada', aprobada_por = auth.uid(), aprobada_at = now(), aprobada_comentario = p_comentario
    WHERE id = p_quincena_id
    RETURNING * INTO v_quincena;

    SELECT full_name INTO v_nombre_ejecutor FROM public.user_profiles WHERE id = auth.uid();

    PERFORM public.fn_notificar_preparador_y_admins_planilla(
        v_quincena.tenant_id, v_quincena.enviada_por, 'quincena_aprobada_cerrada',
        'Quincena aprobada y cerrada',
        format('La quincena "%s" fue aprobada y cerrada por %s.', v_quincena.etiqueta_estandar, COALESCE(v_nombre_ejecutor, 'un aprobador')),
        p_quincena_id
    );

    RETURN v_quincena;
END;
$$;

COMMIT;
