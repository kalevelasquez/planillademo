-- Migration: Catálogo de Ubicaciones y Modalidad de Captura (IMPL-20 / US-HEX-00)
-- Author: @alexis
-- Description: Lista PLANA (no jerárquica, CA1) de ubicaciones — Planta y cada sucursal al
--              mismo nivel — cada una con su propia modalidad de captura (CA2: 'reloj_marcador'
--              o 'manual'), independiente por ubicación. Sin límite fijo de filas (CA4). Se
--              desactiva en vez de borrar (`estado`) porque futuras historias de esta épica
--              (importación, carga manual) van a generar datos que referencian una ubicación
--              — borrarla huérfano esos registros. Historia "Como administrador": solo admin
--              gestiona (INSERT/UPDATE), todo el tenant puede leer (las tabs de Horas Extras,
--              CA3, las necesitan visibles para Preparador también).

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_ubicaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    modalidad_captura TEXT NOT NULL CHECK (modalidad_captura IN ('reloj_marcador', 'manual')),
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (tenant_id, nombre)
);

ALTER TABLE public.planilla_ubicaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_ubicaciones_select_tenant"
    ON public.planilla_ubicaciones FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_ubicaciones_insert_admin"
    ON public.planilla_ubicaciones FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

CREATE POLICY "planilla_ubicaciones_update_admin"
    ON public.planilla_ubicaciones FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()))
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND 'admin' = ANY(public.get_auth_roles()));

DROP TRIGGER IF EXISTS tr_audit_planilla_ubicaciones ON public.planilla_ubicaciones;
CREATE TRIGGER tr_audit_planilla_ubicaciones
    AFTER INSERT OR UPDATE ON public.planilla_ubicaciones
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- Seed puntual: la Planta y las 4 sucursales que menciona explícitamente el CA1, para los
-- tenants existentes. Modalidad inicial 'manual' para todas — el admin la ajusta desde la UI
-- según qué ubicación realmente tiene reloj marcador (ese dato no está confirmado por
-- ubicación en el DRN, ver gap). A propósito NO se engancha a fn_on_tenant_created: estos
-- nombres son la estructura organizativa real de Imporfrut, no un catálogo genérico — un
-- tenant nuevo (otra empresa) no debería heredar "Sucursal Norte" como si fuera suya.
DO $$
DECLARE
    t_id UUID;
    nombres CONSTANT TEXT[] := ARRAY['Planta', 'Sucursal Central', 'Sucursal Norte', 'Sucursal Sur', 'Sucursal Oriente'];
BEGIN
    FOR t_id IN SELECT id FROM public.tenants LOOP
        FOR i IN 1..array_length(nombres, 1) LOOP
            INSERT INTO public.planilla_ubicaciones (tenant_id, nombre, modalidad_captura)
            VALUES (t_id, nombres[i], 'manual')
            ON CONFLICT (tenant_id, nombre) DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

COMMIT;
