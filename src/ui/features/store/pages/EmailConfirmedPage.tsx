import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import { ROUTES } from '../../../../config/storePaths';
import { useStoreSessionStore } from '../../../../store/storeSessionStore';
import { StoreNotice } from '../components/StoreNotice';
import { PRIMARY_LINK_BTN } from '../utils/storeStyles';

const hasAuthError = (raw: string): boolean => {
    const p = new URLSearchParams(raw.replace(/^[?#]/, ''));
    return p.has('error') || p.has('error_code') || p.has('error_description');
};

/**
 * `/cuenta/confirmado`: aterrizaje del enlace del correo. El cliente de tienda (PKCE, solo en
 * /cuenta*) canjea el `code` solo. Con sesion: listo para pedir. Sin sesion (otro dispositivo, no
 * hay verifier): correo confirmado, hay que ingresar. Con error en la URL: enlace vencido/invalido.
 */
const EmailConfirmedPage: React.FC = () => {
    const { t } = useTranslation();
    const { search, hash } = useLocation();
    const session = useStoreSessionStore((s) => s.session);

    if (hasAuthError(search) || hasAuthError(hash)) {
        return (
            <div className="mx-auto w-full max-w-[40rem] px-md py-8 md:py-12">
                <StoreNotice tone="error" message={t('store.account.confirmLinkError')}>
                    <Link to={ROUTES.ACCOUNT} className={`${PRIMARY_LINK_BTN} mt-sm`}>
                        {t('store.account.goToLogin')}
                    </Link>
                </StoreNotice>
            </div>
        );
    }

    return (
        <div className="mx-auto w-full max-w-[32rem] px-md py-8 md:py-12">
            <div className="flex flex-col items-center gap-md rounded-lg border border-border bg-surface-paper px-lg py-xl text-center shadow-cards">
                <CheckCircle2 size={48} aria-hidden="true" className="text-success" />
                <h1 className="font-display text-3xl">{t('store.account.emailConfirmedTitle')}</h1>
                <p className="text-text-secondary">
                    {session ? t('store.account.emailConfirmed') : t('store.account.confirmOtherDevice')}
                </p>
                {session ? (
                    <Link to={ROUTES.STORE} className={PRIMARY_LINK_BTN}>
                        {t('store.account.goToCatalog')}
                    </Link>
                ) : (
                    <Link to={ROUTES.ACCOUNT} className={PRIMARY_LINK_BTN}>
                        {t('store.account.goToLogin')}
                    </Link>
                )}
            </div>
        </div>
    );
};

export default EmailConfirmedPage;
