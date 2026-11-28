import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatPrice } from '../utils/storeFormat';

interface CartSummaryProps {
    count: number;
    /** Total ESTIMADO: el servidor recalcula con precios reales. */
    total: number;
    /** Accion (boton/enlace) que renderiza el container. */
    children?: React.ReactNode;
}

export const CartSummary: React.FC<CartSummaryProps> = ({ count, total, children }) => {
    const { t } = useTranslation();

    return (
        <aside className="flex flex-col gap-sm rounded-lg border border-border bg-surface p-md shadow-cards">
            <p className="text-sm text-text-secondary">{t('store.cart.units', { count })}</p>
            <div className="flex items-baseline justify-between gap-sm">
                <span className="font-semibold">{t('store.cart.estimatedTotal')}</span>
                <span className="font-display text-2xl font-bold text-primary">{formatPrice(total)}</span>
            </div>
            <p className="text-sm text-text-secondary">{t('store.cart.priceNote')}</p>
            {children}
        </aside>
    );
};
