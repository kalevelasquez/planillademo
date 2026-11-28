import React, { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface ProductImageProps {
    /** URL pública de la imagen (products.image_url). NULL/vacío => placeholder. */
    src?: string | null;
    alt: string;
    className?: string;
}

/**
 * Imagen de producto con placeholder (spec Product Images: "Producto sin imagen").
 * Presentacional: sin estado de negocio. Si la imagen falla al cargar, cae al placeholder.
 */
export const ProductImage: React.FC<ProductImageProps> = ({ src, alt, className = '' }) => {
    // Se recuerda QUE url fallo (no un booleano): al cambiar `src` vuelve a intentarse sin efecto ni setState.
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const url = src?.trim() || '';

    if (!url || failedUrl === url) {
        return (
            <div
                data-testid="product-image-placeholder"
                title={alt}
                className={`flex items-center justify-center bg-surface text-text-secondary border border-border ${className}`}
            >
                <ImageOff size={20} aria-hidden="true" />
            </div>
        );
    }

    return (
        <img
            src={url}
            alt={alt}
            loading="lazy"
            decoding="async"
            onError={() => setFailedUrl(url)}
            className={`object-cover ${className}`}
        />
    );
};
