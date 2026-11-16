-- IMPL-99 (Planilla Unica ISSS/AFP): 2 campos nuevos que no existian en ningun lado del modelo.
--
-- numero_patronal_isss: constante de toda la empresa, va en cada fila del archivo (columna 2).
-- numero_afiliado_isss: numero ISSS de cada empleado, va en cada fila del archivo (columna 7).
--
-- Ambos NULL hasta que se capturen (mismo criterio que sector_economico, migracion anterior):
-- nunca se asume/inventa un valor por defecto.

ALTER TABLE planilla_config_empresa
    ADD COLUMN numero_patronal_isss TEXT;

COMMENT ON COLUMN planilla_config_empresa.numero_patronal_isss IS
    'Numero Patronal ISSS de la empresa (IMPL-99, columna 2 de la Planilla Unica ISSS/AFP). NULL = no configurado.';

ALTER TABLE planilla_empleados
    ADD COLUMN numero_afiliado_isss TEXT;

COMMENT ON COLUMN planilla_empleados.numero_afiliado_isss IS
    'Numero de afiliado ISSS del empleado (IMPL-99, columna 7 de la Planilla Unica ISSS/AFP). NULL = no capturado.';
