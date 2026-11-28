import React from 'react';
import { useTranslation } from 'react-i18next';
import { Leaf, PackageCheck, Boxes, Banknote } from 'lucide-react';

const ITEMS = [
    { key: 'fresh', Icon: Leaf },
    { key: 'availability', Icon: PackageCheck },
    { key: 'wholesale', Icon: Boxes },
    { key: 'cod', Icon: Banknote },
] as const;

/** Propuestas de valor de la landing. */
export const ValueProps: React.FC = () => {
    const { t } = useTranslation();

    return (
        <section aria-labelledby="value-title" className="mx-auto w-full max-w-[72rem] px-md py-12 md:px-lg md:py-16">
            <h2 id="value-title" className="mb-lg font-display text-2xl md:text-3xl">
                {t('store.landing.valueProps.title')}
            </h2>
            <ul className="m-0 grid list-none grid-cols-1 gap-md p-0 sm:grid-cols-2 lg:grid-cols-4">
                {ITEMS.map(({ key, Icon }) => (
                    <li
                        key={key}
                        className="flex flex-col gap-sm rounded-lg border border-border bg-surface-paper p-md shadow-cards"
                    >
                        <span
                            aria-hidden="true"
                            className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-light text-primary"
                        >
                            <Icon size={22} />
                        </span>
                        <h3 className="text-lg">{t(`store.landing.valueProps.${key}.title`)}</h3>
                        <p className="text-sm leading-relaxed text-text-secondary">
                            {t(`store.landing.valueProps.${key}.body`)}
                        </p>
                    </li>
                ))}
            </ul>
        </section>
    );
};
