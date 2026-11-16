-- Migration: corregir y completar el catálogo de cuentas contables por grupo de costos
-- Author: @alexis
-- Description: El usuario compartió el catálogo completo de cuentas de Imporfrut
--              (`docs/formatos-reportes/catalogo de cuentas contables(Sheet1).csv`, ASPEL) — y
--              reveló un error real en `20261002100000_catalogo_cuentas_contables_pregunta8.sql`:
--              esa migración sembró el grupo "GASTOS DE VENTAS" apuntando a los códigos
--              `4-42-4201-xxx`, asumiendo que `4201` era Ventas porque la cuenta "Gasto Depr. y
--              Combustible Vendedores" aparecía ahí en un PDF escaneado. FALSO POSITIVO: esa
--              misma cuenta existe IDÉNTICA en los 3 grupos (`4201-03-002`, `4202-03-002`,
--              `4203-03-002`) — cada grupo de costos tiene su propio "combustible de personal que
--              viaja", no es evidencia exclusiva de Ventas. El catálogo real, sin ambigüedad:
--                  4-42-4201-xxx = GASTOS DE ADMINISTRACION
--                  4-42-4202-xxx = GASTOS DE VENTA
--                  4-42-4203-xxx = GASTOS DE OPERACIONES
--
--              Corrige las 8 filas ya sembradas de 'GASTOS DE VENTAS' (estaban en 4201, pasan a
--              4202) y agrega las 8 filas de 'GASTOS ADMINISTRATIVOS' (4201) y 'GASTO DE
--              OPERACIONES' (4203) que habían quedado pendientes por falta de esta fuente — los
--              labels de `grupo_costos` son EXACTOS a los que ya usa
--              `planilla_departamentos.grupo_costos` (20260909120000: 'GASTOS ADMINISTRATIVOS',
--              'GASTOS DE VENTAS', 'GASTO DE OPERACIONES' — este último en singular "GASTO", no
--              "GASTOS", tal cual quedó ahí) — `exportacionesContablesService.generarPartidaDiario`
--              resuelve por match exacto de este string, así que cualquier diferencia de
--              singular/plural rompería el join en silencio, cayendo a 'PENDIENTE_CONFIGURAR'.
--
--              Esto resuelve la pregunta 1 de las 4 que quedaron pendientes en IMPL-98/Pregunta 8
--              ("¿cuáles cuentas son Administración y cuáles Operaciones?") — las otras 3
--              (cuenta del banco de desembolso, origen de "combustible de vendedores", regla de
--              pago individual vs. agregado) siguen sin resolver, fuera de alcance de esta
--              migración.
--
--              "Gasto Depr./Dep. y Combustible Vendedores" se corrige como referencia en las 3
--              filas (sigue sin consumirse en `generarPartidaDiario`, mismo estado que antes).

BEGIN;

UPDATE public.planilla_catalogo_cuentas_contables SET cuenta_codigo = v.cuenta_codigo, cuenta_nombre = v.cuenta_nombre, updated_at = now()
FROM (VALUES
    ('sueldos', '4-42-4202-01-001', 'Sueldos y Salarios'),
    ('horas_extras', '4-42-4202-01-003', 'Horas Extras'),
    ('bonificaciones', '4-42-4202-01-005', 'Bonificaciones'),
    ('viaticos', '4-42-4202-03-008', 'Viaticos ( personal )'),
    ('isss_patronal', '4-42-4202-02-001', 'I.S.S.S.'),
    ('afp_patronal', '4-42-4202-02-002', 'A.F.P. Cuota Patronal'),
    ('insaforp_patronal', '4-42-4202-02-003', 'Insaforp'),
    ('combustible_depreciacion_vendedores', '4-42-4202-03-002', 'gastos Dep. y Combustible Vendedores')
) AS v(concepto, cuenta_codigo, cuenta_nombre)
WHERE planilla_catalogo_cuentas_contables.concepto = v.concepto
  AND planilla_catalogo_cuentas_contables.grupo_costos = 'GASTOS DE VENTAS';

INSERT INTO public.planilla_catalogo_cuentas_contables (tenant_id, concepto, grupo_costos, cuenta_codigo, cuenta_nombre)
SELECT t.id, v.concepto, v.grupo_costos, v.cuenta_codigo, v.cuenta_nombre
FROM public.tenants t
CROSS JOIN (VALUES
    ('sueldos', 'GASTOS ADMINISTRATIVOS', '4-42-4201-01-001', 'Sueldos y Salarios'),
    ('horas_extras', 'GASTOS ADMINISTRATIVOS', '4-42-4201-01-003', 'Horas Extras'),
    ('bonificaciones', 'GASTOS ADMINISTRATIVOS', '4-42-4201-01-005', 'Bonificaciones'),
    ('viaticos', 'GASTOS ADMINISTRATIVOS', '4-42-4201-03-008', 'Viaticos ( personal)'),
    ('isss_patronal', 'GASTOS ADMINISTRATIVOS', '4-42-4201-02-001', 'I.S.S.S.'),
    ('afp_patronal', 'GASTOS ADMINISTRATIVOS', '4-42-4201-02-002', 'A.F.P.'),
    ('insaforp_patronal', 'GASTOS ADMINISTRATIVOS', '4-42-4201-02-003', 'Insaforp'),
    ('combustible_depreciacion_vendedores', 'GASTOS ADMINISTRATIVOS', '4-42-4201-03-002', 'Gasto Depr. y Combustible Vendedores'),

    ('sueldos', 'GASTO DE OPERACIONES', '4-42-4203-01-001', 'Sueldos y Salarios'),
    ('horas_extras', 'GASTO DE OPERACIONES', '4-42-4203-01-003', 'Horas Extras'),
    ('bonificaciones', 'GASTO DE OPERACIONES', '4-42-4203-01-005', 'Bonificaciones'),
    ('viaticos', 'GASTO DE OPERACIONES', '4-42-4203-03-008', 'Viaticos ( personal )'),
    ('isss_patronal', 'GASTO DE OPERACIONES', '4-42-4203-02-001', 'I.S.S.S.'),
    ('afp_patronal', 'GASTO DE OPERACIONES', '4-42-4203-02-002', 'A.F.P. Cuota Patronal'),
    ('insaforp_patronal', 'GASTO DE OPERACIONES', '4-42-4203-02-003', 'Insaforp'),
    ('combustible_depreciacion_vendedores', 'GASTO DE OPERACIONES', '4-42-4203-03-002', 'Gasto de Dep. y Combustible Vendedores')
) AS v(concepto, grupo_costos, cuenta_codigo, cuenta_nombre)
ON CONFLICT (tenant_id, concepto, grupo_costos) DO NOTHING;

COMMIT;
