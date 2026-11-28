import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard } from 'lucide-react';
import BrandLogo from '../../../../assets/images/logo-teknergy.png';
import { ROUTES } from '../../../../config/storePaths';

interface StoreHeaderProps {
    /** `true` si hay sesion INTERNA (cliente admin): muestra el acceso "Ir al panel". */
    showPanelLink?: boolean;
}

const NAV_LINK =
    'rounded-full px-3 py-2 text-sm font-semibold text-text-secondary transition-colors hover:bg-primary-light hover:text-primary focus-visible:outline-2 focus-visible:outline-secondary aria-[current=page]:bg-primary-light aria-[current=page]:text-primary';

export const StoreHeader: React.FC<StoreHeaderProps> = ({ showPanelLink = false }) => {
    const { t } = useTranslation();

    return (
        <header className="sticky top-0 z-40 border-b border-border bg-surface-paper/90 backdrop-blur">
            <a
                href="#contenido"
                className="sr-only focus:not-sr-only focus:absolute focus:left-md focus:top-sm focus:z-50 focus:rounded-md focus:bg-primary focus:px-md focus:py-sm focus:text-white"
            >
                {t('store.nav.skip')}
            </a>
            <div className="mx-auto flex h-16 w-full max-w-[72rem] items-center justify-between gap-sm px-md md:px-lg">
                <Link
                    to={ROUTES.LANDING}
                    aria-label={t('store.nav.logoLabel')}
                    className="flex items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
                >
                    <img src={BrandLogo} alt="" className="h-9 w-auto md:h-10" />
                </Link>

                <nav aria-label={t('store.nav.main')} className="flex items-center gap-1">
                    <NavLink to={ROUTES.STORE} className={NAV_LINK}>
                        {t('store.nav.catalog')}
                    </NavLink>
                    {showPanelLink && (
                        <Link
                            to={ROUTES.ADMIN_HOME}
                            aria-label={t('store.nav.panel')}
                            className="inline-flex items-center gap-2 rounded-full border border-primary px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
                        >
                            <LayoutDashboard size={16} aria-hidden="true" />
                            <span className="hidden sm:inline">{t('store.nav.panel')}</span>
                        </Link>
                    )}
                </nav>
            </div>
        </header>
    );
};
