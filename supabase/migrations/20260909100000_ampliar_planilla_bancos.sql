-- Migration: Ampliar catálogo de Bancos de 5 a 10 (IMPL-167 CA4)
-- Author: @alexis
-- Description: el reporte de Descuentos pivot (US-EXP-11) confirmó contra el Excel real de
--              Imporfrut (`Planilla 1ra quincena abril 2026.xlsx`, hoja "Descuentos") que hay 5
--              instituciones financieras adicionales a las ya sembradas en
--              20260907100000_create_planilla_bancos.sql: Banco Azul, Primer Banco, Capital S.A.
--              de C.V. (financiera, no banco, pero vive en el mismo catálogo), Cajas de Crédito,
--              Banco Hipotecario. Solo INSERT — no se toca la tabla ni las 5 filas existentes.

BEGIN;

INSERT INTO public.planilla_bancos (tenant_id, nombre)
SELECT t.id, b.nombre
FROM public.tenants t
CROSS JOIN (VALUES ('Banco Azul'), ('Primer Banco'), ('Capital S.A. de C.V.'), ('Cajas de Crédito'), ('Banco Hipotecario')) AS b(nombre)
ON CONFLICT (tenant_id, nombre) DO NOTHING;

COMMIT;
