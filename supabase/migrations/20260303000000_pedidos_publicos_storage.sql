-- ============================================================
-- Migración: Bucket de Storage para PDFs de Pedidos
-- ============================================================
-- Crea el bucket `pedidos_publicos` y configura las políticas
-- RLS necesarias para el flujo de generación y envío de PDFs.
-- ============================================================

-- 1. Crear bucket (idempotente con ON CONFLICT DO NOTHING)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'pedidos_publicos',
    'pedidos_publicos',
    true,                       -- público: URLs sin token de acceso
    5242880,                    -- 5 MB límite por archivo
    ARRAY['application/pdf']    -- solo PDFs permitidos
)
ON CONFLICT (id) DO NOTHING;

-- 2. Política: solo usuarios autenticados pueden subir archivos (INSERT)
CREATE POLICY "Autenticados pueden subir PDFs"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'pedidos_publicos');

-- 3. Política: lectura pública para anon y authenticated (SELECT)
--    Necesario para que el link del PDF en WhatsApp sea accesible
--    sin que el cliente tenga sesión activa.
CREATE POLICY "Lectura publica de PDFs de pedidos"
    ON storage.objects
    FOR SELECT
    TO public
    USING (bucket_id = 'pedidos_publicos');
