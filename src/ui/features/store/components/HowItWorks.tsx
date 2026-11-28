import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ROUTES } from '../../../../config/storePaths';
import { PRIMARY_LINK_BTN } from '../utils/storeStyles';

const STEPS = ['account', 'order', 'confirm', 'delivery'] as const;

/** "Como pedir": 4 pasos informativos con acceso directo a crear cuenta. */
export const HowItWorks: React.FC = () => {
    const { t } = useTranslation();

    return (
        <section id="como-pedir" aria-labelledby="how-title" className="scroll-mt-20 bg-primary-light/60">
            <div className="mx-auto w-full max-w-[72rem] px-md py-12 md:px-lg md:py-16">
                <h2 id="how-title" className="font-display text-2xl md:text-3xl">
                    {t('store.landing.how.title')}
                </h2>
                <p className="mt-1 mb-lg text-text-secondary">{t('store.landing.how.subtitle')}</p>

                <ol className="m-0 grid list-none grid-cols-1 gap-md p-0 md:grid-cols-2 lg:grid-cols-4">
                    {STEPS.map((key, index) => (
                        <li
                            key={key}
                            className="relative flex flex-col gap-sm rounded-lg border border-border bg-surface-paper p-md shadow-cards"
                        >
                            <span
                                aria-hidden="true"
                                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary font-display text-base font-bold text-white"
                            >
                                {index + 1}
                            </span>
                            <h3 className="text-lg">{t(`store.landing.how.steps.${key}.title`)}</h3>
                            <p className="text-sm leading-relaxed text-text-secondary">
                                {t(`store.landing.how.steps.${key}.body`)}
                            </p>
                        </li>
                    ))}
                </ol>

                <div className="mt-lg">
                    <Link to={`${ROUTES.ACCOUNT}/registro`} className={PRIMARY_LINK_BTN}>
                        {t('store.landing.how.ctaAccount')}
                    </Link>
                </div>
            </div>
        </section>
    );
};
