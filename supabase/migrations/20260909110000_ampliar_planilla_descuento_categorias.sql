-- Migration: Ampliar categorías de Descuento con las columnas "Diversos" reales (IMPL-167 CA2)
-- Author: @alexis
-- Description: el Excel real de Descuentos (ver migración hermana 20260909100000) tiene 6
--              columnas bajo "Diversos" que hoy no existen como categoría en
--              planilla_descuento_categorias: Calzado y Uniformes, Procuraduría, Anticipos,
--              Descuento compra producto, Reintegro de viaje, Descuento genérico (catch-all —
--              ver src/utils/descuentosPivotUtils.ts). No se toca/renombra la categoría
--              "Uniforme" ya sembrada (20260805090000): ya está referenciada por FK desde
--              descuentos existentes, y el pivote la mapea igual hacia "Descuento genérico" por
--              nombre, sin necesidad de fusionarla.

BEGIN;

INSERT INTO public.planilla_descuento_categorias (tenant_id, nombre, tipo)
SELECT t.id, v.nombre, v.tipo
FROM public.tenants t
CROSS JOIN (VALUES
    ('Calzado y Uniformes', 'variable'), ('Procuraduría', 'variable'), ('Anticipos', 'variable'),
    ('Descuento compra producto', 'variable'), ('Reintegro de viaje', 'variable'), ('Descuento genérico', 'variable')
) AS v(nombre, tipo)
ON CONFLICT (tenant_id, nombre) DO NOTHING;

COMMIT;
