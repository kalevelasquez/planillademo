import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BRAND } from '../../../../config/brand';
import { ROUTES } from '../../../../config/storePaths';

const FOOT_LINK =
    'rounded text-sm text-white/80 underline-offset-4 hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

export const StoreFooter: React.FC = () => {
    const { t } = useTranslation();

    return (
        <footer className="bg-primary-dark text-white">
            <div className="mx-auto grid w-full max-w-[72rem] gap-lg px-md py-10 md:grid-cols-[1.4fr_1fr_1fr] md:px-lg">
                <div className="flex flex-col gap-1">
                    <p className="font-display text-xl font-bold tracking-wide">{BRAND.NAME}</p>
                    <p className="text-sm text-white/70">{BRAND.TAGLINE}</p>
                </div>

                <nav aria-label={t('store.nav.main')} className="flex flex-col items-start gap-2">
                    <Link to={ROUTES.STORE} className={FOOT_LINK}>
                        {t('store.nav.catalog')}
                    </Link>
                    {/* <a> y no <Link>: BrowserRouter no hace scroll al hash; asi funciona desde cualquier pagina. */}
                    <a href={`${ROUTES.LANDING}#contacto`} className={FOOT_LINK}>
                        {t('store.nav.contact')}
                    </a>
                </nav>

                <div className="flex flex-col items-start gap-2" aria-label={t('store.footer.staffAria')} role="group">
                    <Link to={ROUTES.LOGIN} className={FOOT_LINK}>
                        {t('store.nav.staffLogin')}
                    </Link>
                </div>
            </div>
            <div className="border-t border-white/10">
                <p className="mx-auto w-full max-w-[72rem] px-md py-4 text-xs text-white/60 md:px-lg">
                    © {new Date().getFullYear()} {BRAND.NAME}. {t('store.footer.rights')}
                </p>
            </div>
        </footer>
    );
};
