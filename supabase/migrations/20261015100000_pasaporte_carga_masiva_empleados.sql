-- Migration: cablear Pasaporte en la carga masiva de empleados
-- Author: @alexis
-- Description: IMPL (sin ticket, observación directa de Gilda, 2026-10-15) — el alta individual
--              (`EmpleadoDetailView.tsx`) ya acepta Pasaporte como alternativa al DUI (DUI o
--              Pasaporte, al menos uno de los dos). La carga masiva (`empleadosExcelUtils.ts`)
--              se actualizó del lado del cliente con la misma regla, pero el RPC
--              `confirmar_importacion_empleados` (20260928100000) nunca conocía la columna
--              `pasaporte` — la hubiera insertado como NULL siempre, descartando en silencio lo
--              que el cliente sí validó correctamente. Único cambio real: agregar `pasaporte` a
--              la lista de columnas/valores del INSERT, mismo patrón NULLIF que nit/nup (texto
--              libre, nunca vacío como cadena).

BEGIN;

CREATE OR REPLACE FUNCTION public.confirmar_importacion_empleados(p_empleados JSONB)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_row JSONB;
    v_anio INT;
    v_numero INT;
    v_codigo TEXT;
    v_creados INT := 0;
BEGIN
    IF NOT ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles())) THEN
        RAISE EXCEPTION 'No tenés permiso para importar empleados.';
    END IF;

    FOR v_row IN SELECT * FROM jsonb_array_elements(p_empleados)
    LOOP
        v_anio := EXTRACT(YEAR FROM (v_row->>'fecha_ingreso')::DATE);

        INSERT INTO public.planilla_empleados_codigo_contador (tenant_id, anio, ultimo_numero)
        VALUES (v_tenant_id, v_anio, 1)
        ON CONFLICT (tenant_id, anio)
        DO UPDATE SET ultimo_numero = public.planilla_empleados_codigo_contador.ultimo_numero + 1
        RETURNING ultimo_numero INTO v_numero;
        v_codigo := 'EMP-' || v_anio::TEXT || '-' || LPAD(v_numero::TEXT, 3, '0');

        INSERT INTO public.planilla_empleados (
            tenant_id, codigo, codigo_empleado_manual, nombre_completo, dui, pasaporte, nit, nup,
            fecha_nacimiento, sexo, telefono, correo, direccion,
            contacto_emergencia_nombre, contacto_emergencia_telefono,
            cargo, departamento, centro_costos, ubicacion_id, fecha_ingreso, sueldo_mensual,
            tipo_afiliacion, numero_afiliacion_afp, numero_afiliado_isss,
            banco, numero_cuenta, tipo_contrato, estado
        ) VALUES (
            v_tenant_id, v_codigo,
            v_row->>'codigo_empleado_manual', v_row->>'nombre_completo', NULLIF(v_row->>'dui', ''),
            NULLIF(v_row->>'pasaporte', ''), NULLIF(v_row->>'nit', ''), NULLIF(v_row->>'nup', ''),
            (v_row->>'fecha_nacimiento')::DATE, NULLIF(v_row->>'sexo', ''),
            NULLIF(v_row->>'telefono', ''), NULLIF(v_row->>'correo', ''), NULLIF(v_row->>'direccion', ''),
            NULLIF(v_row->>'contacto_emergencia_nombre', ''), NULLIF(v_row->>'contacto_emergencia_telefono', ''),
            NULLIF(v_row->>'cargo', ''), NULLIF(v_row->>'departamento', ''), NULLIF(v_row->>'centro_costos', ''),
            (v_row->>'ubicacion_id')::UUID, (v_row->>'fecha_ingreso')::DATE, (v_row->>'sueldo_mensual')::NUMERIC,
            NULLIF(v_row->>'tipo_afiliacion', ''), NULLIF(v_row->>'numero_afiliacion_afp', ''), NULLIF(v_row->>'numero_afiliado_isss', ''),
            NULLIF(v_row->>'banco', ''), NULLIF(v_row->>'numero_cuenta', ''), NULLIF(v_row->>'tipo_contrato', ''),
            'activo'
        );

        v_creados := v_creados + 1;
    END LOOP;

    RETURN v_creados;
END;
$$;

COMMIT;
