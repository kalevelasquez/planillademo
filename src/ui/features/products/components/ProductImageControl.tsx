import React, { useRef, useState } from 'react';
import { Camera, Trash2, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { productService } from '../../../../services/productService';
import type { ImageTarget } from '../../../../services/productService';
import { ProductImageError } from '../../../../services/storageService';
import { ProductImage } from '../../store/components/ProductImage';

interface ProductImageControlProps {
    product: ImageTarget & { image_url?: string | null };
    /** inventario.can_edit. Sin permiso solo se ve la miniatura, sin botones. */
    canEdit: boolean;
    /** Nueva URL pública, o null si se quitó la imagen. */
    onChange: (imageUrl: string | null) => void;
    /** Mensaje ya traducido para mostrar (toast). */
    onError: (message: string) => void;
}

/**
 * Miniatura + subir/reemplazar/quitar imagen de un producto (inventario).
 * La imagen aplica a todos los lotes del grupo (ver productService.setProductImage).
 */
export const ProductImageControl: React.FC<ProductImageControlProps> = ({ product, canEdit, onChange, onError }) => {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);

    const run = async (op: () => Promise<string | null>) => {
        setBusy(true);
        try {
            onChange(await op());
        } catch (err) {
            onError(t(err instanceof ProductImageError ? err.i18nKey : 'inventory.image.uploadError'));
        } finally {
            setBusy(false);
        }
    };

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        void run(() => productService.setProductImage(product, file));
    };

    const handleRemove = () => run(async () => {
        await productService.removeProductImage(product);
        return null;
    });

    return (
        <div className="flex items-center gap-2 shrink-0">
            <ProductImage src={product.image_url} alt={product.name} className="w-10 h-10 rounded-md" />
            {canEdit && (
                <>
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        data-testid="product-image-input"
                        onChange={handleFile}
                    />
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => inputRef.current?.click()}
                        className="p-1.5 rounded-full bg-surface text-text-secondary hover:text-primary hover:bg-primary/10 border border-border transition-colors disabled:opacity-50"
                        title={t('inventory.image.label')}
                        aria-label={t('inventory.image.label')}
                    >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                    </button>
                    {product.image_url && (
                        <button
                            type="button"
                            data-testid="product-image-remove"
                            disabled={busy}
                            onClick={handleRemove}
                            className="p-1.5 rounded-full bg-surface text-text-secondary hover:text-error hover:bg-error/10 border border-border transition-colors disabled:opacity-50"
                            title={t('inventory.image.remove')}
                            aria-label={t('inventory.image.remove')}
                        >
                            <Trash2 size={14} />
                        </button>
                    )}
                </>
            )}
        </div>
    );
};
