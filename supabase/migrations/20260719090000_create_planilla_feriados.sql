-- Migration: Catálogos de Feriados y Días Exentos de Penalización (IMPL-9 / US-QNA-05)
-- Author: @alexis
-- Description: Dos catálogos INDEPENDIENTES (CA4 — una fecha puede estar en ninguno, uno
--              o ambos): feriados nacionales (recargo +100% si se trabaja) y días exentos
--              de penalización por salida anticipada (no se calcula descuento por "corto",
--              sin recargo de feriado). El 24 y 31 de diciembre van en el segundo catálogo,
--              no en el de feriados (CA3). Historia "Como administrador" — solo admin
--              gestiona (INSERT/DELETE), todo el tenant puede leer.
--
--              CA5 (que Horas Extras consulte este catálogo al validar la importación del
--              reloj) no se implementa acá — el módulo de Horas Extras (IMPL-20) no existe
--              todavía. Queda como integración pendiente para esa épica.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_feriados (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    nombre TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id, fecha)
);

CREATE TABLE IF NOT EXISTS public.planilla_dias_exentos_penalizacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    nota TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id, fecha)
);

ALTER TABLE public.planilla_feriados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planilla_dias_exentos_penalizacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_feriados_select_tenant"
    ON public.planilla_feriados FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_feriados_write_admin"
    ON public.planilla_feriados FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_feriados_delete_admin"
    ON public.planilla_feriados FOR DELETE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_dias_exentos_select_tenant"
    ON public.planilla_dias_exentos_penalizacion FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_dias_exentos_write_admin"
    ON public.planilla_dias_exentos_penalizacion FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_dias_exentos_delete_admin"
    ON public.planilla_dias_exentos_penalizacion FOR DELETE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_feriados ON public.planilla_feriados;
CREATE TRIGGER tr_audit_planilla_feriados
    AFTER INSERT OR DELETE ON public.planilla_feriados
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

DROP TRIGGER IF EXISTS tr_audit_planilla_dias_exentos ON public.planilla_dias_exentos_penalizacion;
CREATE TRIGGER tr_audit_planilla_dias_exentos
    AFTER INSERT OR DELETE ON public.planilla_dias_exentos_penalizacion
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- ============================================================
-- Seed puntual de feriados nacionales 2026 (confirmados en el DRN §3.2) para tenants
-- existentes. Es un backfill de una sola vez para este año calendario específico, NO se
-- engancha a fn_on_tenant_created (un tenant creado en 2027 no debería heredar fechas de
-- 2026) — tenants nuevos usan "Copiar calendario del año anterior" o carga manual.
-- ============================================================
DO $$
DECLARE
    t_id UUID;
    feriados_2026 CONSTANT DATE[] := ARRAY[
        '2026-01-01', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-10',
        '2026-06-17', '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04',
        '2026-08-05', '2026-08-06', '2026-09-15', '2026-11-02', '2026-12-25'
    ];
    nombres_2026 CONSTANT TEXT[] := ARRAY[
        'Año Nuevo', 'Jueves Santo', 'Viernes Santo', 'Día del Trabajo', 'Día de la Madre',
        'Día del Padre', 'Fiestas Agostinas', 'Fiestas Agostinas', 'Fiestas Agostinas', 'Fiestas Agostinas',
        'Fiestas Agostinas', 'Fiestas Agostinas', 'Independencia Patria', 'Día de los Difuntos', 'Navidad'
    ];
BEGIN
    FOR t_id IN SELECT id FROM public.tenants LOOP
        FOR i IN 1..array_length(feriados_2026, 1) LOOP
            INSERT INTO public.planilla_feriados (tenant_id, fecha, nombre)
            VALUES (t_id, feriados_2026[i], nombres_2026[i])
            ON CONFLICT (tenant_id, fecha) DO NOTHING;
        END LOOP;

        -- Días exentos de penalización confirmados (24 y 31 de diciembre — CA3)
        INSERT INTO public.planilla_dias_exentos_penalizacion (tenant_id, fecha, nota)
        VALUES
            (t_id, '2026-12-24', 'Nochebuena — jornada reducida, sin descuento por "corto"'),
            (t_id, '2026-12-31', 'Fin de año — jornada reducida, sin descuento por "corto"')
        ON CONFLICT (tenant_id, fecha) DO NOTHING;
    END LOOP;
END $$;

COMMIT;
