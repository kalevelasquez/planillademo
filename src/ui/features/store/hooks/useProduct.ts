import { useCallback, useEffect, useState } from 'react';
import { getProduct, StoreError, type StoreProduct } from '../../../../services/storeService';

export type ProductStatus = 'loading' | 'ready' | 'notFound' | 'unavailable' | 'error';

interface Settled {
    key: string;
    status: Exclude<ProductStatus, 'loading'>;
    product: StoreProduct | null;
}

/** Detalle de un producto del catalogo publico por su `productKey` opaco. `loading` se deriva. */
export function useProduct(productKey: string) {
    const [attempt, setAttempt] = useState(0);
    const [settled, setSettled] = useState<Settled | null>(null);
    const requestKey = `${productKey}|${attempt}`;

    useEffect(() => {
        let cancelled = false;

        getProduct(productKey)
            .then((product) => {
                if (!cancelled) setSettled({ key: requestKey, status: product ? 'ready' : 'notFound', product });
            })
            .catch((e: unknown) => {
                if (cancelled) return;
                const unavailable = e instanceof StoreError && e.i18nKey === 'store.errors.store_unavailable';
                setSettled({ key: requestKey, status: unavailable ? 'unavailable' : 'error', product: null });
            });

        return () => {
            cancelled = true;
        };
    }, [productKey, requestKey]);

    const reload = useCallback(() => setAttempt((n) => n + 1), []);

    const isCurrent = settled?.key === requestKey;
    const status: ProductStatus = isCurrent ? settled.status : 'loading';

    return { status, product: isCurrent ? settled.product : null, reload };
}
