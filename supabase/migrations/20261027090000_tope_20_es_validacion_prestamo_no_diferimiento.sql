-- Migration: el tope del 20% es una VALIDACIÓN al configurar un préstamo (por préstamo
--            individual), no un mecanismo de diferir descuentos en el motor de cálculo
-- Author: @alexis
-- Description: Imporfrut confirmó (2026-10-27), con un ejemplo numérico puntual: "el tope del
--              20% en descuentos es un límite legal para préstamos: las cuotas por préstamos con
--              bancos o instituciones financieras mediante orden irrevocable de descuento no
--              pueden rebasar el 20% del salario. Los descuentos como lentes, anticipos, etc., no
--              son considerados dentro de esta regla; se descuentan tal y como se acuerdan con el
--              empleado."
--
--              Esto invierte por completo el diseño de IMPL-90/95 (techo sobre "variable",
--              20261020110000 de ayer, piso sobre el neto) — NINGUNO de los dos era correcto.
--              Verificado contra el caso real de Manzo (`docs/formatos-reportes/Planilla 1ra
--              quincena abril 2026.xlsx`, hoja Descuentos): tiene 2 préstamos — Banco Promerica
--              $106.515 (14.2% de su sueldo $750) y Fondo Social para la Vivienda $115.05 (15.34%)
--              — cada uno INDIVIDUALMENTE por debajo del 20%, aunque sumados dan 29.5%. Imporfrut
--              nunca difirió nada porque nunca hubo nada que diferir: el tope es POR PRÉSTAMO, no
--              agregado contra todos los descuentos del empleado.
--
--              CONCLUSIÓN — el tope del 20% es una VALIDACIÓN al momento de configurar la cuota de
--              un préstamo (crear_descuento/actualizar_descuento), no un chequeo en tiempo de
--              cálculo de planilla. Una vez que una cuota quedó bien configurada (≤20% del sueldo
--              en ese momento), se paga completa todas las quincenas, sin ningún mecanismo de
--              diferimiento — igual que CUALQUIER otro descuento (lentes, anticipos, etc., que
--              nunca tuvieron tope). Por lo tanto:
--
--              1. `calcular_planilla_empleado` (Paso 14) ya NO difiere nada — todos los eventos de
--                 pago activos de la quincena (préstamos + descuentos discrecionales + anticipos)
--                 se suman y se aplican completos, sin excepción. Se elimina el concepto de
--                 "presupuesto"/"piso"/"tope" de este paso por completo.
--              2. `crear_descuento`/`actualizar_descuento` ganan una validación nueva: si la
--                 categoría es un préstamo con banco/institución financiera (mismo patrón de
--                 nombre ya usado en el motor para identificar estas categorías — préstamo,
--                 financiera, vehículo, vivienda), la cuota quincenal no puede superar el 20% del
--                 sueldo quincenal del empleado. Se rechaza con un mensaje claro en vez de guardar
--                 una cuota ilegal.
--
--              Las columnas `descuentos_tope_20_base`/`descuentos_excedente_diferido`/
--              `descuentos_alerta_tope_superado` de `planilla_calculo_empleado` NO se eliminan
--              (evitar una migración de esquema más grande de la necesaria) — simplemente quedan
--              siempre en 0/0/false, ya que nunca hay nada que diferir. El banner de alerta
--              asociado en la UI nunca se dispara, sin necesidad de tocarlo.
--
--              Se re-crea `calcular_planilla_empleado` completo (Postgres no permite parchear el
--              cuerpo de una función PL/pgSQL existente) — diffeado contra 20261020110000 antes de
--              finalizar: el único cambio real es el Paso 14, simplificado a una suma sin
--              condiciones.

BEGIN;

-- ===== Parte 1: validación del 20% al configurar un préstamo =====

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
    v_sueldo_mensual NUMERIC;
    v_tope_legal_prestamo NUMERIC;
BEGIN
    SELECT nombre INTO v_categoria_nombre
    FROM public.planilla_descuento_categorias
    WHERE id = p_categoria_id;

    v_numero_cuotas := p_numero_cuotas;
    v_monto_quincenal := p_monto_quincenal;

    IF p_monto_total IS NOT NULL AND p_cuota_exacta IS NOT NULL THEN
        v_numero_cuotas := CEIL(p_monto_total / p_cuota_exacta)::INT;
        v_monto_quincenal := p_cuota_exacta;
    ELSIF p_monto_total IS NOT NULL AND p_numero_cuotas IS NOT NULL THEN
        v_monto_quincenal := ROUND(p_monto_total / p_numero_cuotas, 2);
    END IF;

    IF v_categoria_nombre = 'Préstamo bancario' AND (p_monto_total IS NULL OR v_numero_cuotas IS NULL) THEN
        RAISE EXCEPTION 'La categoría "Préstamo bancario" siempre debe tener monto total y número de cuotas — nunca puede quedar indefinida.';
    END IF;

    -- NUEVO (2026-10-27) — tope legal del 20%, confirmado por Imporfrut: aplica SOLO a préstamos
    -- con bancos/instituciones financieras (orden irrevocable de descuento), por préstamo
    -- individual, no agregado contra el resto de descuentos del empleado. Mismo patrón de nombre
    -- que ya identificaba estas categorías en el motor de cálculo (ahora removido de ahí).
    IF v_categoria_nombre ILIKE '%préstamo%' OR v_categoria_nombre ILIKE '%financiera%'
        OR v_categoria_nombre ILIKE '%vehículo%' OR v_categoria_nombre ILIKE '%vivienda%' THEN
        SELECT sueldo_mensual INTO v_sueldo_mensual FROM public.planilla_empleados WHERE id = p_empleado_id;
        v_tope_legal_prestamo := ROUND(COALESCE(v_sueldo_mensual, 0) / 2 * 0.20, 2);
        IF v_monto_quincenal > v_tope_legal_prestamo THEN
            RAISE EXCEPTION 'La cuota quincenal ($%) supera el 20%% legal del sueldo del empleado para préstamos con bancos/instituciones financieras (máximo permitido: $%).', v_monto_quincenal, v_tope_legal_prestamo;
        END IF;
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
    v_categoria_nombre TEXT;
    v_sueldo_mensual NUMERIC;
    v_tope_legal_prestamo NUMERIC;
