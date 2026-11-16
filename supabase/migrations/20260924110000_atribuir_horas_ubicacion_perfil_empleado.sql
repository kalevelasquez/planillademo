-- Migration: atribuir horas a la ubicación del PERFIL del empleado, no a la pantalla (IMPL-28)
-- Author: @alexis
-- Description: US-HEX-10 CA1/CA2 — cuando un empleado trabaja físicamente en una ubicación
--              distinta a la asignada en su perfil, sus horas deben registrarse bajo SU
--              ubicación, no bajo la pantalla donde se subió el Excel. Antes,
--              `confirmar_importacion_reloj_marcador` insertaba TODAS las filas del lote con un
--              único `p_ubicacion_id` fijo (la pantalla), sin mirar `planilla_empleados.ubicacion_id`
--              — el gap real quedó confirmado en el triage de Architect Review, IMPL-28.
--
--              CAMBIO DE MODELO — se introduce `origen_ubicacion_id` en `planilla_marcaciones`,
--              DISTINTO de `ubicacion_id`:
--                - `ubicacion_id`   = a qué ubicación se ATRIBUYEN las horas (perfil del empleado).
--                - `origen_ubicacion_id` = desde qué PANTALLA se confirmó este lote (p_ubicacion_id).
--              Son la misma columna hasta esta migración (backfill: origen = ubicacion para todo
--              lo histórico). Necesario porque el mecanismo de "reemplazar, no duplicar"
--              (migración 20260923100000) borraba por `ubicacion_id = p_ubicacion_id` — si las
--              horas de un empleado cross-location quedan atribuidas a OTRA ubicación, ese DELETE
--              nunca las encontraría al reconfirmar desde la pantalla de origen, duplicando sus
--              tramos (mismo bug que 20260923100000 ya había resuelto para el caso normal,
--              reintroducido para el caso cross-location si no se ajusta el DELETE). Ahora el
--              DELETE borra por `origen_ubicacion_id = p_ubicacion_id` — todo lo que esta
--              pantalla produjo alguna vez, sin importar dónde terminó atribuido — y el INSERT
--              graba ambas columnas por separado.
--              `planilla_horas_extras_manual` NO necesita esta misma columna: su propio
--              `ON CONFLICT (quincena_id, ubicacion_id, empleado_id)` ya la protege de duplicar
--              (hace upsert, no lo evita moviendo el ubicacion_id).
--
--              GUARD explícito nuevo: si alguna de las ubicaciones REALES a las que este lote va
--              a atribuir horas (que puede incluir otras sedes) ya tiene su propio módulo
--              "horas_extras" cerrado (`completado`) para esta quincena, la confirmación se
--              rechaza con un mensaje claro y accionable — decisión explícita del usuario tras
--              consultarle (ver AskUserQuestion en la sesión): sin este guard, la RLS de
--              `planilla_horas_extras_manual` (que sí valida por ubicación, ver
--              20260725090000_create_planilla_horas_extras_manual.sql) rechazaría el INSERT con
--              un error genérico de Postgres, rompiendo TODA la confirmación de la pantalla de
--              origen por un estado que pertenece a otra ubicación, sin que el Preparador
--              entienda por qué.
--
--              Vista de "confirmados" (IMPL-149): sin cambios de código — sigue filtrando por
--              `ubicacion_id` (a qué se atribuye), así que una fila cross-location deja de
--              aparecer en la pantalla de origen y pasa a vivir en la de destino — decisión
--              explícita del usuario ("que desaparezca de su lista").
--
--              Cliente: `EmpleadoMatch`/`FilaValidacion` (marcacionesValidacionUtils.ts) ahora
--              cargan `ubicacion_id`/`empleadoUbicacionId`; `handleConfirmar`
--              (ImportacionMarcacionesSection.tsx) resuelve `ubicacion_id` por fila
--              (`empleado.ubicacion_id ?? ubicacionId` de la pantalla, respaldo para empleados
--              sin ubicación asignada en su perfil) y lo manda en el JSONB de cada fila —
--              `p_ubicacion_id` del RPC pasa a significar SOLO "la pantalla que confirma".

BEGIN;

ALTER TABLE public.planilla_marcaciones
    ADD COLUMN IF NOT EXISTS origen_ubicacion_id UUID REFERENCES public.planilla_ubicaciones(id);

UPDATE public.planilla_marcaciones
SET origen_ubicacion_id = ubicacion_id
WHERE origen_ubicacion_id IS NULL;

ALTER TABLE public.planilla_marcaciones
    ALTER COLUMN origen_ubicacion_id SET NOT NULL;

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

    PERFORM public.completar_ubicacion_modulo(p_quincena_id, p_ubicacion_id, 'horas_extras', p_user_id);
END;
$$;

COMMIT;
