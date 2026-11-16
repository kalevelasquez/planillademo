-- Migration: descuento por ausencia injustificada de día completo (IMPL-82/US-HEX-08, fórmula
--            confirmada por Imporfrut 2026-10-20) + persistencia de la detección existente
-- Author: @alexis
-- Description: `detectarAusenciasInjustificadas` (marcacionesValidacionUtils.ts, IMPL-82) ya
--              detecta estas fechas desde hace rato, pero el propio código lo decía explícito:
--              "Deliberadamente NO calcula ningún monto a descontar... queda pendiente de
--              confirmar con Imporfrut". Esta migración responde esa pregunta — SOLO para el caso
--              de día completo, que es el único que la detección actual soporta (requiere CERO
--              tramos ese día; no distingue llegadas tarde/salidas tempranas, que son "cortos",
--              un concepto DISTINTO ya resuelto por IMPL-27 "Perdón de Saldo Negativo" — ESE nunca
--              resta del sueldo por diseño confirmado. La fórmula de horas injustificadas que
--              Imporfrut mencionó en la misma respuesta ("salario/30/8 × horas") queda SIN
--              implementar: coincide textualmente con un "corto", y antes de programar algo que
--              podría contradecir IMPL-27 hay que confirmar con Imporfrut cuál de las dos reglas
--              aplica. Incapacidad/vacación/permiso siguen sin descontarse — ya estaban excluidas
--              de la detección desde IMPL-82, Imporfrut solo confirmó que eso también es correcto.
--              "Día y séptimo" (mencionado en la misma respuesta) NO se automatiza — la propia
--              respuesta dice "depende la evaluación de cada caso", mismo criterio que
--              Renuncia/Mutuo Acuerdo en Liquidación Laboral (IMPL-14): no se inventa una regla
--              fija donde la fuente dice explícitamente que no la hay.
--
--              ALCANCE — solo Reloj Marcador, igual que la detección de origen (IMPL-82 nunca
--              corrió para Carga Manual, que no tiene tramos de entrada/salida de donde derivar
--              una ausencia). Extender esto a Carga Manual es un gap conocido, no resuelto acá.
--
--              PERSISTENCIA NUEVA — hasta hoy la detección vivía solo en memoria del navegador
--              durante la importación (useMemo en ImportacionMarcacionesSection.tsx), nunca
--              llegaba a la base. Tabla nueva `planilla_ausencias_injustificadas` (un día por
--              fila, igual que `planilla_permisos`) se puebla en el mismo RPC transaccional que ya
--              confirma el resto del lote (`confirmar_importacion_reloj_marcador`) — mismo
--              candado de RLS que `planilla_horas_extras_manual` (bloqueado una vez que
--              "horas_extras" de esa ubicación queda `completado`) y mismo criterio de
--              "reemplaza, no acumula" (DELETE por quincena+ubicación antes del INSERT) que ya
--              usa esa función para marcaciones.
--
--              FÓRMULA Y UBICACIÓN EN EL MOTOR — `sueldo_mensual/30 × días` (misma tarifa de
--              "día completo" que ya usa Permisos Sin Goce, IMPL-181, y vacaciones). Mismo
--              razonamiento que ESA migración: resta de `v_sueldo_proporcional` en un Paso nuevo
--              (2c, justo después de Permisos Sin Goce) — tiempo no trabajado y no devengado, no
--              una retención sobre plata ya ganada — para que la reducción fluya correctamente a
--              gravable/ISSS/AFP/Renta en vez de gravar un ingreso que el empleado nunca recibió.
--              Columna `ausencias_injustificadas_monto` nueva en `planilla_calculo_empleado`,
--              mismo criterio de auditabilidad que el resto de los conceptos del motor.
--
--              Se re-crea `calcular_planilla_empleado` completo (Postgres no permite parchear el
--              cuerpo de una función PL/pgSQL existente) — diffeado contra 20261019100000 antes
--              de finalizar: el único cambio real es el nuevo Paso 2c y la columna nueva en el
--              INSERT/ON CONFLICT.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_ausencias_injustificadas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    quincena_id UUID NOT NULL REFERENCES public.quincenas(id) ON DELETE CASCADE,
    ubicacion_id UUID NOT NULL REFERENCES public.planilla_ubicaciones(id),
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id),
    fecha DATE NOT NULL,
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (quincena_id, empleado_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_planilla_ausencias_injustificadas_quincena_empleado
    ON public.planilla_ausencias_injustificadas(quincena_id, empleado_id);

ALTER TABLE public.planilla_ausencias_injustificadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_ausencias_injustificadas_select_tenant"
    ON public.planilla_ausencias_injustificadas FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_ausencias_injustificadas_insert_modulo_no_confirmado"
    ON public.planilla_ausencias_injustificadas FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND NOT EXISTS (
            SELECT 1 FROM public.quincena_modulo_ubicacion_estado qmue
            WHERE qmue.quincena_id = planilla_ausencias_injustificadas.quincena_id
              AND qmue.ubicacion_id = planilla_ausencias_injustificadas.ubicacion_id
              AND qmue.modulo = 'horas_extras'
              AND qmue.estado = 'completado'
        )
    );

