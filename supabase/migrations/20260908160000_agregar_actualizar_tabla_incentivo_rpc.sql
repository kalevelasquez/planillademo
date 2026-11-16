-- Migration: RPC actualizar_tabla_incentivo (defecto UAT, 2026-09-02)
-- Author: @alexis
-- Description: `planilla_tablas_incentivos` no tenía forma de editar una tabla ya creada (nombre,
--              asignación empleado/grupo, rangos) — solo alta (`crear_tabla_incentivo`),
--              activar/desactivar y eliminar. Igual que la creación, la edición toca 2 tablas a
--              la vez (cabecera + rangos), así que se resuelve con el mismo patrón: un RPC
--              atómico en vez de dos writes sueltos desde el cliente, para no dejar rangos
--              huérfanos o desincronizados si algo falla a mitad de camino. Reemplaza TODOS los
--              rangos existentes por los nuevos (delete + insert), igual de simple que el modal
--              ya hace hoy para armar la lista completa antes de guardar.

BEGIN;

CREATE OR REPLACE FUNCTION public.actualizar_tabla_incentivo(
    p_id UUID,
    p_nombre TEXT,
    p_empleado_id UUID,
    p_grupo TEXT,
    p_rangos JSONB
) RETURNS public.planilla_tablas_incentivos
LANGUAGE plpgsql
AS $$
DECLARE
    v_tabla public.planilla_tablas_incentivos;
    v_rango JSONB;
BEGIN
    UPDATE public.planilla_tablas_incentivos
    SET nombre = p_nombre,
        empleado_id = p_empleado_id,
        grupo = p_grupo,
        updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_tabla;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Tabla de incentivo % no encontrada', p_id;
    END IF;

    DELETE FROM public.planilla_tablas_incentivos_rangos WHERE tabla_id = p_id;

    FOR v_rango IN SELECT * FROM jsonb_array_elements(p_rangos)
    LOOP
        INSERT INTO public.planilla_tablas_incentivos_rangos (tenant_id, tabla_id, desde, hasta, bono)
        VALUES (
            v_tabla.tenant_id,
            v_tabla.id,
            (v_rango->>'desde')::NUMERIC,
            NULLIF(v_rango->>'hasta', '')::NUMERIC,
            (v_rango->>'bono')::NUMERIC
        );
    END LOOP;

    RETURN v_tabla;
END;
$$;

COMMIT;
