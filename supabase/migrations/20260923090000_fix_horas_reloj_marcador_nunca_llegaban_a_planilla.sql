-- Migration: horas extra del reloj marcador (matcheo automático) nunca llegaban al motor real
-- Author: @alexis
-- Description: Defecto crítico encontrado al triar historias en ARCHITECT REVIEW (2026-09-23):
--              `confirmar_importacion_reloj_marcador` solo insertaba tramos crudos
--              (entrada/salida) en `planilla_marcaciones` para los empleados matcheados
--              automáticamente por el reloj — tabla que `calcular_planilla_empleado` (el motor
--              real de Cálculo de Planilla) NUNCA lee (confirmado por grep: no hay ningún JOIN a
--              `planilla_marcaciones` en todo el motor). Solo los "empleados agregados
--              manualmente" (US-HEX-07, horas tipeadas a mano) llegaban a
--              `planilla_horas_extras_manual`, la tabla que el motor sí suma en su Paso 3. Es
--              decir: las horas extra de cualquier empleado detectado normalmente por el reloj
--              (el caso común, no la excepción) se calculaban y se mostraban en pantalla, pero
--              nunca se convertían en plata real pagada.
--
--              El fix del lado frontend (`ImportacionMarcacionesSection.tsx:handleConfirmar`)
--              ahora agrupa las horas ya calculadas por empleado (sumando sus días de la
--              quincena) y las manda al mismo parámetro `p_agregados` del RPC, junto con las
--              realmente tipeadas a mano — pero el RPC hardcodeaba `agregado_manualmente = true`
--              para TODO lo que llegaba por ese parámetro, sin distinguir origen. Esta migración
--              hace que el RPC lea el campo `agregado_manualmente` de cada elemento del JSONB en
--              vez de hardcodearlo — el frontend ahora manda `false` para las horas reales del
--              reloj y `true` para las tipeadas a mano (US-HEX-07). Se usa `COALESCE(...,
--              true)` para que un llamador viejo (sin este campo en el payload) preserve el
--              comportamiento anterior en vez de fallar.

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
