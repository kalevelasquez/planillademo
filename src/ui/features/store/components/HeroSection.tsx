import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Apple, Banana, Cherry, Citrus, Grape, ArrowRight } from 'lucide-react';
import { BRAND } from '../../../../config/brand';
import { ROUTES } from '../../../../config/storePaths';

const TILES = [
    { Icon: Apple, tone: 'bg-error/90' },
    { Icon: Citrus, tone: 'bg-accent-orange' },
    { Icon: Grape, tone: 'bg-accent-purple' },
    { Icon: Banana, tone: 'bg-warning' },
    { Icon: Cherry, tone: 'bg-error-dark' },
    { Icon: Apple, tone: 'bg-success' },
] as const;

/** Hero de la landing: tagline de marca, propuesta, CTA al catalogo y ancla a "Como pedir". */
export const HeroSection: React.FC = () => {
    const { t } = useTranslation();

    return (
        <section aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-primary text-white">
            <div
                aria-hidden="true"
                className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_90%_-10%,rgba(25,118,210,0.55),transparent),radial-gradient(40rem_24rem_at_-10%_110%,rgba(252,170,24,0.20),transparent)]"
            />
            <div className="mx-auto grid w-full max-w-[72rem] items-center gap-xl px-md py-14 md:px-lg md:py-20 lg:grid-cols-[1.15fr_0.85fr] lg:py-24">
                <div className="flex flex-col items-start gap-md">
                    <p className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/90">
                        {BRAND.TAGLINE}
                    </p>
                    <h1
                        id="hero-title"
                        className="font-display text-[2.25rem] font-bold leading-[1.1] tracking-tight text-white md:text-[3.25rem]"
                    >
                        {t('store.landing.heroTitle')}
                    </h1>
                    <p className="max-w-[34rem] text-base leading-relaxed text-white/80 md:text-lg">
                        {t('store.landing.heroSubtitle')}
                    </p>
                    <div className="mt-sm flex flex-col gap-sm sm:flex-row sm:items-center">
                        <Link
                            to={ROUTES.STORE}
                            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent-orange px-lg font-display text-base font-bold text-primary shadow-modals transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
                        >
                            {t('store.landing.cta')}
                            <ArrowRight size={18} aria-hidden="true" />
                        </Link>
                        <a
                            href="#como-pedir"
                            className="inline-flex h-12 items-center justify-center rounded-full border border-white/40 px-lg font-display text-base font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                        >
                            {t('store.landing.ctaSecondary')}
                        </a>
                    </div>
                </div>

                <div aria-hidden="true" className="hidden lg:block">
                    <div className="grid grid-cols-3 gap-md rounded-[28px] border border-white/15 bg-white/10 p-lg backdrop-blur-sm">
                        {TILES.map(({ Icon, tone }, i) => (
                            <div
                                key={i}
                                className={`flex aspect-square items-center justify-center rounded-2xl ${tone} text-white shadow-cards ${
                                    i % 2 === 1 ? 'translate-y-3' : ''
                                }`}
                            >
                                <Icon size={40} strokeWidth={1.6} />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
};
