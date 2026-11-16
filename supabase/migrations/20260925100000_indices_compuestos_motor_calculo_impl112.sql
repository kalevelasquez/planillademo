-- =============================================================================
-- MIGRACIÓN: indices_compuestos_motor_calculo_impl112
-- =============================================================================
-- IMPL-112 (US-PER-03) — profilaxis de rendimiento, NO un bug confirmado. Los 3 CA de este
-- ticket son umbrales de tiempo (CA1: <15s para 300 empleados, CA2/CA3: percepción de UI) que
-- solo se pueden verificar con una prueba de carga real, que no existe todavía. Lo que SÍ se
-- pudo confirmar revisando `calcular_planilla_empleado` directamente (motor real, no el mirror
-- TS): el loop por empleado consulta 8 tablas satélite, TODAS filtrando por el mismo patrón
-- exacto `WHERE quincena_id = p_quincena_id AND empleado_id = p_empleado_id` — y ninguna tenía
-- un índice compuesto que cubriera ambas columnas juntas:
--
--   - planilla_viaticos_fijos_variables, planilla_viaticos_por_ruta,
--     planilla_viaticos_kilometraje, planilla_incapacidades: solo índice de quincena_id.
--   - planilla_vacaciones, planilla_bonificaciones, planilla_otros_ingresos: índices de
--     quincena_id Y empleado_id, pero SEPARADOS (Postgres puede combinarlos vía bitmap AND,
--     menos eficiente que un solo índice compuesto para una igualdad exacta en ambas columnas).
--   - planilla_horas_extras_manual: tiene un UNIQUE(quincena_id, ubicacion_id, empleado_id),
--     pero esta consulta puntual del motor NO filtra por ubicacion_id — al quedar esa columna
--     en el medio del índice, Postgres no puede usarlo como un seek directo para
--     (quincena_id, empleado_id) solos.
--
-- Con 300 empleados por quincena (CA1), son hasta 2,400 lookups por cálculo completo
-- (8 tablas × 300 empleados) — agregar el índice compuesto correcto es de bajo riesgo (aditivo,
-- no reemplaza ni borra nada existente) y bajo costo (tablas de tamaño moderado, sin impacto
-- medible en escrituras). No se corrió una prueba de carga real todavía — este cambio es
-- preventivo, no la confirmación de que CA1/CA2/CA3 ya se cumplen.
-- =============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_planilla_horas_extras_manual_quincena_empleado
    ON public.planilla_horas_extras_manual (quincena_id, empleado_id);

CREATE INDEX IF NOT EXISTS idx_planilla_viaticos_fijos_variables_quincena_empleado
    ON public.planilla_viaticos_fijos_variables (quincena_id, empleado_id);

CREATE INDEX IF NOT EXISTS idx_planilla_viaticos_por_ruta_quincena_empleado
    ON public.planilla_viaticos_por_ruta (quincena_id, empleado_id);

CREATE INDEX IF NOT EXISTS idx_planilla_viaticos_kilometraje_quincena_empleado
    ON public.planilla_viaticos_kilometraje (quincena_id, empleado_id);

CREATE INDEX IF NOT EXISTS idx_planilla_incapacidades_quincena_empleado
    ON public.planilla_incapacidades (quincena_id, empleado_id);

CREATE INDEX IF NOT EXISTS idx_planilla_vacaciones_quincena_empleado
    ON public.planilla_vacaciones (quincena_id, empleado_id);

CREATE INDEX IF NOT EXISTS idx_planilla_bonificaciones_quincena_empleado
    ON public.planilla_bonificaciones (quincena_id, empleado_id);

CREATE INDEX IF NOT EXISTS idx_planilla_otros_ingresos_quincena_empleado
    ON public.planilla_otros_ingresos (quincena_id, empleado_id);

COMMIT;
