-- Migration: Agregar Empleado No Detectado en la Importación (IMPL-20 / US-HEX-07)
-- Author: @alexis
-- Description: (1) Agrega `agregado_manualmente` a `planilla_horas_extras_manual` — distingue
--              en el modelo de datos (no solo en la UI) las filas que vienen de "agregar
--              empleado no detectado" dentro del flujo de Reloj Marcador (esta historia) de
--              las de la carga manual normal (IMPL-25). (2) Crea el RPC transaccional
--              `confirmar_importacion_reloj_marcador`, que reemplaza las dos escrituras
--              sueltas que hacía el flujo de confirmación (`planilla_marcaciones` insert +
--              `completar_ubicacion_modulo`) por una sola operación atómica que también
--              agrega el upsert en `planilla_horas_extras_manual` para los empleados
--              agregados manualmente — evita el estado parcial de "marcaciones importadas
--              pero empleados agregados sin persistir" que señaló la revisión de diseño.

BEGIN;

ALTER TABLE public.planilla_horas_extras_manual
    ADD COLUMN IF NOT EXISTS agregado_manualmente BOOLEAN NOT NULL DEFAULT false;

-- RPC transaccional: inserta marcaciones del archivo + upsertea empleados agregados
-- manualmente + completa la ubicación, todo en una sola transacción. Sin SECURITY DEFINER
-- (mismo criterio que completar_ubicacion_modulo/create_quincena) — sigue aplicando RLS del
-- rol invocante en cada INSERT/UPDATE.
CREATE OR REPLACE FUNCTION public.confirmar_importacion_reloj_marcador(
    p_quincena_id UUID,
    p_ubicacion_id UUID,
    p_marcaciones JSONB,
    p_agregados JSONB,
    p_user_id UUID
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    v_tenant_id := public.get_auth_tenant_id();

    INSERT INTO public.planilla_marcaciones (
        tenant_id, quincena_id, ubicacion_id, empleado_id, entrada, salida, id_usuario_archivo, editado_manualmente, created_by
    )
    SELECT
        v_tenant_id,
        p_quincena_id,
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
        p_ubicacion_id,
        (a->>'empleado_id')::UUID,
        (a->>'hed')::NUMERIC,
        (a->>'hen')::NUMERIC,
        (a->>'nocturnidad')::NUMERIC,
        (a->>'feriado')::NUMERIC,
        (a->>'monto_total')::NUMERIC,
        p_user_id,
        now(),
        true
    FROM jsonb_array_elements(p_agregados) AS a
    ON CONFLICT (quincena_id, ubicacion_id, empleado_id) DO UPDATE
        SET hed = EXCLUDED.hed,
            hen = EXCLUDED.hen,
            nocturnidad = EXCLUDED.nocturnidad,
            feriado = EXCLUDED.feriado,
            monto_total = EXCLUDED.monto_total,
            guardado_por = EXCLUDED.guardado_por,
            guardado_at = EXCLUDED.guardado_at,
            agregado_manualmente = true,
            updated_at = now();

    PERFORM public.completar_ubicacion_modulo(p_quincena_id, p_ubicacion_id, 'horas_extras', p_user_id);
END;
$$;

COMMIT;
