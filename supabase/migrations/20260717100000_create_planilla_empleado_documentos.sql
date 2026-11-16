-- Migration: Documentos Adjuntos del Empleado (IMPL-6 / US-EMP-04)
-- Author: @alexis
-- Description: Bucket privado de Storage + tabla de metadatos para adjuntos del perfil
--              de empleado (DUI, carné AFP, carné ISSS, incapacidades, amonestaciones,
--              constancias, liquidaciones — CA1). A diferencia del bucket existente
--              'inventory_documents' (cuyas políticas de storage.objects no aíslan
--              realmente por tenant, solo exigen que el usuario TENGA un tenant), acá
--              reforzamos el aislamiento comparando el primer segmento del path contra
--              get_auth_tenant_id(), porque estos documentos son datos personales
--              sensibles de empleados.

BEGIN;

-- ============================================================
-- 1. BUCKET
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'planilla_empleado_documentos',
    'planilla_empleado_documentos',
    false,                                                          -- privado: requiere signed URL
    10485760,                                                       -- 10 MB (mismo límite usado en Viáticos/Anticipos)
    ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

-- Path esperado: {tenant_id}/{empleado_id}/{uuid}_{nombre_archivo}
CREATE POLICY "planilla_documentos_storage_insert"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'planilla_empleado_documentos'
        AND auth.role() = 'authenticated'
        AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_documentos_storage_select"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'planilla_empleado_documentos'
        AND auth.role() = 'authenticated'
        AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
    );

CREATE POLICY "planilla_documentos_storage_delete"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'planilla_empleado_documentos'
        AND auth.role() = 'authenticated'
        AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

-- ============================================================
-- 2. TABLA DE METADATOS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.planilla_empleado_documentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('dui', 'afp', 'isss', 'incapacidad', 'amonestacion', 'constancia', 'liquidacion')),
    storage_path TEXT NOT NULL,
    nombre_archivo TEXT NOT NULL,
    tamano_bytes BIGINT,
    mime_type TEXT,
    origen TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'anticipo')), -- 'anticipo' reservado para IMPL-48 (CA2), no usado todavía
    uploaded_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planilla_documentos_empleado ON public.planilla_empleado_documentos(empleado_id, created_at DESC);

ALTER TABLE public.planilla_empleado_documentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_documentos_select_tenant"
    ON public.planilla_empleado_documentos FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_documentos_insert_roles"
    ON public.planilla_empleado_documentos FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_documentos_delete_roles"
    ON public.planilla_empleado_documentos FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_empleado_documentos ON public.planilla_empleado_documentos;
CREATE TRIGGER tr_audit_planilla_empleado_documentos
    AFTER INSERT OR DELETE ON public.planilla_empleado_documentos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

COMMIT;
