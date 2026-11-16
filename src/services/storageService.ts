/**
 * storageService.ts
 * ─────────────────────────────────────────────────────────────────
 * Gestión de archivos en Supabase Storage.
 * Bucket: pedidos_publicos (público, solo PDFs)
 */

import { supabase } from './authService';

const BUCKET = 'pedidos_publicos';

export const storageService = {
    /**
     * Construye la URL pública de un archivo sin hacer ninguna petición.
     * Útil para obtener el link esperado antes de confirmar si existe.
     *
     * @param fileName  Nombre del archivo, ej. "folio_PED-20260303-1234.pdf"
     * @returns         URL pública del archivo en el bucket
     */
    getOrderPDFPublicUrl(fileName: string): string {
        const { data } = supabase.storage
            .from(BUCKET)
            .getPublicUrl(fileName);
        return data.publicUrl;
    },

    /**
     * Sube un Blob PDF al bucket pedidos_publicos con upsert (idempotente).
     * Si el archivo ya existe, lo sobreescribe.
     *
     * @param blob      Blob del PDF generado en el cliente
     * @param fileName  Nombre del archivo, ej. "folio_PED-20260303-1234.pdf"
     * @returns         URL pública del archivo subido
     * @throws          Error si la subida falla
     */
    async uploadOrderPDF(blob: Blob, fileName: string): Promise<string> {
        const { error } = await supabase.storage
            .from(BUCKET)
            .upload(fileName, blob, {
                contentType: 'application/pdf',
                upsert: true,       // idempotente: sobreescribe si ya existe
                cacheControl: '3600',
            });

        if (error) {
            throw new Error(`Error al subir PDF a Storage: ${error.message}`);
        }

        return this.getOrderPDFPublicUrl(fileName);
    },
};
