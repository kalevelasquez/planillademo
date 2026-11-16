-- Migration: Tabla de Empleados del módulo de Planilla (IMPL-1 / US-EMP-00, US-EMP-01, US-EMP-02)
-- Author: @alexis
-- Description: Entidad maestra de empleados para la épica Planilla. Cubre los campos de
--              perfil base (IMPL-3) y afiliación previsional (IMPL-4) aunque su UI se
--              construya en historias posteriores, para evitar ALTER TABLE repetidos.
--              Ver docs/product/planilla-contexto.md para el detalle de negocio (DRN §2, §2.2).

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_empleados (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

    -- Identidad
    codigo TEXT NOT NULL,

    -- Personales (DRN §2)
    nombre_completo TEXT NOT NULL,
    dui TEXT,
    nit TEXT,
    nup TEXT,
    fecha_nacimiento DATE,
    sexo TEXT CHECK (sexo IN ('M', 'F')),

    -- Contacto (DRN §2)
    telefono TEXT NOT NULL,
    correo TEXT,
    direccion TEXT,
    contacto_emergencia_nombre TEXT,
    contacto_emergencia_telefono TEXT,

    -- Cargo y empresa (DRN §2)
    cargo TEXT,
    departamento TEXT,
    sucursal TEXT,
    centro_costos TEXT,
    fecha_ingreso DATE NOT NULL,

    -- Remuneración y afiliación previsional (DRN §2, §2.1 — IMPL-4)
    sueldo_mensual NUMERIC(12, 2),
    tipo_afiliacion TEXT CHECK (tipo_afiliacion IN ('afp_crecer', 'afp_confia', 'upiss', 'jubilado')),
    retencion_especial_viatico BOOLEAN NOT NULL DEFAULT false, -- 🆕 DRN §9.3 "Bono con Renta 10%", hoy solo aplica a Gerente General

    -- Banco (DRN §2)
    banco TEXT,
    numero_cuenta TEXT,

    -- Estado
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
    tipo_contrato TEXT,
    foto_url TEXT,

    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    deleted_at TIMESTAMPTZ,

    UNIQUE (tenant_id, codigo)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_planilla_empleados_tenant_estado ON public.planilla_empleados(tenant_id, estado);
CREATE INDEX IF NOT EXISTS idx_planilla_empleados_tenant_ingreso ON public.planilla_empleados(tenant_id, fecha_ingreso);
CREATE INDEX IF NOT EXISTS idx_planilla_empleados_busqueda ON public.planilla_empleados USING gin (
    (nombre_completo || ' ' || COALESCE(cargo, '') || ' ' || COALESCE(departamento, '') || ' ' || codigo) gin_trgm_ops
);

-- RLS
ALTER TABLE public.planilla_empleados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_empleados_select_tenant"
    ON public.planilla_empleados FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_empleados_write_roles"
    ON public.planilla_empleados FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND (
            'admin' = ANY(public.get_auth_roles())
            OR 'preparador_planilla' = ANY(public.get_auth_roles())
        )
    );

CREATE POLICY "planilla_empleados_update_roles"
    ON public.planilla_empleados FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND (
            'admin' = ANY(public.get_auth_roles())
            OR 'preparador_planilla' = ANY(public.get_auth_roles())
        )
    );

CREATE POLICY "planilla_empleados_delete_admin"
    ON public.planilla_empleados FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND 'admin' = ANY(public.get_auth_roles())
    );

-- Auditoría automática (reusa fn_capture_audit, ya definida)
DROP TRIGGER IF EXISTS tr_audit_planilla_empleados ON public.planilla_empleados;
CREATE TRIGGER tr_audit_planilla_empleados
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_empleados
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

COMMIT;
