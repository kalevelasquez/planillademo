import React from 'react';
import { useTranslation } from 'react-i18next';
import type { MyOrder } from '../../../../services/storeService';
import { formatOrderDate, formatPrice } from '../utils/storeFormat';

const KNOWN_STATUS = ['Pending', 'Approved', 'InPreparation', 'Delivered', 'Cancelled'] as const;
type KnownStatus = (typeof KNOWN_STATUS)[number];
const isKnownStatus = (s: string): s is KnownStatus => (KNOWN_STATUS as readonly string[]).includes(s);

const STATUS_STYLE: Record<KnownStatus, string> = {
    Pending: 'bg-warning-light text-primary',
    Approved: 'bg-success-light text-success-dark',
    InPreparation: 'bg-primary-light text-primary',
    Delivered: 'bg-success-light text-success-dark',
    Cancelled: 'bg-error-light text-error-dark',
};

interface OrderStatusListProps {
    orders: MyOrder[];
}

/** Lista de pedidos del cliente con estado traducido (un estado desconocido nunca muestra el valor crudo). */
export const OrderStatusList: React.FC<OrderStatusListProps> = ({ orders }) => {
    const { t, i18n } = useTranslation();

    return (
        <ul className="m-0 flex list-none flex-col gap-md p-0">
            {orders.map((o) => {
                return (
                    <li key={o.orderNumber} data-order={o.orderNumber} className="flex flex-col gap-sm rounded-lg border border-border bg-surface p-md shadow-cards">
                        <div className="flex flex-wrap items-center justify-between gap-sm">
                            <p className="font-display text-lg font-bold">{t('store.orders.number', { number: o.orderNumber })}</p>
                            <span className={`rounded-full px-3 py-0.5 text-sm font-semibold ${isKnownStatus(o.status) ? STATUS_STYLE[o.status] : 'bg-surface-hover text-text-secondary'}`}>
                                {t(`store.orders.status.${isKnownStatus(o.status) ? o.status : 'unknown'}`)}
                            </span>
                        </div>
                        <p className="text-sm text-text-secondary">{formatOrderDate(o.createdAt, i18n.language)}</p>
                        {o.items.length > 0 && (
                            <ul className="m-0 list-none p-0 text-sm text-text-secondary">
                                {o.items.map((it, idx) => (
                                    <li key={`${it.name}-${it.caliber}-${it.quality}-${idx}`}>
                                        {`${it.quantity} × ${it.name}`}
                                        {it.caliber ? ` · ${t('store.catalog.caliber', { value: it.caliber })}` : ''}
                                        {it.quality ? ` · ${it.quality}` : ''}
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="flex items-baseline justify-between gap-sm border-t border-border pt-sm">
                            <span className="text-sm text-text-secondary">{t('store.orders.total')}</span>
                            <span className="font-display text-lg font-bold text-primary">{formatPrice(o.total)}</span>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
};
