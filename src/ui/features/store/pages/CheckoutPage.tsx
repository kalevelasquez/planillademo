import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import { ROUTES } from '../../../../config/storePaths';
import { cartCount, cartEstimatedTotal, useCartStore } from '../../../../store/cartStore';
import { createStoreOrder, type CreatedOrder } from '../../../../services/storeService';
import { useMyAccount } from '../hooks/useMyAccount';
import { CartSummary } from '../components/CartSummary';
import { StoreNotice } from '../components/StoreNotice';
import { formatPrice } from '../utils/storeFormat';
import { storeErrorMessage } from '../utils/storeErrors';
import { PRIMARY_LINK_BTN, SECONDARY_LINK_BTN, SUBMIT_BTN } from '../utils/storeStyles';

/**
 * `/tienda/checkout` (requiere sesion de tienda, ver StoreAuthGuard). Pago contra entrega: el pedido
 * entra Pending y un vendedor lo aprueba despues. Solo se envian productKey+cantidad; el precio y el
 * total los fija el servidor.
 */
const CheckoutPage: React.FC = () => {
    const { t } = useTranslation();
    const items = useCartStore((s) => s.items);
    const clear = useCartStore((s) => s.clear);
    const account = useMyAccount();

    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [created, setCreated] = useState<CreatedOrder | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        setError(null);
        try {
            const order = await createStoreOrder(
                items.map((i) => ({ productKey: i.productKey, quantity: i.qty })),
                notes,
            );
            clear();
            setCreated(order);
        } catch (err) {
            setError(storeErrorMessage(t, err));
        } finally {
            setSubmitting(false);
        }
    };

    if (created) {
        return (
            <div className="mx-auto w-full max-w-[40rem] px-md py-8 md:px-lg md:py-12">
                <div className="flex flex-col items-center gap-md rounded-lg border border-border bg-surface-paper px-lg py-xl text-center shadow-cards">
                    <CheckCircle2 size={48} aria-hidden="true" className="text-success" />
                    <h1 className="font-display text-3xl">{t('store.checkout.successTitle')}</h1>
                    <p className="text-text-secondary">{t('store.checkout.successBody')}</p>
                    <div>
                        <p className="text-sm text-text-secondary">{t('store.checkout.orderNumber')}</p>
                        <p className="font-display text-2xl font-bold text-primary">{created.orderNumber}</p>
                        <p className="mt-1 text-sm text-text-secondary">
                            {t('store.cart.estimatedTotal')}: {formatPrice(created.total)}
                        </p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-sm">
                        <Link to={ROUTES.ACCOUNT} className={PRIMARY_LINK_BTN}>
                            {t('store.checkout.viewOrders')}
                        </Link>
                        <Link to={ROUTES.STORE} className={SECONDARY_LINK_BTN}>
                            {t('store.checkout.keepShopping')}
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="mx-auto w-full max-w-[72rem] px-md py-8 md:px-lg md:py-12">
                <StoreNotice title={t('store.checkout.emptyTitle')} message={t('store.checkout.emptyBody')}>
                    <Link to={ROUTES.STORE} className={`${PRIMARY_LINK_BTN} mt-sm`}>
                        {t('store.cart.emptyCta')}
                    </Link>
                </StoreNotice>
            </div>
        );
    }

    const place = [account?.address, account?.municipality, account?.department].filter(Boolean).join(', ');

    return (
        <div className="mx-auto w-full max-w-[72rem] px-md py-8 md:px-lg md:py-12">
            <h1 className="mb-lg font-display text-3xl md:text-4xl">{t('store.checkout.title')}</h1>

            <form onSubmit={submit} className="grid gap-lg lg:grid-cols-[1fr_22rem]">
                <div className="flex flex-col gap-md">
                    <section className="rounded-lg border border-border bg-surface p-md shadow-cards">
                        <h2 className="mb-sm font-display text-xl">{t('store.checkout.cashOnDelivery')}</h2>
                        <p className="text-text-secondary">{t('store.checkout.cashOnDeliveryBody')}</p>
                    </section>

                    {account && (account.contactName || place || account.phone) && (
                        <section className="rounded-lg border border-border bg-surface p-md shadow-cards">
                            <h2 className="mb-sm font-display text-xl">{t('store.checkout.deliveryTo')}</h2>
                            {account.contactName && <p className="font-semibold">{account.contactName}</p>}
                            {place && <p className="text-text-secondary">{place}</p>}
                            {account.phone && <p className="text-text-secondary">{account.phone}</p>}
                        </section>
                    )}

                    <section className="rounded-lg border border-border bg-surface p-md shadow-cards">
                        <ul className="m-0 mb-md flex list-none flex-col gap-1 p-0">
                            {items.map((i) => (
                                <li key={i.productKey} className="flex justify-between gap-sm">
                                    <span>{`${i.qty} × ${i.name}`}</span>
                                    <span className="text-text-secondary">{formatPrice(i.price * i.qty)}</span>
                                </li>
                            ))}
                        </ul>
                        <label htmlFor="checkout-notes" className="mb-1 block text-sm font-semibold">
                            {t('store.checkout.notes')}
                        </label>
                        <textarea
                            id="checkout-notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            maxLength={500}
                            rows={3}
                            placeholder={t('store.checkout.notesPlaceholder')}
                            disabled={submitting}
                            className="w-full rounded-md border border-border bg-surface-paper p-md outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-secondary"
                        />
                    </section>
                </div>

                <div className="flex flex-col gap-md lg:sticky lg:top-24 lg:self-start">
                    <CartSummary count={cartCount(items)} total={cartEstimatedTotal(items)}>
                        {error && (
                            <p role="alert" className="rounded-md border border-error/40 bg-error-light px-md py-sm text-sm font-medium text-error-dark">
                                {error}
                            </p>
                        )}
                        <button type="submit" disabled={submitting} className={`${SUBMIT_BTN} mt-sm`}>
                            {submitting ? t('store.checkout.submitting') : t('store.checkout.submit')}
                        </button>
                        <Link to={`${ROUTES.STORE}/carrito`} className="text-center text-sm font-semibold text-primary underline-offset-4 hover:underline">
                            {t('store.checkout.editCart')}
                        </Link>
                    </CartSummary>
                </div>
            </form>
        </div>
    );
};

export default CheckoutPage;
