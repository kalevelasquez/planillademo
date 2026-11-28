import React from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, Phone, MessageCircle, MapPin } from 'lucide-react';
import { CONTACT } from '../../../../config/brand';
import { formatPhone } from '../utils/storeFormat';

const LINK =
    'flex items-center gap-3 rounded-lg border border-border bg-surface-paper p-md shadow-cards transition-colors hover:border-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary';
const ICON = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-light text-primary';

/** Contacto comercial. Usa SOLO `CONTACT`; el contacto interno de BRAND no se expone (ver brand.test.ts). */
export const ContactSection: React.FC = () => {
    const { t } = useTranslation();

    return (
        <section id="contacto" aria-labelledby="contact-title" className="mx-auto w-full max-w-[72rem] scroll-mt-20 px-md py-12 md:px-lg md:py-16">
            <h2 id="contact-title" className="font-display text-2xl md:text-3xl">
                {t('store.landing.contactTitle')}
            </h2>
            <p className="mt-1 mb-lg text-text-secondary">{t('store.landing.contactSubtitle')}</p>

            <ul className="m-0 grid list-none grid-cols-1 gap-md p-0 md:grid-cols-2">
                <li>
                    <a href={`mailto:${CONTACT.SALES_EMAIL}`} className={LINK}>
                        <span aria-hidden="true" className={ICON}><Mail size={20} /></span>
                        <span className="flex min-w-0 flex-col">
                            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                                {t('store.landing.contact.email')}
                            </span>
                            <span className="truncate font-medium text-text">{CONTACT.SALES_EMAIL}</span>
                        </span>
                    </a>
                </li>
                <li>
                    <a href={`tel:+${CONTACT.SALES_PHONE}`} className={LINK}>
                        <span aria-hidden="true" className={ICON}><Phone size={20} /></span>
                        <span className="flex min-w-0 flex-col">
                            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                                {t('store.landing.contact.phone')}
                            </span>
                            <span className="font-medium text-text">{formatPhone(CONTACT.SALES_PHONE)}</span>
                        </span>
                    </a>
                </li>
                <li>
                    <a
                        href={`https://wa.me/${CONTACT.SALES_WHATSAPP}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={LINK}
                    >
                        <span aria-hidden="true" className={ICON}><MessageCircle size={20} /></span>
                        <span className="flex min-w-0 flex-col">
                            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                                {t('store.landing.contact.whatsapp')}
                            </span>
                            <span className="font-medium text-text">{formatPhone(CONTACT.SALES_WHATSAPP)}</span>
                        </span>
                    </a>
                </li>
                <li>
                    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-paper p-md shadow-cards">
                        <span aria-hidden="true" className={ICON}><MapPin size={20} /></span>
                        <span className="flex min-w-0 flex-col">
                            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                                {t('store.landing.contact.address')}
                            </span>
                            <span className="font-medium text-text">{CONTACT.ADDRESS}</span>
                        </span>
                    </div>
                </li>
            </ul>
        </section>
    );
};
