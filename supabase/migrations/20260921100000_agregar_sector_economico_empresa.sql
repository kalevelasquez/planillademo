-- IMPL-161 CA1: el tope de Indemnizacion (4x salario minimo diario, Art. 58 CT) varia por sector
-- economico. Se guarda como columna nullable en planilla_config_empresa (mismo criterio que
-- salario_minimo_inembargable en planilla_config_fiscal: NULL hasta que se configure
-- explicitamente, nunca un default asumido -- mientras sea NULL, calcularIndemnizacion() en el
-- frontend devuelve pendiente_definir en vez de inventar un tope).

ALTER TABLE planilla_config_empresa
    ADD COLUMN sector_economico TEXT
    CHECK (sector_economico IN ('comercio_servicios_industria', 'maquila_textil', 'beneficio_cafe_cana', 'agropecuario_pesca'));

COMMENT ON COLUMN planilla_config_empresa.sector_economico IS
    'Sector economico para el Decreto de Salario Minimo (IMPL-161 CA1) -- determina el tope de 4x salario minimo diario para Indemnizacion. NULL = no configurado.';
