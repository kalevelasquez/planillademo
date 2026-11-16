-- Migration: Descuentos — catálogo de categorías + cabecera (IMPL-56 / US-DESC-01, IMPL-58)
-- Author: @alexis
-- Description: `planilla_descuento_categorias` es el catálogo configurable que pide CA3 (mismo
--              patrón que tendría Bonificaciones/Otros Ingresos, IMPL-71 — esa épica no existe
--              todavía, así que este catálogo se construye de cero, no se reutiliza nada).
--
--              `planilla_descuentos`: "tipo" (fijo/variable) es solo una CLASIFICACIÓN heredada
--              de la categoría elegida, no una diferencia estructural — CA2 de US-DESC-01 dice
--              que CUALQUIER descuento puede independientemente tener monto_total+numero_cuotas
--              (finito, auto-finaliza) o quedar indefinido, sin importar si es Fijo o Variable.
--              Esto es deliberadamente distinto del mock del DEMO (que modela "Variable" como un
--              cargo único ad-hoc) porque CA1 de US-ANT-04-análogo (US-DESC-02, suspender por
--              quincena) exige que la suspensión aplique "para cualquier descuento, Fijo o
--              Variable, indefinido o con cuotas" — eso solo tiene sentido si TODO descuento es
--              recurrente quincena a quincena (se procesa/suspende quincena por quincena), igual
--              que Anticipos.
--
--              `estado` admite 'activo'/'pausado'/'completado' — 'pausado' es un toggle MANUAL
--              permanente (US-DESC-01 CA4, "switch Activo/Pausado" en el perfil), distinto de
--              "suspendido" (US-DESC-02, una quincena puntual, sin tocar el saldo) que — igual
--              que Anticipos — NO se persiste acá, se deriva de la tabla de eventos (IMPL-59).
--
--              `validado_at` (US-DESC-05/IMPL-62): null hasta que el Preparador confirme el
--              registro antes de su primera aplicación real — la propia tabla no fuerza nada
--              todavía, la UI/RPC de "procesar cuotas" (IMPL-59/61) es quien deberá chequearlo.
--
--              `cuotas_pagadas` (contador, no solo monto_pagado): necesario para el badge
--              "Penúltima cuota" (US-DESC-03/IMPL-60) — dividir monto_pagado/monto_quincenal
--              sería frágil ante redondeos, un contador explícito incrementado junto con el pago
--              es más confiable.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_descuento_categorias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('fijo', 'variable')),
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id, nombre)
);

ALTER TABLE public.planilla_descuento_categorias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_descuento_categorias_select_tenant"
    ON public.planilla_descuento_categorias FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

-- Mismo criterio que planilla_tarifas_km_cargo: catálogo de configuración, solo admin escribe.
CREATE POLICY "planilla_descuento_categorias_insert_admin"
    ON public.planilla_descuento_categorias FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_descuento_categorias_update_admin"
    ON public.planilla_descuento_categorias FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_descuento_categorias ON public.planilla_descuento_categorias;
CREATE TRIGGER tr_audit_planilla_descuento_categorias
    AFTER INSERT OR UPDATE ON public.planilla_descuento_categorias
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- Semilla inicial (CA3): mismos ejemplos que el mock del DEMO, editable después desde la UI.
INSERT INTO public.planilla_descuento_categorias (tenant_id, nombre, tipo)
SELECT t.id, v.nombre, v.tipo
FROM public.tenants t
CROSS JOIN (VALUES
    ('Préstamo bancario', 'fijo'), ('Financiera', 'fijo'), ('Vivienda', 'fijo'), ('Vehículo', 'fijo'),
    ('Faltante de caja', 'variable'), ('Factura de producto', 'variable'),
    ('Permiso sin goce', 'variable'), ('Uniforme', 'variable'), ('Lentes', 'variable')
) AS v(nombre, tipo)
ON CONFLICT (tenant_id, nombre) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.planilla_descuentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id),
    categoria_id UUID NOT NULL REFERENCES public.planilla_descuento_categorias(id),
    institucion TEXT,
    monto_quincenal NUMERIC NOT NULL CHECK (monto_quincenal > 0),
    monto_total NUMERIC CHECK (monto_total IS NULL OR monto_total > 0),
    numero_cuotas INT CHECK (numero_cuotas IS NULL OR numero_cuotas > 0),
    monto_pagado NUMERIC NOT NULL DEFAULT 0 CHECK (monto_pagado >= 0),
    cuotas_pagadas INT NOT NULL DEFAULT 0 CHECK (cuotas_pagadas >= 0),
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'pausado', 'completado')),
    validado_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CHECK ((monto_total IS NULL) = (numero_cuotas IS NULL)),
    CHECK (monto_total IS NULL OR monto_pagado <= monto_total)
);

CREATE INDEX IF NOT EXISTS idx_planilla_descuentos_empleado ON public.planilla_descuentos(empleado_id);
CREATE INDEX IF NOT EXISTS idx_planilla_descuentos_estado ON public.planilla_descuentos(estado);

ALTER TABLE public.planilla_descuentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_descuentos_select_tenant"
    ON public.planilla_descuentos FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

-- Sin gate de "quincena en_proceso" (mismo criterio que planilla_anticipos): un descuento vive
-- across-quincenas, no se crea/edita dentro de una sola.
CREATE POLICY "planilla_descuentos_insert_rol"
    ON public.planilla_descuentos FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_descuentos_update_rol"
    ON public.planilla_descuentos FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_descuentos ON public.planilla_descuentos;
CREATE TRIGGER tr_audit_planilla_descuentos
    AFTER INSERT OR UPDATE ON public.planilla_descuentos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- Sin SECURITY DEFINER (mismo criterio que crear_anticipo): corre como INVOKER, la policy de
-- INSERT de arriba es la que autoriza. Si monto_total/numero_cuotas vienen definidos,
-- monto_quincenal se recalcula server-side (single source of truth, no lo decide el cliente).
CREATE OR REPLACE FUNCTION public.crear_descuento(
    p_empleado_id UUID,
    p_categoria_id UUID,
    p_institucion TEXT,
    p_monto_quincenal NUMERIC,
    p_monto_total NUMERIC,
    p_numero_cuotas INT,
    p_user_id UUID
) RETURNS public.planilla_descuentos
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.planilla_descuentos;
    v_monto_quincenal NUMERIC;
BEGIN
    v_monto_quincenal := CASE
        WHEN p_monto_total IS NOT NULL AND p_numero_cuotas IS NOT NULL
            THEN ROUND(p_monto_total / p_numero_cuotas, 2)
        ELSE p_monto_quincenal
    END;

    INSERT INTO public.planilla_descuentos (
        tenant_id, empleado_id, categoria_id, institucion, monto_quincenal,
        monto_total, numero_cuotas, created_by
    ) VALUES (
        public.get_auth_tenant_id(), p_empleado_id, p_categoria_id, p_institucion, v_monto_quincenal,
        p_monto_total, p_numero_cuotas, p_user_id
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

COMMIT;
