-- Migration: re-confirmar una importación de Reloj Marcador reemplaza los tramos anteriores
-- Author: @alexis
-- Description: Hallazgo real del usuario: si se reabre una ubicación de Horas Extras ya
--              confirmada y se vuelve a subir el Excel completo, `confirmar_importacion_reloj_marcador`
--              hacía un INSERT puro sin ningún ON CONFLICT/DELETE previo — `planilla_marcaciones`
--              no tiene ningún UNIQUE constraint más allá del `id` (ver
--              20260722090000_create_planilla_marcaciones.sql), así que reconfirmar duplicaba
--              los tramos en vez de reemplazarlos.
--
--              Fix: antes de insertar el lote nuevo, se borran los tramos existentes de esa
--              MISMA (quincena_id, ubicacion_id) — el DELETE ya estaba permitido por la policy
--              `planilla_marcaciones_delete_modulo_no_confirmado` mientras el módulo no esté
--              'confirmado' (que es justo el estado en el que queda tras reabrir), así que esto
--              no necesita ningún cambio de RLS. `planilla_horas_extras_manual` YA hacía upsert
--              (`ON CONFLICT ... DO UPDATE`, ver 20260923090000) — no necesitaba este mismo fix.
--
--              Alcance: esto resuelve "volver a subir el Excel completo reemplaza los datos".
--              NO resuelve "editar un registro puntual ya confirmado sin re-subir todo el
--              archivo" — esa es una funcionalidad nueva (una vista de edición para
--              `marcacionesConfirmadas`, hoy de solo lectura, IMPL-149) que queda pendiente
--              como trabajo aparte.

BEGIN;

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

    -- Reemplazar, no acumular: si esta ubicación/quincena ya tenía tramos de una confirmación
    -- anterior (reabierta para corregir), se descartan antes de insertar el lote actual completo.
    DELETE FROM public.planilla_marcaciones
    WHERE tenant_id = v_tenant_id AND quincena_id = p_quincena_id AND ubicacion_id = p_ubicacion_id;

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

    PERFORM public.completar_ubicacion_modulo(p_quincena_id, p_ubicacion_id, 'horas_extras', p_user_id);
END;
$$;

COMMIT;
