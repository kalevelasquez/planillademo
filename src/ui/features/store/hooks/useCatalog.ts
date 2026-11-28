import { useCallback, useEffect, useState } from 'react';
import { listProducts, StoreError, type StoreProduct } from '../../../../services/storeService';

export type CatalogStatus = 'loading' | 'ready' | 'unavailable' | 'error';

export interface UseCatalogOptions {
    search?: string;
    limit?: number;
}

interface Settled {
    /** Clave de la peticion que produjo este resultado (busqueda + limite + reintento). */
    key: string;
    status: Exclude<CatalogStatus, 'loading'>;
    products: StoreProduct[];
}

/**
 * Catalogo publico. `unavailable` = la tienda no esta configurada/habilitada (sin
 * VITE_STORE_TENANT_ID): se distingue del error de red para mostrar un estado amigable.
 *
 * El estado `loading` se DERIVA (el ultimo resultado no corresponde a la peticion actual), sin
 * setState sincrono en el efecto. Mientras recarga (nueva busqueda) conserva los productos del
 * ultimo resultado `ready`; las respuestas viejas se descartan.
 */
export function useCatalog({ search, limit }: UseCatalogOptions = {}) {
    const [attempt, setAttempt] = useState(0);
    const [settled, setSettled] = useState<Settled | null>(null);
    const requestKey = `${search ?? ''}|${limit ?? ''}|${attempt}`;

    useEffect(() => {
        let cancelled = false;

        listProducts({ search, limit })
            .then((products) => {
                if (!cancelled) setSettled({ key: requestKey, status: 'ready', products });
            })
            .catch((e: unknown) => {
                if (cancelled) return;
                const unavailable = e instanceof StoreError && e.i18nKey === 'store.errors.store_unavailable';
                setSettled({ key: requestKey, status: unavailable ? 'unavailable' : 'error', products: [] });
            });

        return () => {
            cancelled = true;
        };
    }, [search, limit, requestKey]);

    const reload = useCallback(() => setAttempt((n) => n + 1), []);

    const isCurrent = settled?.key === requestKey;
    const status: CatalogStatus = isCurrent ? settled.status : 'loading';
    const products = settled?.status === 'ready' ? settled.products : [];

    return { status, products, reload };
}
