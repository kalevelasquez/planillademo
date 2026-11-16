-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260303160000_storage_update_policy
-- Purpose  : Permitir a usuarios autenticados SOBREESCRIBIR (UPDATE) archivos
--            en el bucket pedidos_publicos.
--
-- Contexto : La política existente solo cubría INSERT. Cuando se regenera un PDF
--            del mismo pedido, el upsert=true del cliente fallaba con:
--            "new row violates row-level security policy"
--            porque UPDATE no estaba autorizado a nivel de storage.objects.
-- ─────────────────────────────────────────────────────────────────────────────

-- Evitar error si la política ya existe en el entorno
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename  = 'objects'
          AND policyname = 'Permitir update Auth'
    ) THEN
        EXECUTE $policy$
            CREATE POLICY "Permitir update Auth"
            ON storage.objects FOR UPDATE
            TO authenticated
            USING   (bucket_id = 'pedidos_publicos')
            WITH CHECK (bucket_id = 'pedidos_publicos');
        $policy$;
    END IF;
END;
$$;
