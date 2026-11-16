-- Migration: catálogo de cuentas contables para exportación ASPEL (respuesta Imporfrut pregunta 8)
-- Author: @alexis
-- Description: Imporfrut compartió un ejemplo real de partida contable ("Registro Planilla de
--              Sueldo 2da Quincena Agosto-2026") que reveló que `generarPartidaDiario` (creada en
--              IMPL-98 como PROPUESTA INICIAL, con códigos 5xxx/2xxx genéricos hardcodeados en
--              TypeScript) estaba mal diseñada de raíz para el caso real: cada concepto de gasto
--              tiene UNA CUENTA DISTINTA POR GRUPO DE COSTOS (Administración/Ventas/Operaciones,
--              IMPL-167, `planilla_departamentos.grupo_costos`), no una sola cuenta agregada por
--              tenant.
--
--              Se crea un catálogo configurable en vez de seguir hardcodeando los códigos en
--              TypeScript — así Imporfrut puede ajustar cuentas sin pedir un redeploy.
--
--              DATOS SEMBRADOS, SOLO LO CONFIRMADO CON EVIDENCIA DIRECTA: el grupo "GASTOS DE
--              VENTAS" quedó confirmado porque la cuenta "Gasto Depr. y Combustible Vendedores"
--              del documento real cae dentro de las cuentas `4-42-4201-xxx`. Los grupos "GASTOS
--              ADMINISTRATIVOS" y "GASTO DE OPERACIONES" NO se siembran todavía — el documento
--              real sí trae los códigos exactos de los otros 2 grupos (`4-42-4202-xxx` y
--              `4-42-4203-xxx`), pero no hay forma de saber cuál es cuál sin que Imporfrut lo
--              confirme (Alexis se lo pregunta en sesión en vivo). `generarPartidaDiario` queda
--              preparado para usar el catálogo apenas se complete esa fila, sin tocar código de
--              nuevo — ver el comentario ahí.
--
--              Vacaciones usa una cuenta de PASIVO (`2-21-2104-04-000`, no un gasto `4xxx`) — se
--              siembra SIN segmentar por grupo_costos (`grupo_costos=''`) porque el mismo código
--              apareció igual en los 2 grupos de gasto que sí se pudieron leer con confianza del
--              documento real; tentativo, pendiente de confirmar si en realidad varía por grupo.
--
--              "Gasto Depr. y Combustible Vendedores" (`4-42-4201-03-002`) se siembra en el
--              catálogo como referencia, pero NO se usa todavía en `generarPartidaDiario` — no se
--              sabe de qué concepto del sistema sale ese monto (pregunta pendiente a Imporfrut).
--
--              Lado crédito (retenciones por institución/categoría, banco de desembolso,
--              anticipos por empleado): el documento también lo reveló, pero esa página del PDF
--              es una imagen escaneada que no se pudo transcribir con la confianza necesaria para
--              algo que toca cuentas contables reales — NO se siembra nada de eso todavía.
--              `planilla_descuento_categorias` gana las 2 columnas para cuando se complete.

BEGIN;

CREATE TABLE public.planilla_catalogo_cuentas_contables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    concepto TEXT NOT NULL,
    -- '' (no NULL) representa "sin segmentar por grupo de costos" -- un NULL no garantizaría
    -- unicidad en el UNIQUE de abajo (Postgres trata NULL <> NULL).
    grupo_costos TEXT NOT NULL DEFAULT '',
    cuenta_codigo TEXT NOT NULL,
    cuenta_nombre TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, concepto, grupo_costos)
);

ALTER TABLE public.planilla_catalogo_cuentas_contables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_catalogo_cuentas_contables_select_tenant"
    ON public.planilla_catalogo_cuentas_contables FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_catalogo_cuentas_contables_insert_admin"
    ON public.planilla_catalogo_cuentas_contables FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_catalogo_cuentas_contables_update_admin"
    ON public.planilla_catalogo_cuentas_contables FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

ALTER TABLE public.planilla_descuento_categorias
    ADD COLUMN IF NOT EXISTS cuenta_codigo TEXT,
    ADD COLUMN IF NOT EXISTS cuenta_nombre TEXT;

INSERT INTO public.planilla_catalogo_cuentas_contables (tenant_id, concepto, grupo_costos, cuenta_codigo, cuenta_nombre)
SELECT t.id, v.concepto, v.grupo_costos, v.cuenta_codigo, v.cuenta_nombre
FROM public.tenants t
CROSS JOIN (VALUES
    ('sueldos', 'GASTOS DE VENTAS', '4-42-4201-01-001', 'Sueldos y Salarios'),
    ('horas_extras', 'GASTOS DE VENTAS', '4-42-4201-01-003', 'Horas Extras'),
    ('bonificaciones', 'GASTOS DE VENTAS', '4-42-4201-01-005', 'Bonificaciones'),
    ('viaticos', 'GASTOS DE VENTAS', '4-42-4201-03-008', 'Viaticos (personal)'),
    ('isss_patronal', 'GASTOS DE VENTAS', '4-42-4201-02-001', 'I.S.S.S.'),
    ('afp_patronal', 'GASTOS DE VENTAS', '4-42-4201-02-002', 'A.F.P.'),
    ('insaforp_patronal', 'GASTOS DE VENTAS', '4-42-4201-02-003', 'Insaforp'),
    -- Referencia, todavía NO usada en generarPartidaDiario (ver cabecera de esta migración).
    ('combustible_depreciacion_vendedores', 'GASTOS DE VENTAS', '4-42-4201-03-002', 'Gasto Depr. y Combustible Vendedores'),
    -- Vacaciones: pasivo, sin segmentar por grupo_costos (grupo_costos='') -- ver cabecera.
    ('vacaciones', '', '2-21-2104-04-000', 'Vacaciones')
) AS v(concepto, grupo_costos, cuenta_codigo, cuenta_nombre);

COMMIT;
