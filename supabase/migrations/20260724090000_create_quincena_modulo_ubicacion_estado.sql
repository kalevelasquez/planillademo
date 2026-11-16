-- Migration: Completitud por Ubicación de un Módulo (corrección de arquitectura)
-- Author: @alexis
-- Description: BUG encontrado al diseñar US-HEX-06 (Carga Manual de Horas Extra): la tabla
--              `quincena_modulo_estado` (IMPL-16) tiene UNA sola fila por (quincena, módulo)
--              — sin dimensión de ubicación. Confirmar la importación de la PRIMERA ubicación
--              con modalidad Reloj Marcador ya deja el módulo `horas_extras` en 'confirmado'
--              a nivel de TODA la quincena, y la RLS de `planilla_marcaciones` (IMPL-23)
--              bloquea entonces PERMANENTEMENTE a las demás ubicaciones de importar sus
--              propios datos, aunque nunca hayan subido nada. Esta migración corrige el
--              problema antes de construir la carga manual (que tiene el mismo problema con
--              varias ubicaciones "Manual").
--
--              Se generaliza por `modulo` (no hardcodeada a horas_extras) porque este mismo
--              patrón de "completitud por ubicación que resume a nivel de módulo" es
--              razonable que se repita para otros módulos con múltiples ubicaciones más
--              adelante.

BEGIN;

CREATE TABLE IF NOT EXISTS public.quincena_modulo_ubicacion_estado (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    quincena_id UUID NOT NULL REFERENCES public.quincenas(id) ON DELETE CASCADE,
    ubicacion_id UUID NOT NULL REFERENCES public.planilla_ubicaciones(id),
    modulo TEXT NOT NULL CHECK (modulo IN (
        'horas_extras', 'viaticos', 'vacaciones', 'bonificaciones', 'anticipos', 'incapacidades', 'descuentos'
    )),
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'completado')),
    completado_por UUID REFERENCES public.user_profiles(id),
    completado_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,

    UNIQUE (quincena_id, ubicacion_id, modulo)
);

CREATE INDEX IF NOT EXISTS idx_quincena_modulo_ubicacion_estado_quincena ON public.quincena_modulo_ubicacion_estado(quincena_id, modulo);

ALTER TABLE public.quincena_modulo_ubicacion_estado ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quincena_modulo_ubicacion_estado_select_tenant"
    ON public.quincena_modulo_ubicacion_estado FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "quincena_modulo_ubicacion_estado_insert_en_proceso"
    ON public.quincena_modulo_ubicacion_estado FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

CREATE POLICY "quincena_modulo_ubicacion_estado_update_en_proceso"
    ON public.quincena_modulo_ubicacion_estado FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

