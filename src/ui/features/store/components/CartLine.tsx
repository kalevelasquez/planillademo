import React from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import type { CartItem } from '../../../../store/cartStore';
import { formatPrice } from '../utils/storeFormat';
import { ProductImage } from './ProductImage';
import { QuantityStepper } from './QuantityStepper';

interface CartLineProps {
    item: CartItem;
    onQtyChange: (productKey: string, qty: number) => void;
    onRemove: (productKey: string) => void;
}

/** Una linea del carrito (presentacional). El total de linea es solo estimado. */
export const CartLine: React.FC<CartLineProps> = ({ item, onQtyChange, onRemove }) => {
    const { t } = useTranslation();

    return (
        <li className="flex gap-md rounded-lg border border-border bg-surface p-md shadow-cards">
            <ProductImage src={item.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-md md:h-24 md:w-24" />

            <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-start justify-between gap-sm">
                    <div className="min-w-0">
                        <p className="truncate font-display text-lg font-bold">{item.name}</p>
                        {(item.caliber || item.quality) && (
                            <p className="flex flex-wrap items-center gap-x-2 text-sm text-text-secondary">
                                {item.caliber && <span>{t('store.catalog.caliber', { value: item.caliber })}</span>}
                                {item.quality && <span>{item.quality}</span>}
                            </p>
                        )}
                        <p className="text-sm text-text-secondary">{t('store.cart.unitPrice', { price: formatPrice(item.price) })}</p>
                    </div>
                    <button
                        type="button"
                        aria-label={t('store.cart.remove', { name: item.name })}
                        onClick={() => onRemove(item.productKey)}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-surface-hover hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
                    >
                        <Trash2 size={18} aria-hidden="true" />
                    </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-sm">
                    <QuantityStepper
                        name={item.name}
                        value={item.qty}
                        onChange={(next) => onQtyChange(item.productKey, next)}
                    />
                    <span className="font-display text-lg font-bold text-primary">{formatPrice(item.price * item.qty)}</span>
                </div>
            </div>
        </li>
    );
};
