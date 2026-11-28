import React from 'react';
import { useTranslation } from 'react-i18next';

/** `soon`: pasos que dependen del pedido en linea (F2): hoy se rotulan "Proximamente". */
const STEPS = [
    { key: 'account', soon: true },
    { key: 'order', soon: true },
    { key: 'confirm', soon: false },
    { key: 'delivery', soon: false },
] as const;

/** "Como pedir": 4 pasos. Informativo; NO ofrece acciones de registro/pedido en esta fase. */
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
                    {STEPS.map(({ key, soon }, index) => (
                        <li
                            key={key}
                            className="relative flex flex-col gap-sm rounded-lg border border-border bg-surface-paper p-md shadow-cards"
                        >
                            <div className="flex items-center justify-between">
                                <span
                                    aria-hidden="true"
                                    className="flex h-9 w-9 items-center justify-center rounded-full bg-primary font-display text-base font-bold text-white"
                                >
                                    {index + 1}
                                </span>
                                {soon && (
                                    <span className="rounded-full bg-warning-light px-2.5 py-0.5 text-xs font-semibold text-primary">
                                        {t('store.landing.how.comingSoon')}
                                    </span>
                                )}
                            </div>
                            <h3 className="text-lg">{t(`store.landing.how.steps.${key}.title`)}</h3>
                            <p className="text-sm leading-relaxed text-text-secondary">
                                {t(`store.landing.how.steps.${key}.body`)}
                            </p>
                        </li>
                    ))}
                </ol>

                <p className="mt-lg rounded-lg border border-warning/40 bg-warning-light px-md py-sm text-sm text-text">
                    {t('store.landing.how.comingSoonNote')}
                </p>
            </div>
        </section>
    );
};
