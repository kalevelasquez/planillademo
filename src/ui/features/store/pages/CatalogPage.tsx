import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { useDebounce } from '../../../../hooks/useDebounce';
import { useCatalog } from '../hooks/useCatalog';
import { ProductGrid } from '../components/ProductGrid';
import { StoreNotice } from '../components/StoreNotice';

/** Tope del RPC (`store_list_products` acota p_limit a 100). */
const CATALOG_LIMIT = 100;
const SEARCH_DEBOUNCE_MS = 300;

/** `/tienda`: catalogo publico agrupado. Solo Disponible/Agotado y precio; jamas cantidades. */
const CatalogPage: React.FC = () => {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const search = useDebounce(query.trim(), SEARCH_DEBOUNCE_MS);
    const { status, products, reload } = useCatalog({ search, limit: CATALOG_LIMIT });

    return (
        <div className="mx-auto w-full max-w-[72rem] px-md py-8 md:px-lg md:py-12">
            <header className="mb-lg flex flex-col gap-1">
                <h1 className="font-display text-3xl md:text-4xl">{t('store.catalog.title')}</h1>
                <p className="text-text-secondary">{t('store.catalog.subtitle')}</p>
            </header>

            {status !== 'unavailable' && (
                <div className="relative mb-lg max-w-[28rem]">
                    <Search
                        size={18}
                        aria-hidden="true"
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
                    />
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        aria-label={t('store.catalog.search')}
                        placeholder={t('store.catalog.searchPlaceholder')}
                        className="h-12 w-full rounded-full border border-border bg-surface-paper pl-10 pr-4 text-text shadow-cards outline-none transition-shadow focus:border-secondary focus:ring-2 focus:ring-secondary/30"
                    />
                </div>
            )}

            {status === 'loading' && products.length === 0 && (
                <div role="status" className="flex flex-col gap-md">
                    <span className="sr-only">{t('store.catalog.loading')}</span>
                    <div aria-hidden="true" className="grid grid-cols-2 gap-sm md:grid-cols-3 md:gap-lg xl:grid-cols-4">
                        {Array.from({ length: 8 }, (_, i) => (
                            <div key={i} className="h-[16rem] animate-pulse rounded-lg bg-surface-hover" />
                        ))}
                    </div>
                </div>
            )}

            {status === 'unavailable' && (
                <StoreNotice title={t('store.catalog.unavailableTitle')} message={t('store.errors.store_unavailable')} />
            )}

            {status === 'error' && (
                <StoreNotice tone="error" message={t('store.errors.generic')}>
                    <button
                        type="button"
                        onClick={reload}
                        className="mt-sm inline-flex h-11 items-center rounded-full bg-primary px-lg font-semibold text-white transition-colors hover:bg-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
                    >
                        {t('store.catalog.retry')}
                    </button>
                </StoreNotice>
            )}

            {products.length > 0 && (
                <div aria-busy={status === 'loading'} className={status === 'loading' ? 'opacity-60 transition-opacity' : ''}>
                    <ProductGrid products={products} label={t('store.catalog.title')} headingLevel={2} />
                </div>
            )}

            {status === 'ready' && products.length === 0 && (
                <StoreNotice
                    message={search ? t('store.catalog.noResults', { query: search }) : t('store.catalog.empty')}
                />
            )}
        </div>
    );
};

export default CatalogPage;