BEGIN
    SELECT * INTO v_descuento FROM public.planilla_descuentos WHERE id = p_descuento_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Descuento no encontrado.';
    END IF;

    v_numero_cuotas := p_numero_cuotas;

    IF p_monto_total IS NOT NULL AND p_cuota_exacta IS NOT NULL THEN
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

    -- NUEVO (2026-10-27) — mismo tope legal del 20% que crear_descuento, ver cabecera de esta
    -- migración. Se valida contra la categoría NUEVA (p_categoria_id) por si el usuario reclasificó
    -- el descuento al editarlo.
    SELECT nombre INTO v_categoria_nombre FROM public.planilla_descuento_categorias WHERE id = p_categoria_id;
    IF v_categoria_nombre ILIKE '%préstamo%' OR v_categoria_nombre ILIKE '%financiera%'
        OR v_categoria_nombre ILIKE '%vehículo%' OR v_categoria_nombre ILIKE '%vivienda%' THEN
        SELECT sueldo_mensual INTO v_sueldo_mensual FROM public.planilla_empleados WHERE id = v_descuento.empleado_id;
        v_tope_legal_prestamo := ROUND(COALESCE(v_sueldo_mensual, 0) / 2 * 0.20, 2);
        IF v_monto_quincenal > v_tope_legal_prestamo THEN
            RAISE EXCEPTION 'La cuota quincenal ($%) supera el 20%% legal del sueldo del empleado para préstamos con bancos/instituciones financieras (máximo permitido: $%).', v_monto_quincenal, v_tope_legal_prestamo;
        END IF;
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

-- ===== Parte 2: el motor de cálculo ya no difiere nada en Paso 14 =====

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
    v_no_obligatorios_solicitado NUMERIC := 0;
    v_no_obligatorios_aplicado NUMERIC := 0;
    v_detalle JSONB := '[]'::JSONB;

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

    -- ===== Paso 2b: Permisos Sin Goce de Salario (IMPL-181/US-PER-01 CA4) =====
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

    -- ===== Paso 2c: Ausencias Injustificadas de día completo (IMPL-82/US-HEX-08) =====
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

    -- ===== Paso 5b: Adelanto de recargo de vacaciones por aniversario (Feature 2) =====
    BEGIN
        SELECT COALESCE(SUM(recargo_monto), 0) INTO v_vacacion_adelanto_recargo
        FROM public.planilla_vacaciones_adelanto_recargo
        WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id;

        v_vacaciones_bono10 := v_vacaciones_bono10 + v_vacacion_adelanto_recargo;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 5b (Adelanto recargo vacaciones) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 6: Bonificaciones =====
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

    -- ===== Paso 7 + Paso 15: Otros Ingresos =====
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

    -- ===== Paso 13: Renta ISR sobre Bono 10% (US-CALC-05/IMPL-91) =====
    BEGIN
        v_base_bono10_total := ROUND(
            v_viaticos_bono10 + v_vacaciones_bono10 + v_bonificaciones_bono10 + v_otros_ing_bono10 + v_incapacidad_bono10,
            2
        );
        v_renta_bono10 := ROUND(v_base_bono10_total * v_config.bono10_tasa, 2);
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 13 (Renta ISR sobre Bono 10%%) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 14: Descuentos no obligatorios — SIN diferir nada (confirmado por Imporfrut
    -- 2026-10-27, ver cabecera de esta migración: el tope del 20% es una validación al configurar
    -- la cuota de un préstamo, no un mecanismo de este motor). Todo evento de pago activo de la
    -- quincena se aplica completo. =====
    BEGIN
        FOR v_item IN
            SELECT e.monto, c.nombre AS categoria
            FROM public.planilla_descuento_eventos e
            JOIN public.planilla_descuentos d ON d.id = e.descuento_id
            JOIN public.planilla_descuento_categorias c ON c.id = d.categoria_id
            WHERE e.quincena_id = p_quincena_id AND e.tipo = 'pago' AND d.empleado_id = p_empleado_id

            UNION ALL

            SELECT p.monto, 'Anticipo de salario' AS categoria
            FROM public.planilla_anticipo_pagos p
            JOIN public.planilla_anticipos a ON a.id = p.anticipo_id
            WHERE p.quincena_id = p_quincena_id AND p.tipo = 'pago' AND a.empleado_id = p_empleado_id
        LOOP
            v_no_obligatorios_solicitado := ROUND(v_no_obligatorios_solicitado + v_item.monto, 2);
            v_no_obligatorios_aplicado := ROUND(v_no_obligatorios_aplicado + v_item.monto, 2);
            v_detalle := v_detalle || jsonb_build_object('categoria', v_item.categoria, 'monto', v_item.monto, 'aplicado', v_item.monto, 'diferido', 0);
        END LOOP;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Paso 14 (Descuentos) falló para %: %', v_empleado_ref, SQLERRM;
    END;

    -- ===== Paso 16: NETO A PAGAR =====
    BEGIN
        v_descuentos_obligatorios_total := ROUND(v_isss + v_afp + v_ipsfa + v_renta_isr + v_renta_bono10, 2);
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
            0, 0, false,
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