CREATE POLICY "planilla_ausencias_injustificadas_delete_modulo_no_confirmado"
    ON public.planilla_ausencias_injustificadas FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND NOT EXISTS (
            SELECT 1 FROM public.quincena_modulo_ubicacion_estado qmue
            WHERE qmue.quincena_id = planilla_ausencias_injustificadas.quincena_id
              AND qmue.ubicacion_id = planilla_ausencias_injustificadas.ubicacion_id
              AND qmue.modulo = 'horas_extras'
              AND qmue.estado = 'completado'
        )
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_ausencias_injustificadas ON public.planilla_ausencias_injustificadas;
CREATE TRIGGER tr_audit_planilla_ausencias_injustificadas
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_ausencias_injustificadas
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- ===== Confirmar importación — ahora también persiste las ausencias injustificadas detectadas =====
--
-- DROP explícito antes del CREATE OR REPLACE: la firma pasa de 5 a 6 parámetros (se agrega
-- `p_ausencias_injustificadas JSONB`) — Postgres identifica funciones por nombre + tipos de
-- argumentos, así que una cantidad DISTINTA de parámetros no reemplaza la función existente, crea
-- un OVERLOAD nuevo y deja la vieja de 5 parámetros coexistiendo (mismo bug ya sufrido en
-- producción, ver 20260922150000_fix_completar_ubicacion_modulo_overload_duplicado.sql). Sin este
-- DROP, un llamado futuro con 5 argumentos posicionales volvería a ser ambiguo.
DROP FUNCTION IF EXISTS public.confirmar_importacion_reloj_marcador(UUID, UUID, JSONB, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.confirmar_importacion_reloj_marcador(
    p_quincena_id UUID,
    p_ubicacion_id UUID,
    p_marcaciones JSONB,
    p_agregados JSONB,
    p_ausencias_injustificadas JSONB,
    p_user_id UUID
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID;
    v_ubicacion_cerrada TEXT;
BEGIN
    v_tenant_id := public.get_auth_tenant_id();

    -- IMPL-28 — guard explícito: ninguna ubicación de DESTINO real de este lote (empleado del
    -- perfil, puede ser distinta de p_ubicacion_id) puede tener su propio módulo horas_extras
    -- ya cerrado para esta quincena. Mensaje claro en vez de dejar que la RLS lo rechace a
    -- ciegas más abajo.
    SELECT pu.nombre INTO v_ubicacion_cerrada
    FROM (
        SELECT DISTINCT (m->>'ubicacion_id')::UUID AS ubicacion_id FROM jsonb_array_elements(p_marcaciones) m
        UNION
        SELECT DISTINCT (a->>'ubicacion_id')::UUID FROM jsonb_array_elements(p_agregados) a
    ) destino
    JOIN public.quincena_modulo_ubicacion_estado qmue
        ON qmue.tenant_id = v_tenant_id
        AND qmue.quincena_id = p_quincena_id
        AND qmue.ubicacion_id = destino.ubicacion_id
        AND qmue.modulo = 'horas_extras'
        AND qmue.estado = 'completado'
    JOIN public.planilla_ubicaciones pu ON pu.id = destino.ubicacion_id
    WHERE destino.ubicacion_id IS NOT NULL
    LIMIT 1;

    IF v_ubicacion_cerrada IS NOT NULL THEN
        RAISE EXCEPTION 'No se puede confirmar: hay un empleado que pertenece a "%", que ya tiene Horas Extras cerrado para esta quincena. Pedí que reabran esa ubicación antes de confirmar, o descartá esa fila.', v_ubicacion_cerrada;
    END IF;

    -- Reemplazar, no acumular: se borra todo lo que ESTA PANTALLA produjo alguna vez (origen),
    -- sin importar a qué ubicación haya quedado atribuido — no solo lo atribuido a p_ubicacion_id
    -- (IMPL-28: una fila cross-location vive bajo otra ubicación_id pero su origen sigue siendo
    -- esta pantalla).
    DELETE FROM public.planilla_marcaciones
    WHERE tenant_id = v_tenant_id AND quincena_id = p_quincena_id AND origen_ubicacion_id = p_ubicacion_id;

    INSERT INTO public.planilla_marcaciones (
        tenant_id, quincena_id, ubicacion_id, origen_ubicacion_id, empleado_id, entrada, salida, id_usuario_archivo, editado_manualmente, created_by
    )
    SELECT
        v_tenant_id,
        p_quincena_id,
        COALESCE((m->>'ubicacion_id')::UUID, p_ubicacion_id),
        p_ubicacion_id,
        (m->>'empleado_id')::UUID,
        (m->>'entrada')::TIMESTAMP,
        (m->>'salida')::TIMESTAMP,
        m->>'id_usuario_archivo',
        (m->>'editado_manualmente')::BOOLEAN,
        p_user_id
    FROM jsonb_array_elements(p_marcaciones) AS m;

    INSERT INTO public.planilla_horas_extras_manual (
        tenant_id, quincena_id, ubicacion_id, empleado_id, hed, hen, nocturnidad, feriado,
        monto_total, guardado_por, guardado_at, agregado_manualmente
    )
    SELECT
        v_tenant_id,
        p_quincena_id,
        COALESCE((a->>'ubicacion_id')::UUID, p_ubicacion_id),
        (a->>'empleado_id')::UUID,
        (a->>'hed')::NUMERIC,
        (a->>'hen')::NUMERIC,
        (a->>'nocturnidad')::NUMERIC,
        (a->>'feriado')::NUMERIC,
        (a->>'monto_total')::NUMERIC,
        p_user_id,
        now(),
        COALESCE((a->>'agregado_manualmente')::BOOLEAN, true)
    FROM jsonb_array_elements(p_agregados) AS a
    ON CONFLICT (quincena_id, ubicacion_id, empleado_id) DO UPDATE
        SET hed = EXCLUDED.hed,
            hen = EXCLUDED.hen,
            nocturnidad = EXCLUDED.nocturnidad,
            feriado = EXCLUDED.feriado,
            monto_total = EXCLUDED.monto_total,
            guardado_por = EXCLUDED.guardado_por,
            guardado_at = EXCLUDED.guardado_at,
            agregado_manualmente = EXCLUDED.agregado_manualmente,
            updated_at = now();

    -- Ausencias injustificadas (IMPL-82) — reemplaza, no acumula, igual que marcaciones: se
    -- borra lo que ESTA pantalla había detectado/persistido antes para esta quincena, y se
    -- inserta de nuevo lo que el frontend volvió a calcular sobre el lote actual.
    DELETE FROM public.planilla_ausencias_injustificadas
    WHERE tenant_id = v_tenant_id AND quincena_id = p_quincena_id AND ubicacion_id = p_ubicacion_id;

    INSERT INTO public.planilla_ausencias_injustificadas (
        tenant_id, quincena_id, ubicacion_id, empleado_id, fecha, created_by
    )
    SELECT
        v_tenant_id,
        p_quincena_id,
        p_ubicacion_id,
        (au->>'empleado_id')::UUID,
        (au->>'fecha')::DATE,
        p_user_id
    FROM jsonb_array_elements(COALESCE(p_ausencias_injustificadas, '[]'::JSONB)) AS au
    ON CONFLICT (quincena_id, empleado_id, fecha) DO NOTHING;

    PERFORM public.completar_ubicacion_modulo(p_quincena_id, p_ubicacion_id, 'horas_extras', p_user_id);
END;
$$;

-- ===== Motor de cálculo — nuevo Paso 2c =====

ALTER TABLE public.planilla_calculo_empleado
    ADD COLUMN IF NOT EXISTS ausencias_injustificadas_monto NUMERIC NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.calcular_planilla_empleado(
    p_quincena_id UUID,
    p_empleado_id UUID,
    p_user_id UUID
) RETURNS public.planilla_calculo_empleado
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID;
    v_empleado public.planilla_empleados;
    v_quincena public.quincenas;
    v_config public.planilla_config_fiscal;
    v_tramos_vigente_desde DATE;

    v_dias_laborados NUMERIC;
    v_sueldo_quincenal NUMERIC;
    v_sueldo_proporcional NUMERIC;
    v_permisos_sin_goce_monto NUMERIC := 0;
    v_ausencias_injustificadas_dias INTEGER := 0;
    v_ausencias_injustificadas_monto NUMERIC := 0;

    v_horas_extras NUMERIC;

    v_viaticos_monto NUMERIC := 0;
    v_viaticos_bono10 NUMERIC := 0;

    v_vacaciones_gravable NUMERIC := 0;
    v_vacaciones_bono10 NUMERIC := 0;
    v_vacacion_adelanto_recargo NUMERIC := 0;

    v_bonificaciones_gravable NUMERIC := 0;
    v_bonificaciones_no_gravable NUMERIC := 0;
    v_bonificaciones_bono10 NUMERIC := 0;

    v_otros_ing_gravable NUMERIC := 0;
    v_otros_ing_no_gravable NUMERIC := 0;
    v_otros_ing_bono10 NUMERIC := 0;

    v_incapacidad_bono10 NUMERIC := 0;

    v_total_gravable NUMERIC;
    v_total_no_gravable NUMERIC;

    v_isss NUMERIC;
    v_afp NUMERIC;
    v_ipsfa NUMERIC := 0;
    v_deduccion_fija RECORD;
    v_base_renta NUMERIC;
    v_renta_isr NUMERIC;

    v_base_bono10_total NUMERIC;
    v_renta_bono10 NUMERIC;

    v_item RECORD;
    v_descuentos_obligatorios_total NUMERIC;
    v_tope_20 NUMERIC;
    v_no_obligatorios_solicitado NUMERIC := 0;
    v_no_obligatorios_aplicado NUMERIC := 0;
    v_excedente_diferido NUMERIC := 0;
    v_alerta_tope BOOLEAN := false;
    v_detalle JSONB := '[]'::JSONB;
    v_acumulado NUMERIC := 0;

    v_neto NUMERIC;
    v_alerta_minimo BOOLEAN := false;

    v_result public.planilla_calculo_empleado;
    v_empleado_ref TEXT;
BEGIN
    SELECT * INTO v_empleado FROM public.planilla_empleados WHERE id = p_empleado_id;
    SELECT * INTO v_quincena FROM public.quincenas WHERE id = p_quincena_id;
    v_tenant_id := v_quincena.tenant_id;
    v_empleado_ref := COALESCE(v_empleado.nombre_completo, p_empleado_id::TEXT);

    IF v_quincena.estado != 'en_proceso' THEN
        RAISE EXCEPTION 'No se puede calcular planilla: la quincena % no está en_proceso', p_quincena_id;
    END IF;

    IF v_quincena.tipo != 'normal' THEN
        RAISE EXCEPTION 'calcular_planilla_empleado solo aplica a quincenas tipo normal (quincena % es tipo %). Aguinaldo usa calcular_aguinaldo_empleado.', p_quincena_id, v_quincena.tipo;
    END IF;

    SELECT * INTO v_config
    FROM public.planilla_config_fiscal
    WHERE tenant_id = v_tenant_id
      AND vigente_desde <= v_quincena.fecha_fin
      AND (vigente_hasta IS NULL OR vigente_hasta >= v_quincena.fecha_fin)
    ORDER BY vigente_desde DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No hay configuración fiscal vigente para la fecha %', v_quincena.fecha_fin;
    END IF;

    SELECT vigente_desde INTO v_tramos_vigente_desde
    FROM public.planilla_renta_tramos
    WHERE tenant_id = v_tenant_id AND vigente_desde <= v_quincena.fecha_fin
    ORDER BY vigente_desde DESC
    LIMIT 1;

    -- ===== Pasos 1-2: Sueldo base y proporcional (US-CALC-00/IMPL-86) =====
    BEGIN
        v_sueldo_quincenal := ROUND(COALESCE(v_empleado.sueldo_mensual, 0) / 2, 2);
        v_dias_laborados := GREATEST(0, LEAST(
            v_quincena.dias_habiles,
            (LEAST(v_quincena.fecha_fin, COALESCE(v_empleado.fecha_baja, v_quincena.fecha_fin))
                - GREATEST(v_quincena.fecha_inicio, v_empleado.fecha_ingreso) + 1)
        ));
        v_sueldo_proporcional := ROUND(v_sueldo_quincenal * (v_dias_laborados / NULLIF(v_quincena.dias_habiles, 0)), 2);
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 1-2 (Sueldo base y proporcional) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 2b: Permisos Sin Goce de Salario (IMPL-181/US-PER-01 CA4) — ver cabecera de
    -- esa migración para la justificación de por qué resta acá y no como descuento (Paso 14). =====
    BEGIN
        SELECT COALESCE(SUM(
            CASE p.granularidad
                WHEN 'dia_completo' THEN COALESCE(v_empleado.sueldo_mensual, 0) / 30
                WHEN 'medio_dia' THEN COALESCE(v_empleado.sueldo_mensual, 0) / 60
                WHEN 'horas' THEN p.horas * COALESCE(v_empleado.sueldo_mensual, 0) / 240
            END
        ), 0) INTO v_permisos_sin_goce_monto
        FROM public.planilla_permisos p
        WHERE p.quincena_id = p_quincena_id AND p.empleado_id = p_empleado_id AND p.tipo = 'sin_goce';

        v_permisos_sin_goce_monto := ROUND(v_permisos_sin_goce_monto, 2);
        v_sueldo_proporcional := GREATEST(0, ROUND(v_sueldo_proporcional - v_permisos_sin_goce_monto, 2));
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 2b (Permisos Sin Goce) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 2c: Ausencias Injustificadas de día completo (IMPL-82/US-HEX-08, fórmula
    -- confirmada por Imporfrut 2026-10-20: "sueldo_mensual/30 × días ausente") — mismo
    -- razonamiento que Permisos Sin Goce: resta del sueldo proporcional ANTES de gravable, nunca
    -- como descuento del Paso 14, para no gravar ISSS/AFP/Renta sobre plata nunca devengada. =====
    BEGIN
        SELECT COUNT(*) INTO v_ausencias_injustificadas_dias
        FROM public.planilla_ausencias_injustificadas
        WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;

        v_ausencias_injustificadas_monto := ROUND(COALESCE(v_empleado.sueldo_mensual, 0) / 30 * v_ausencias_injustificadas_dias, 2);
        v_sueldo_proporcional := GREATEST(0, ROUND(v_sueldo_proporcional - v_ausencias_injustificadas_monto, 2));
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 2c (Ausencias Injustificadas) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 3: Horas Extras (ya calculadas en la épica Horas Extras, IMPL-20) =====
    BEGIN
        SELECT COALESCE(SUM(monto_total), 0) INTO v_horas_extras
        FROM public.planilla_horas_extras_manual
        WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 3 (Horas Extras) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 4: Viáticos (no gravable, ADEMÁS Bono 10% sobre viático GG fijo — IMPL-174) =====
    BEGIN
        SELECT
            COALESCE(SUM(monto), 0),
            COALESCE(SUM(CASE WHEN tipo = 'fijo' AND v_empleado.retencion_especial_viatico THEN monto ELSE 0 END), 0)
        INTO v_viaticos_monto, v_viaticos_bono10
        FROM public.planilla_viaticos_fijos_variables
        WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;

        v_viaticos_monto := v_viaticos_monto + (
            SELECT COALESCE(SUM(monto), 0) FROM public.planilla_viaticos_por_ruta
            WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id
        ) + (
            SELECT COALESCE(SUM(monto), 0) FROM public.planilla_viaticos_kilometraje
            WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 4 (Viáticos) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 5: Vacaciones — no_gozada se trata como Bono 10%, no como salario ordinario =====
    BEGIN
        SELECT
            COALESCE(SUM(monto_total) FILTER (WHERE NOT no_gozada), 0),
            COALESCE(SUM(monto_total) FILTER (WHERE no_gozada), 0)
        INTO v_vacaciones_gravable, v_vacaciones_bono10
        FROM public.planilla_vacaciones
        WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 5 (Vacaciones) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 5b: Adelanto de recargo de vacaciones por aniversario (Feature 2, confirmado por
    -- Imporfrut 2026-10-19) — mismo tratamiento "Bono 10%" que vacación no gozada, filtrado por
    -- la quincena donde el admin/preparador ACEPTÓ el pago. =====
    BEGIN
        SELECT COALESCE(SUM(recargo_monto), 0) INTO v_vacacion_adelanto_recargo
        FROM public.planilla_vacaciones_adelanto_recargo
        WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;

        v_vacaciones_bono10 := v_vacaciones_bono10 + v_vacacion_adelanto_recargo;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 5b (Adelanto recargo vacaciones) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 6: Bonificaciones — automáticas siempre gravables (US-BON-02 CA2); manuales
    -- pueden ser gravable/no_gravable/bono_10 (US-BON-03 CA2) =====
    BEGIN
        SELECT
            COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'gravable'), 0),
            COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'no_gravable'), 0),
            COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'bono_10'), 0)
        INTO v_bonificaciones_gravable, v_bonificaciones_no_gravable, v_bonificaciones_bono10
        FROM public.planilla_bonificaciones
        WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 6 (Bonificaciones) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 7 + Paso 15: Otros Ingresos, por gravabilidad (US-OTR-01 CA2, 3 estados) =====
    BEGIN
        SELECT
            COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'gravable'), 0),
            COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'no_gravable'), 0),
            COALESCE(SUM(monto) FILTER (WHERE gravabilidad = 'bono_10'), 0)
        INTO v_otros_ing_gravable, v_otros_ing_no_gravable, v_otros_ing_bono10
        FROM public.planilla_otros_ingresos
        WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;

        SELECT COALESCE(SUM(monto_bono_trabajado), 0) INTO v_incapacidad_bono10
        FROM public.planilla_incapacidades
        WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id AND trabajo_durante_incapacidad = true;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 7/15 (Otros Ingresos) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 8: Total Ingresos Gravables/No Gravables =====
    BEGIN
        v_total_gravable := ROUND(
            v_sueldo_proporcional + v_horas_extras + v_vacaciones_gravable + v_bonificaciones_gravable + v_otros_ing_gravable,
            2
        );
        v_total_no_gravable := ROUND(
            v_viaticos_monto + v_bonificaciones_no_gravable + v_otros_ing_no_gravable
            + v_vacaciones_bono10 + v_bonificaciones_bono10 + v_otros_ing_bono10 + v_incapacidad_bono10,
            2
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 8 (Total Ingresos Gravables) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Pasos 9-10: ISSS, AFP e IPSFA (US-CALC-01/IMPL-87) =====
    BEGIN
        v_isss := ROUND(LEAST(v_total_gravable, v_config.isss_tope_base) * v_config.isss_tasa_empleado, 2);
        v_afp := CASE
            WHEN v_empleado.tipo_afiliacion IN ('jubilado', 'ipsfa') THEN 0
            ELSE ROUND(
                (CASE WHEN v_config.afp_tope_base IS NULL THEN v_total_gravable ELSE LEAST(v_total_gravable, v_config.afp_tope_base) END)
                * v_config.afp_tasa_empleado,
                2
            )
        END;
        v_ipsfa := CASE
            WHEN v_empleado.tipo_afiliacion = 'ipsfa' THEN ROUND(LEAST(v_total_gravable, v_config.ipsfa_tope_base) * v_config.ipsfa_tasa_empleado, 2)
            ELSE 0
        END;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 9-10 (ISSS, AFP e IPSFA) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 11: Base Renta =====
    BEGIN
        SELECT * INTO v_deduccion_fija
        FROM public.fn_aplica_deduccion_fija(v_total_gravable, v_config.deduccion_fija_anual, v_config.deduccion_fija_tope_ingreso_anual);
        v_base_renta := GREATEST(0, ROUND(v_total_gravable - v_isss - v_afp - v_ipsfa - v_deduccion_fija.o_monto, 2));
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 11 (Base Renta) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 12: Renta ISR sobre salario =====
    BEGIN
        v_renta_isr := public.fn_calcular_renta_isr(v_tenant_id, v_base_renta, v_tramos_vigente_desde);
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 12 (Renta ISR sobre salario) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 13: Renta ISR sobre Bono 10% (US-CALC-05/IMPL-91) — línea SEPARADA =====
    BEGIN
        v_base_bono10_total := ROUND(
            v_viaticos_bono10 + v_vacaciones_bono10 + v_bonificaciones_bono10 + v_otros_ing_bono10 + v_incapacidad_bono10,
            2
        );
        v_renta_bono10 := ROUND(v_base_bono10_total * v_config.bono10_tasa, 2);
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 13 (Renta ISR sobre Bono 10%%) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 14: Descuentos — orden de prioridad + tope 20% (US-CALC-09/IMPL-95) =====
    BEGIN
        v_descuentos_obligatorios_total := ROUND(v_isss + v_afp + v_ipsfa + v_renta_isr + v_renta_bono10, 2);
        v_tope_20 := ROUND(v_sueldo_proporcional * v_config.tope_descuentos_no_obligatorios_pct, 2);

        FOR v_item IN
            SELECT e.monto, c.tipo, CASE
                WHEN c.nombre ILIKE '%préstamo%' OR c.nombre ILIKE '%financiera%' OR c.nombre ILIKE '%vehículo%' THEN 4
                WHEN c.nombre ILIKE '%vivienda%' THEN 5
                WHEN c.nombre ILIKE '%uniforme%' OR c.nombre ILIKE '%lentes%' THEN 6
                ELSE 8
            END AS prioridad, c.nombre AS categoria
            FROM public.planilla_descuento_eventos e
            JOIN public.planilla_descuentos d ON d.id = e.descuento_id
            JOIN public.planilla_descuento_categorias c ON c.id = d.categoria_id
            WHERE e.quincena_id = p_quincena_id AND e.tipo = 'pago' AND d.empleado_id = p_empleado_id

            UNION ALL

            SELECT p.monto, 'variable' AS tipo, 7 AS prioridad, 'Anticipo de salario' AS categoria
            FROM public.planilla_anticipo_pagos p
            JOIN public.planilla_anticipos a ON a.id = p.anticipo_id
            WHERE p.quincena_id = p_quincena_id AND p.tipo = 'pago' AND a.empleado_id = p_empleado_id

            ORDER BY prioridad
        LOOP
            v_no_obligatorios_solicitado := ROUND(v_no_obligatorios_solicitado + v_item.monto, 2);
            IF v_item.tipo = 'fijo' THEN
                v_no_obligatorios_aplicado := ROUND(v_no_obligatorios_aplicado + v_item.monto, 2);
                v_detalle := v_detalle || jsonb_build_object('categoria', v_item.categoria, 'monto', v_item.monto, 'aplicado', v_item.monto, 'diferido', 0);
            ELSIF ROUND(v_acumulado + v_item.monto, 2) <= v_tope_20 THEN
                v_acumulado := ROUND(v_acumulado + v_item.monto, 2);
                v_no_obligatorios_aplicado := ROUND(v_no_obligatorios_aplicado + v_item.monto, 2);
                v_detalle := v_detalle || jsonb_build_object('categoria', v_item.categoria, 'monto', v_item.monto, 'aplicado', v_item.monto, 'diferido', 0);
            ELSE
                v_excedente_diferido := ROUND(v_excedente_diferido + v_item.monto, 2);
                v_alerta_tope := true;
                v_detalle := v_detalle || jsonb_build_object('categoria', v_item.categoria, 'monto', v_item.monto, 'aplicado', 0, 'diferido', v_item.monto);
            END IF;
        END LOOP;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 14 (Descuentos) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 16: NETO A PAGAR =====
    BEGIN
        v_neto := ROUND(
            v_total_gravable + v_total_no_gravable - v_isss - v_afp - v_ipsfa - v_renta_isr - v_renta_bono10 - v_no_obligatorios_aplicado,
            2
        );

        IF v_config.salario_minimo_inembargable IS NOT NULL AND v_neto < v_config.salario_minimo_inembargable THEN
            v_alerta_minimo := true;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 16 (Neto a Pagar) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    BEGIN
        INSERT INTO public.planilla_calculo_empleado (
            tenant_id, quincena_id, empleado_id,
            dias_habiles_quincena, dias_laborados, sueldo_quincenal_base, sueldo_proporcional,
            permisos_sin_goce_monto,
            ausencias_injustificadas_monto,
            horas_extras_monto,
            viaticos_monto, viaticos_bono10_base,
            vacaciones_monto, vacaciones_bono10_base,
            bonificaciones_monto,
            otros_ingresos_gravables, otros_ingresos_no_gravables, otros_ingresos_bono10_base,
            incapacidad_bono10_base,
            total_ingresos_gravables,
            isss_empleado, afp_empleado, ipsfa_empleado,
            deduccion_fija_aplicada, deduccion_fija_motivo, base_renta,
            renta_isr,
            base_bono10_total, renta_bono10,
            descuentos_obligatorios_total, descuentos_no_obligatorios_solicitado, descuentos_no_obligatorios_aplicado,
            descuentos_tope_20_base, descuentos_excedente_diferido, descuentos_alerta_tope_superado,
            alerta_neto_bajo_minimo, descuentos_detalle,
            total_no_gravable, neto_a_pagar,
            isss_patronal, afp_patronal, ipsfa_patronal, insaforp_patronal,
            config_fiscal_id, tramos_renta_vigente_desde, tipo_quincena,
            calculado_por
        ) VALUES (
            v_tenant_id, p_quincena_id, p_empleado_id,
            v_quincena.dias_habiles, v_dias_laborados, v_sueldo_quincenal, v_sueldo_proporcional,
            v_permisos_sin_goce_monto,
            v_ausencias_injustificadas_monto,
            v_horas_extras,
            v_viaticos_monto, v_viaticos_bono10,
            v_vacaciones_gravable, v_vacaciones_bono10,
            v_bonificaciones_gravable,
            v_otros_ing_gravable, ROUND(v_otros_ing_no_gravable + v_bonificaciones_no_gravable, 2), ROUND(v_otros_ing_bono10 + v_bonificaciones_bono10, 2),
            v_incapacidad_bono10,
            v_total_gravable,
            v_isss, v_afp, v_ipsfa,
            v_deduccion_fija.o_monto, v_deduccion_fija.o_motivo, v_base_renta,
            v_renta_isr,
            v_base_bono10_total, v_renta_bono10,
            v_descuentos_obligatorios_total, v_no_obligatorios_solicitado, v_no_obligatorios_aplicado,
            v_tope_20, v_excedente_diferido, v_alerta_tope,
            v_alerta_minimo, v_detalle,
            v_total_no_gravable, v_neto,
            ROUND(LEAST(v_total_gravable, v_config.isss_tope_base) * v_config.isss_tasa_patronal, 2),
            ROUND((CASE
                WHEN v_empleado.tipo_afiliacion = 'ipsfa' THEN 0
                WHEN v_config.afp_tope_base IS NULL THEN v_total_gravable
                ELSE LEAST(v_total_gravable, v_config.afp_tope_base)
            END) * v_config.afp_tasa_patronal, 2),
            ROUND(CASE WHEN v_empleado.tipo_afiliacion = 'ipsfa' THEN LEAST(v_total_gravable, v_config.ipsfa_tope_base) * v_config.ipsfa_tasa_patronal ELSE 0 END, 2),
            ROUND(v_sueldo_quincenal * v_config.insaforp_tasa_patronal, 2),
            v_config.id, v_tramos_vigente_desde, v_quincena.tipo,
            p_user_id
        )
        ON CONFLICT (quincena_id, empleado_id) DO UPDATE SET
            dias_habiles_quincena = EXCLUDED.dias_habiles_quincena,
            dias_laborados = EXCLUDED.dias_laborados,
            sueldo_quincenal_base = EXCLUDED.sueldo_quincenal_base,
            sueldo_proporcional = EXCLUDED.sueldo_proporcional,
            permisos_sin_goce_monto = EXCLUDED.permisos_sin_goce_monto,
            ausencias_injustificadas_monto = EXCLUDED.ausencias_injustificadas_monto,
            horas_extras_monto = EXCLUDED.horas_extras_monto,
            viaticos_monto = EXCLUDED.viaticos_monto,
            viaticos_bono10_base = EXCLUDED.viaticos_bono10_base,
            vacaciones_monto = EXCLUDED.vacaciones_monto,
            vacaciones_bono10_base = EXCLUDED.vacaciones_bono10_base,
            bonificaciones_monto = EXCLUDED.bonificaciones_monto,
            otros_ingresos_gravables = EXCLUDED.otros_ingresos_gravables,
            otros_ingresos_no_gravables = EXCLUDED.otros_ingresos_no_gravables,
            otros_ingresos_bono10_base = EXCLUDED.otros_ingresos_bono10_base,
            incapacidad_bono10_base = EXCLUDED.incapacidad_bono10_base,
            total_ingresos_gravables = EXCLUDED.total_ingresos_gravables,
            isss_empleado = EXCLUDED.isss_empleado,
            afp_empleado = EXCLUDED.afp_empleado,
            ipsfa_empleado = EXCLUDED.ipsfa_empleado,
            deduccion_fija_aplicada = EXCLUDED.deduccion_fija_aplicada,
            deduccion_fija_motivo = EXCLUDED.deduccion_fija_motivo,
            base_renta = EXCLUDED.base_renta,
            renta_isr = EXCLUDED.renta_isr + public.planilla_calculo_empleado.renta_semestral_diferencia,
            base_bono10_total = EXCLUDED.base_bono10_total,
            renta_bono10 = EXCLUDED.renta_bono10,
            descuentos_obligatorios_total = EXCLUDED.descuentos_obligatorios_total,
            descuentos_no_obligatorios_solicitado = EXCLUDED.descuentos_no_obligatorios_solicitado,
            descuentos_no_obligatorios_aplicado = EXCLUDED.descuentos_no_obligatorios_aplicado,
            descuentos_tope_20_base = EXCLUDED.descuentos_tope_20_base,
            descuentos_excedente_diferido = EXCLUDED.descuentos_excedente_diferido,
            descuentos_alerta_tope_superado = EXCLUDED.descuentos_alerta_tope_superado,
            alerta_neto_bajo_minimo = EXCLUDED.alerta_neto_bajo_minimo,
            descuentos_detalle = EXCLUDED.descuentos_detalle,
            total_no_gravable = EXCLUDED.total_no_gravable,
            neto_a_pagar = EXCLUDED.neto_a_pagar - public.planilla_calculo_empleado.renta_semestral_diferencia,
            isss_patronal = EXCLUDED.isss_patronal,
            afp_patronal = EXCLUDED.afp_patronal,
            ipsfa_patronal = EXCLUDED.ipsfa_patronal,
            insaforp_patronal = EXCLUDED.insaforp_patronal,
            config_fiscal_id = EXCLUDED.config_fiscal_id,
            tramos_renta_vigente_desde = EXCLUDED.tramos_renta_vigente_desde,
            tipo_quincena = EXCLUDED.tipo_quincena,
            calculado_por = p_user_id,
            calculado_at = now(),
            updated_at = now()
        RETURNING * INTO v_result;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Guardado del resultado (INSERT/UPDATE planilla_calculo_empleado) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    RETURN v_result;
END;
$$;

COMMIT;
