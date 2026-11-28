import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { ROUTES } from '../../../../config/storePaths';
import { useCartStore } from '../../../../store/cartStore';
import type { StoreProduct } from '../../../../services/storeService';
import { useProduct } from '../hooks/useProduct';
import { formatPrice } from '../utils/storeFormat';
import { ProductImage } from '../components/ProductImage';
import { AvailabilityBadge } from '../components/AvailabilityBadge';
import { StoreNotice } from '../components/StoreNotice';
import { QuantityStepper } from '../components/QuantityStepper';
import { SECONDARY_LINK_BTN } from '../utils/storeStyles';

const BACK_LINK =
    'inline-flex items-center gap-2 rounded-full font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary';

const ORDER_BTN =
    'inline-flex h-12 items-center rounded-full bg-primary px-lg font-display font-bold text-white transition-colors hover:bg-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-50';

/** Cantidad + 'Pedir' (agrega al carrito local). Agotado no se puede pedir. */
const OrderControls: React.FC<{ product: StoreProduct }> = ({ product }) => {
    const { t } = useTranslation();
    const add = useCartStore((s) => s.add);
    const [qty, setQty] = useState(1);
    const [feedback, setFeedback] = useState<'added' | 'limit' | null>(null);

    if (product.availability !== 'Disponible') {
        return (
            <button type='button' disabled className={ORDER_BTN}>
                {t('store.catalog.unavailableAction')}
            </button>
        );
    }

    const handleOrder = () => {
        const result = add(product, qty);
        setFeedback(result === 'added' ? 'added' : result === 'limit' ? 'limit' : null);
    };

    return (
        <div className='flex flex-col items-start gap-sm'>
            <div className='flex flex-wrap items-center gap-md'>
                <QuantityStepper name={product.name} value={qty} onChange={setQty} />
                <button type='button' onClick={handleOrder} className={ORDER_BTN}>
                    {t('store.catalog.order')}
                </button>
            </div>
            {feedback === 'added' && (
                <p role='status' className='flex flex-wrap items-center gap-sm font-medium text-success-dark'>
                    {t('store.catalog.added')}
                    <Link to={`${ROUTES.STORE}/carrito`} className={SECONDARY_LINK_BTN}>
                        {t('store.catalog.viewCart')}
                    </Link>
                </p>
            )}
            {feedback === 'limit' && (
                <p role='alert' className='text-sm font-medium text-error-dark'>
                    {t('store.catalog.cartFull')}
                </p>
            )}
        </div>
    );
};

/** `/tienda/p/:productKey`: detalle de un grupo del catalogo y alta al carrito. */
const ProductDetailPage: React.FC = () => {
    const { t } = useTranslation();
    const { productKey = '' } = useParams();
    const { status, product, reload } = useProduct(productKey);

    const back = (
        <Link to={ROUTES.STORE} className={BACK_LINK}>
            <ArrowLeft size={16} aria-hidden="true" />
            {t('store.catalog.back')}
        </Link>
    );

    return (
        <div className="mx-auto w-full max-w-[72rem] px-md py-8 md:px-lg md:py-12">
            <div className="mb-lg">{back}</div>

            {status === 'loading' && (
                <div role="status">
                    <span className="sr-only">{t('store.catalog.loading')}</span>
                    <div aria-hidden="true" className="grid gap-lg md:grid-cols-2">
                        <div className="aspect-square animate-pulse rounded-lg bg-surface-hover" />
                        <div className="h-[16rem] animate-pulse rounded-lg bg-surface-hover" />
                    </div>
                </div>
            )}

            {status === 'notFound' && (
                <StoreNotice title={t('store.catalog.notFoundTitle')} message={t('store.errors.product_unavailable')} />
            )}

            {status === 'unavailable' && (
                <StoreNotice title={t('store.catalog.unavailableTitle')} message={t('store.errors.store_unavailable')} />
            )}

            {status === 'error' && (
                <StoreNotice tone="error" message={t('store.errors.generic')}>
                    <button
                        type="button"
                        onClick={reload}
                        className="mt-sm inline-flex h-11 items-center rounded-full bg-primary px-lg font-semibold text-white hover:bg-primary-dark"
                    >
                        {t('store.catalog.retry')}
                    </button>
                </StoreNotice>
            )}

            {status === 'ready' && product && (
                <article className="grid gap-lg md:grid-cols-2 md:gap-xl">
                    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-cards">
                        <ProductImage src={product.imageUrl} alt={product.name} className="aspect-square w-full" />
                    </div>

                    <div className="flex flex-col items-start gap-md">
                        <h1 className="font-display text-3xl md:text-4xl">{product.name}</h1>

                        {(product.caliber || product.quality) && (
                            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-text-secondary">
                                {product.caliber && <span>{t('store.catalog.caliber', { value: product.caliber })}</span>}
                                {product.quality && (
                                    <span className="rounded-full bg-primary-light px-3 py-0.5 text-sm font-medium text-primary">
                                        {product.quality}
                                    </span>
                                )}
                            </p>
                        )}

                        <div className="flex flex-wrap items-center gap-md">
                            <span className="font-display text-3xl font-bold text-primary">{formatPrice(product.price)}</span>
                            <AvailabilityBadge availability={product.availability} />
                        </div>

                        <p className="text-sm text-text-secondary">{t('store.catalog.priceNote')}</p>

                        <OrderControls key={product.productKey} product={product} />
                    </div>
                </article>
            )}
        </div>
    );
};

export default ProductDetailPage;
