-- Migration: Reforzar aislamiento por tenant en el bucket inventory_documents
-- Author: @alexis
-- Description: Encontrado durante la revisión épica por épica de Planilla (IMPL-6 gap
--              #4): la policy vigente de `inventory_documents` (creada en
--              20260319100000_fix_production_rls_denied.sql) solo exige que el usuario
--              TENGA algún tenant asignado (`get_auth_tenant_id() IS NOT NULL`), sin
--              comparar el path contra su tenant real — a diferencia de
--              `planilla_empleado_documentos` (20260717100000), que sí lo hace.
--
--              Verificado antes de este cambio que es seguro: el único punto de subida a
--              este bucket (`useInventoryImport.ts`) ya arma el path como
--              `{tenant_id}/{timestamp}_{nombre_archivo}` — el primer segmento YA es el
--              tenant_id real — y no existe ningún getPublicUrl/createSignedUrl/list en
--              el cliente que dependa de otra estructura. Reforzar acá es aditivo, no
--              debería romper el flujo existente.
--
--              Se mantiene el mismo nivel de permiso que ya existía (cualquier usuario
--              autenticado con tenant, FOR ALL) — solo se agrega la comparación de path.
--              No se agregan restricciones de rol nuevas, que estarían fuera del alcance
--              de esta revisión (Inventario/Productos no es la épica en revisión).

BEGIN;

DROP POLICY IF EXISTS "inventory_documents_storage_shield" ON storage.objects;

CREATE POLICY "inventory_documents_storage_shield"
    ON storage.objects FOR ALL TO authenticated
    USING (
        bucket_id = 'inventory_documents'
        AND public.get_auth_tenant_id() IS NOT NULL
        AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
    )
    WITH CHECK (
        bucket_id = 'inventory_documents'
        AND public.get_auth_tenant_id() IS NOT NULL
        AND (storage.foldername(name))[1] = public.get_auth_tenant_id()::text
    );

COMMIT;
