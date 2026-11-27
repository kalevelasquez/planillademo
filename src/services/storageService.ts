/**
 * storageService.ts
 * ─────────────────────────────────────────────────────────────────
 * Gestión de archivos en Supabase Storage.
 * Bucket: pedidos_publicos (público, solo PDFs)
 */

import { supabase } from './authService';

const BUCKET = 'pedidos_publicos';

// ── Imágenes de producto (bucket público `product_images`, ver migración 20261128090000) ──
const PRODUCT_IMAGE_BUCKET = 'product_images';
export const PRODUCT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const EXT_BY_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export type ProductImageErrorKey =
    | 'inventory.image.invalidType'
    | 'inventory.image.tooLarge'
    | 'inventory.image.uploadError';

/** Error de imagen con clave i18n: la UI traduce `i18nKey`, nunca muestra `message`. */
export class ProductImageError extends Error {
    readonly i18nKey: ProductImageErrorKey;

    constructor(i18nKey: ProductImageErrorKey, detail?: string) {
        super(detail ?? i18nKey);
        this.i18nKey = i18nKey;
        this.name = 'ProductImageError';
    }
}

/** Valida tipo y tamaño en cliente. Devuelve la clave i18n del error o null si es válido. */
export function validateProductImage(file: File): ProductImageErrorKey | null {
    if (!(PRODUCT_IMAGE_TYPES as readonly string[]).includes(file.type)) return 'inventory.image.invalidType';
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) return 'inventory.image.tooLarge';
    return null;
}

export const storageService = {
    /**
     * Sube la imagen de un producto a `{tenantId}/{productId}-{timestamp}.{ext}`.
     * La carpeta del tenant es obligatoria: las policies de storage la exigen.
     * El timestamp hace la URL única por subida (cache busting: el bucket es público y
     * el CDN la cachea), por eso se puede servir con cache largo/inmutable y upsert=false.
     */
    async uploadProductImage(
        tenantId: string,
        productId: string,
        file: File,
    ): Promise<{ path: string; publicUrl: string }> {
        const invalid = validateProductImage(file);
        if (invalid) throw new ProductImageError(invalid);

        const path = `${tenantId}/${productId}-${Date.now()}.${EXT_BY_MIME[file.type]}`;
        const { error } = await supabase.storage
            .from(PRODUCT_IMAGE_BUCKET)
            .upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
        if (error) throw new ProductImageError('inventory.image.uploadError', error.message);

        const { data } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);
        return { path, publicUrl: data.publicUrl };
    },

    /** Ruta del objeto dentro del bucket a partir de su URL pública (null si no es de este bucket). */
    productImagePathFromUrl(url: string | null | undefined): string | null {
        if (!url) return null;
        const marker = `/${PRODUCT_IMAGE_BUCKET}/`;
        const i = url.indexOf(marker);
        if (i === -1) return null;
        const path = url.slice(i + marker.length).split('?')[0];
        return path || null;
    },

    /** Borra objetos del bucket por URL pública. Ignora URLs ajenas al bucket. */
    async removeProductImagesByUrl(urls: string[]): Promise<void> {
        const paths = urls
            .map(u => this.productImagePathFromUrl(u))
            .filter((p): p is string => Boolean(p));
        if (paths.length === 0) return;
        await this.removeProductImagePaths(paths);
    },

    async removeProductImagePaths(paths: string[]): Promise<void> {
        const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove(paths);
        if (error) throw new Error(error.message);
    },

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
