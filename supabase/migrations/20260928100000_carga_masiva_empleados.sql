-- Migration: Carga masiva de Empleados desde Excel (pedido directo del jefe, arranque de UAT)
-- Author: @alexis
-- Description: Imporfrut necesita cargar muchos empleados de una sola vez para esta semana,
--              en vez de uno por uno desde el formulario individual. Se agrega:
--
--              (a) Unicidad real de DUI — gap conocido que nunca se validó ni en el alta
--              individual ni a nivel de BD (columna `dui` era TEXT libre desde la migración
--              original). Se aprovecha esta carga nueva para cerrarlo, con el visto bueno
--              explícito del usuario aunque amplíe el alcance pedido. Parcial (no aplica a NULL
--              ni a empleados borrados) para no romper altas existentes con DUI vacío ni el
--              historial de bajas.
--
--              (b) RPC transaccional `confirmar_importacion_empleados` — recibe SOLO filas que
--              el cliente (`empleadosExcelUtils.ts`) ya validó como correctas (mismo criterio que
--              `confirmar_importacion_reloj_marcador`: si una fila igual choca acá, ej. carrera
--              real entre dos importaciones simultáneas, TODA la llamada falla — no hay
--              recuperación fila por fila a nivel SQL, la tolerancia a errores vive en el
--              cliente). Genera el código EMP-YYYY-NNN de cada fila con el mismo contador atómico
--              que ya usa el alta individual (`planilla_empleados_codigo_contador`, mismo patrón
--              INSERT...ON CONFLICT...RETURNING de `generar_codigo_empleado`).
--
--              A propósito NO se pisa `generar_codigo_empleado` con un remake en lote: llamarlo
--              una vez por fila DENTRO de esta misma función logra lo mismo (cada llamada toma su
--              propio row lock atómico sobre el contador), sin duplicar la lógica del correlativo.
--
--              A propósito NO usa SECURITY DEFINER: la única tabla que este RPC escribe es
--              `planilla_empleados` (+ su contador de código), y la policy de INSERT de ambas ya
--              permite admin Y preparador_planilla — el mismo rol habilitado para el alta
--              individual. La resolución/alta rápida de Cargo/Departamento/Banco/Tipo de Contrato
--              (catálogos con RLS de INSERT más restrictiva, algunos admin-only) se resuelve del
--              lado del CLIENTE reusando las mismas funciones `crear*` que ya usa
--              `CatalogSelectQuickAdd` en el alta individual — hereda exactamente el mismo
--              comportamiento de permisos que el quick-add existente, en vez de que este RPC
--              bypasee esa RLS con privilegios elevados.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_planilla_empleados_dui_unico
    ON public.planilla_empleados (tenant_id, dui)
    WHERE deleted_at IS NULL AND dui IS NOT NULL;

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
            tenant_id, codigo, codigo_empleado_manual, nombre_completo, dui, nit, nup,
            fecha_nacimiento, sexo, telefono, correo, direccion,
            contacto_emergencia_nombre, contacto_emergencia_telefono,
            cargo, departamento, centro_costos, ubicacion_id, fecha_ingreso, sueldo_mensual,
            tipo_afiliacion, numero_afiliacion_afp, numero_afiliado_isss,
            banco, numero_cuenta, tipo_contrato, estado
        ) VALUES (
            v_tenant_id, v_codigo,
            v_row->>'codigo_empleado_manual', v_row->>'nombre_completo', v_row->>'dui',
            NULLIF(v_row->>'nit', ''), NULLIF(v_row->>'nup', ''),
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
