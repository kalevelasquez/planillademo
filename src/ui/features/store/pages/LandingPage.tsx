import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { ROUTES } from '../../../../config/storePaths';
import { useCatalog } from '../hooks/useCatalog';
import { pickFeatured } from '../utils/storeFormat';
import { HeroSection } from '../components/HeroSection';
import { ValueProps } from '../components/ValueProps';
import { ProductGrid } from '../components/ProductGrid';
import { HowItWorks } from '../components/HowItWorks';
import { ContactSection } from '../components/ContactSection';

const FEATURED_FETCH = 24;
const FEATURED_SHOWN = 4;

/**
 * `/`: landing publica. Los destacados vienen del RPC anon; si la tienda no esta configurada, esta
 * vacia o falla la red, esa seccion simplemente no aparece: la landing nunca depende del catalogo.
 */
const LandingPage: React.FC = () => {
    const { t } = useTranslation();
    const { status, products } = useCatalog({ limit: FEATURED_FETCH });
    const featured = useMemo(() => pickFeatured(products, FEATURED_SHOWN), [products]);

    return (
        <>
            <HeroSection />
            <ValueProps />

            {status === 'loading' && (
                <div aria-hidden="true" className="mx-auto grid w-full max-w-[72rem] grid-cols-2 gap-sm px-md pb-12 md:grid-cols-4 md:gap-lg md:px-lg">
                    {Array.from({ length: FEATURED_SHOWN }, (_, i) => (
                        <div key={i} className="h-[14rem] animate-pulse rounded-lg bg-surface-hover" />
                    ))}
                </div>
            )}

            {status === 'ready' && featured.length > 0 && (
                <section aria-labelledby="featured-title" className="mx-auto w-full max-w-[72rem] px-md pb-12 md:px-lg md:pb-16">
                    <div className="mb-lg flex flex-wrap items-end justify-between gap-sm">
                        <div>
                            <h2 id="featured-title" className="font-display text-2xl md:text-3xl">
                                {t('store.landing.featured.title')}
                            </h2>
                            <p className="mt-1 text-text-secondary">{t('store.landing.featured.subtitle')}</p>
                        </div>
                        <Link
                            to={ROUTES.STORE}
                            className="inline-flex items-center gap-2 rounded-full font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
                        >
                            {t('store.landing.featured.viewAll')}
                            <ArrowRight size={16} aria-hidden="true" />
                        </Link>
                    </div>
                    <ProductGrid products={featured} label={t('store.landing.featured.title')} />
                </section>
            )}

            <HowItWorks />
            <ContactSection />
        </>
    );
};

export default LandingPage;
