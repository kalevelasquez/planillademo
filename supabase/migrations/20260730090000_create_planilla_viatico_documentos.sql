-- Migration: Adjuntar Comprobantes al Registro de Viático (IMPL-30 / US-VIA-08)
-- Author: @alexis
-- Description: Mecanismo único de adjuntos para los 3 tipos de registro de viático (Por
--              Ruta, Fijos y Variables, Por Kilometraje) — CA2: "todo registro de viático...
--              tiene una opción Adjuntar archivo". `registro_id` es intencionalmente
--              polimórfico (sin FK) porque apunta a una de 3 tablas distintas según
--              `tipo_registro`; la integridad referencial entre `registro_id` y su tabla real
--              NO se valida a nivel de base de datos (ver gap en planilla-contexto.md). Mismo
--              patrón que `planilla_empleado_documentos` (bucket privado + signed URL + RLS
--              por tenant en storage.objects). `origen` distingue el adjunto automático de
--              una captura por IA (CA1, US-VIA-00/IMPL-31, todavía no existe) del adjunto
--              manual (CA2/CA3). CA4 (Kilometraje migra su "Imagen de respaldo" a este
--              mecanismo) se resuelve en la UI, no en el esquema — Kilometraje nunca tuvo una
--              columna de imagen propia que migrar (IMPL-37 ya dejó ese campo como
--              placeholder).

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'planilla_viatico_documentos',
    'planilla_viatico_documentos',
    false,
    10485760,
    ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.planilla_viatico_documentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    tipo_registro TEXT NOT NULL CHECK (tipo_registro IN ('por_ruta', 'fijos_variables', 'kilometraje')),
    registro_id UUID NOT NULL,
    storage_path TEXT NOT NULL,
    nombre_archivo TEXT NOT NULL,
    tamano_bytes BIGINT,
    mime_type TEXT,
    origen TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'captura_ia')),
    uploaded_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planilla_viatico_documentos_registro ON public.planilla_viatico_documentos(tipo_registro, registro_id, created_at DESC);

ALTER TABLE public.planilla_viatico_documentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_viatico_documentos_select_tenant"
    ON public.planilla_viatico_documentos FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_viatico_documentos_insert_tenant"
    ON public.planilla_viatico_documentos FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_viatico_documentos_delete_tenant"
    ON public.planilla_viatico_documentos FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_viatico_documentos ON public.planilla_viatico_documentos;
CREATE TRIGGER tr_audit_planilla_viatico_documentos
    AFTER INSERT OR DELETE ON public.planilla_viatico_documentos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- Storage RLS: mismo criterio que planilla_empleado_documentos — el primer segmento del path
-- ({tenant_id}/{tipo_registro}/{registro_id}/{uuid}_{nombre}) debe coincidir con el tenant del
-- usuario autenticado.
CREATE POLICY "planilla_viatico_documentos_storage_insert"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'planilla_viatico_documentos'
        AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

CREATE POLICY "planilla_viatico_documentos_storage_select"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'planilla_viatico_documentos'
        AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
    );

CREATE POLICY "planilla_viatico_documentos_storage_delete"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'planilla_viatico_documentos'
        AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

COMMIT;