DROP TRIGGER IF EXISTS tr_audit_quincena_modulo_ubicacion_estado ON public.quincena_modulo_ubicacion_estado;
CREATE TRIGGER tr_audit_quincena_modulo_ubicacion_estado
    AFTER INSERT OR UPDATE ON public.quincena_modulo_ubicacion_estado
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- RPC transaccional: marca la ubicación como completada y, si TODAS las ubicaciones activas
-- ya están completadas para este módulo, confirma el módulo a nivel de quincena. Sin
-- SECURITY DEFINER (mismo criterio que create_quincena/register_indemnizacion) — sigue
-- aplicando RLS del rol invocante. El SELECT ... FOR UPDATE serializa el chequeo cuando dos
-- ubicaciones terminan casi al mismo tiempo.
CREATE OR REPLACE FUNCTION public.completar_ubicacion_modulo(
    p_quincena_id UUID,
    p_ubicacion_id UUID,
    p_modulo TEXT,
    p_user_id UUID
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID;
    v_modulo_estado_id UUID;
    v_total_activas INT;
    v_total_completadas INT;
BEGIN
    v_tenant_id := public.get_auth_tenant_id();

    INSERT INTO public.quincena_modulo_ubicacion_estado (tenant_id, quincena_id, ubicacion_id, modulo, estado, completado_por, completado_at)
    VALUES (v_tenant_id, p_quincena_id, p_ubicacion_id, p_modulo, 'completado', p_user_id, now())
    ON CONFLICT (quincena_id, ubicacion_id, modulo)
    DO UPDATE SET estado = 'completado', completado_por = p_user_id, completado_at = now();

    SELECT id INTO v_modulo_estado_id
    FROM public.quincena_modulo_estado
    WHERE quincena_id = p_quincena_id AND modulo = p_modulo
    FOR UPDATE;

    IF v_modulo_estado_id IS NULL THEN
        RETURN;
    END IF;

    SELECT count(*) INTO v_total_activas
    FROM public.planilla_ubicaciones u
    WHERE u.tenant_id = v_tenant_id AND u.estado = 'activo';

    SELECT count(*) INTO v_total_completadas
    FROM public.quincena_modulo_ubicacion_estado e
    JOIN public.planilla_ubicaciones u ON u.id = e.ubicacion_id
    WHERE e.quincena_id = p_quincena_id AND e.modulo = p_modulo AND e.estado = 'completado' AND u.estado = 'activo';

    IF v_total_activas > 0 AND v_total_completadas >= v_total_activas THEN
        UPDATE public.quincena_modulo_estado
        SET estado = 'confirmado', confirmado_por = p_user_id, confirmado_at = now(), via_sin_registros = false
        WHERE id = v_modulo_estado_id;
    END IF;
END;
$$;

-- Retrofit de la RLS de planilla_marcaciones (IMPL-23): el candado ahora es por ubicación,
-- no por quincena completa.
ALTER POLICY "planilla_marcaciones_insert_modulo_no_confirmado" ON public.planilla_marcaciones
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND NOT EXISTS (
            SELECT 1 FROM public.quincena_modulo_ubicacion_estado qmue
            WHERE qmue.quincena_id = planilla_marcaciones.quincena_id
              AND qmue.ubicacion_id = planilla_marcaciones.ubicacion_id
              AND qmue.modulo = 'horas_extras'
              AND qmue.estado = 'completado'
        )
    );

ALTER POLICY "planilla_marcaciones_delete_modulo_no_confirmado" ON public.planilla_marcaciones
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND NOT EXISTS (
            SELECT 1 FROM public.quincena_modulo_ubicacion_estado qmue
            WHERE qmue.quincena_id = planilla_marcaciones.quincena_id
              AND qmue.ubicacion_id = planilla_marcaciones.ubicacion_id
              AND qmue.modulo = 'horas_extras'
              AND qmue.estado = 'completado'
        )
    );

-- Backfill: para cada quincena todavía abierta y cada ubicación activa, sembrar la fila
-- 'pendiente' de horas_extras — para que el NOT EXISTS de arriba tenga con qué evaluar desde
-- ya (si no, ninguna fila existiría y el NOT EXISTS pasaría siempre, lo cual es el
-- comportamiento correcto de todas formas, pero se siembra explícito para dejar el estado
-- inicial consistente con lo que haría inicializarEstadosUbicacion desde la app).
DO $$
DECLARE
    q RECORD;
    u RECORD;
BEGIN
    FOR q IN SELECT id, tenant_id FROM public.quincenas WHERE estado != 'aprobada_cerrada' AND deleted_at IS NULL LOOP
        FOR u IN SELECT id FROM public.planilla_ubicaciones WHERE tenant_id = q.tenant_id AND estado = 'activo' LOOP
            INSERT INTO public.quincena_modulo_ubicacion_estado (tenant_id, quincena_id, ubicacion_id, modulo)
            VALUES (q.tenant_id, q.id, u.id, 'horas_extras')
            ON CONFLICT (quincena_id, ubicacion_id, modulo) DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

COMMIT;
