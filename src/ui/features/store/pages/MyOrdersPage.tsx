import React from 'react';
import { useTranslation } from 'react-i18next';
import { useMyOrders } from '../hooks/useMyOrders';
import { OrderStatusList } from '../components/OrderStatusList';
import { StoreNotice } from '../components/StoreNotice';
import { storeErrorMessage } from '../utils/storeErrors';
import { StoreError } from '../../../../services/storeService';

interface MyOrdersSectionProps {
    /** `h1` cuando es la pagina propia; `h2` cuando va dentro de /cuenta. */
    asPage?: boolean;
}

/** Container de "Mis pedidos". */
export const MyOrdersSection: React.FC<MyOrdersSectionProps> = ({ asPage = false }) => {
    const { t } = useTranslation();
    const { status, orders, reload } = useMyOrders();
    const Heading = asPage ? 'h1' : 'h2';

    return (
        <section aria-labelledby="my-orders-title" className="flex flex-col gap-md">
            <Heading id="my-orders-title" className="font-display text-2xl">
                {t('store.orders.title')}
            </Heading>

            {status === 'loading' && (
                <div role="status" className="flex justify-center py-8">
                    <span className="sr-only">{t('store.orders.loading')}</span>
                    <div aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-t-2 border-primary" />
                </div>
            )}

            {status === 'error' && (
                <StoreNotice tone="error" message={storeErrorMessage(t, new StoreError('store.errors.generic'))}>
                    <button
                        type="button"
                        onClick={reload}
                        className="mt-sm inline-flex h-11 items-center rounded-full bg-primary px-lg font-semibold text-white hover:bg-primary-dark"
                    >
                        {t('store.orders.retry')}
                    </button>
                </StoreNotice>
            )}

            {status === 'ready' && orders.length === 0 && <p className="text-text-secondary">{t('store.orders.empty')}</p>}
            {status === 'ready' && orders.length > 0 && <OrderStatusList orders={orders} />}
        </section>
    );
};

const MyOrdersPage: React.FC = () => (
    <div className="mx-auto w-full max-w-[48rem] px-md py-8 md:px-lg md:py-12">
        <MyOrdersSection asPage />
    </div>
);

export default MyOrdersPage;
