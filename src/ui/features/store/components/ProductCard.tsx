import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { StoreProduct } from '../../../../services/storeService';
import { ROUTES } from '../../../../config/storePaths';
import { formatPrice } from '../utils/storeFormat';
import { ProductImage } from './ProductImage';
import { AvailabilityBadge } from './AvailabilityBadge';

interface ProductCardProps {
    product: StoreProduct;
    /** Nivel del titulo segun el contexto de la pagina (h2 en catalogo, h3 en secciones de landing). */
    headingLevel?: 2 | 3;
}

/** Tarjeta de catalogo. Presentacional: el enlace cubre toda la tarjeta (stretched link). */
export const ProductCard: React.FC<ProductCardProps> = ({ product, headingLevel = 3 }) => {
    const { t } = useTranslation();
    const Heading = `h${headingLevel}` as 'h2' | 'h3';
    const soldOut = product.availability !== 'Disponible';

    return (
        <article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface-paper shadow-cards transition-shadow duration-200 hover:shadow-modals focus-within:ring-2 focus-within:ring-secondary">
            <div className={`overflow-hidden bg-surface ${soldOut ? 'opacity-70 grayscale-[40%]' : ''}`}>
                <ProductImage
                    src={product.imageUrl}
                    alt={product.name}
                    className="aspect-[4/3] w-full transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none"
                />
            </div>

            <div className="flex flex-1 flex-col gap-2 p-3 md:p-4">
                <Heading className="text-base leading-snug">
                    <Link
                        to={`${ROUTES.STORE}/p/${product.productKey}`}
                        className="text-heading outline-none after:absolute after:inset-0 after:content-['']"
                    >
                        {product.name}
                    </Link>
                </Heading>

                {(product.caliber || product.quality) && (
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
                        {product.caliber && <span>{t('store.catalog.caliber', { value: product.caliber })}</span>}
                        {product.quality && (
                            <span className="rounded-full bg-primary-light px-2 py-0.5 font-medium text-primary">
                                {product.quality}
                            </span>
                        )}
                    </p>
                )}

                <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                    <span className={`font-display text-lg font-bold ${soldOut ? 'text-text-secondary' : 'text-primary'}`}>
                        {formatPrice(product.price)}
                    </span>
                    <AvailabilityBadge availability={product.availability} />
                </div>
            </div>
        </article>
    );
};
