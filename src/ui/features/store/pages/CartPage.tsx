import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ROUTES } from '../../../../config/storePaths';
import { cartCount, cartEstimatedTotal, useCartStore } from '../../../../store/cartStore';
import { CartLine } from '../components/CartLine';
import { CartSummary } from '../components/CartSummary';
import { StoreNotice } from '../components/StoreNotice';
import { PRIMARY_LINK_BTN } from '../utils/storeStyles';

/** `/tienda/carrito`: lineas editables y total ESTIMADO (el servidor recalcula al pedir). */
const CartPage: React.FC = () => {
    const { t } = useTranslation();
    const items = useCartStore((s) => s.items);
    const setQty = useCartStore((s) => s.setQty);
    const remove = useCartStore((s) => s.remove);

    return (
        <div className="mx-auto w-full max-w-[72rem] px-md py-8 md:px-lg md:py-12">
            <h1 className="mb-lg font-display text-3xl md:text-4xl">{t('store.cart.title')}</h1>

            {items.length === 0 ? (
                <StoreNotice message={t('store.cart.empty')}>
                    <Link to={ROUTES.STORE} className={`${PRIMARY_LINK_BTN} mt-sm`}>
                        {t('store.cart.emptyCta')}
                    </Link>
                </StoreNotice>
            ) : (
                <div className="grid gap-lg lg:grid-cols-[1fr_22rem]">
                    <ul className="m-0 flex list-none flex-col gap-md p-0">
                        {items.map((item) => (
                            <CartLine key={item.productKey} item={item} onQtyChange={setQty} onRemove={remove} />
                        ))}
                    </ul>
                    <div className="lg:sticky lg:top-24 lg:self-start">
                        <CartSummary count={cartCount(items)} total={cartEstimatedTotal(items)}>
                            <Link to={`${ROUTES.STORE}/checkout`} className={`${PRIMARY_LINK_BTN} mt-sm`}>
                                {t('store.cart.checkout')}
                            </Link>
                        </CartSummary>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CartPage;
