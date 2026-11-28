import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { signInStoreCustomer } from '../../../../services/storeAuthService';
import { useStoreSessionStore } from '../../../../store/storeSessionStore';
import { useMyAccount } from '../hooks/useMyAccount';
import { LoginForm, type LoginValues } from '../components/LoginForm';
import { MyOrdersSection } from './MyOrdersPage';
import { storeErrorMessage } from '../utils/storeErrors';
import { resolveStoreReturnPath } from '../utils/storeReturnPath';
import { SECONDARY_LINK_BTN } from '../utils/storeStyles';

const LoginView: React.FC = () => {
    const { t } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (values: LoginValues) => {
        setSubmitting(true);
        setError(null);
        try {
            await signInStoreCustomer(values);
            const back = resolveStoreReturnPath(location.state);
            if (back) navigate(back, { replace: true });
        } catch (err) {
            setError(storeErrorMessage(t, err));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="mx-auto w-full max-w-[28rem] px-md py-8 md:py-12">
            <h1 className="font-display text-3xl">{t('store.account.loginTitle')}</h1>
            <p className="mt-1 mb-lg text-text-secondary">{t('store.account.loginSubtitle')}</p>
            <LoginForm onSubmit={handleSubmit} submitting={submitting} errorMessage={error} />
        </div>
    );
};

const AccountView: React.FC = () => {
    const { t } = useTranslation();
    const session = useStoreSessionStore((s) => s.session);
    const signOut = useStoreSessionStore((s) => s.signOut);
    const account = useMyAccount();
    const place = [account?.address, account?.municipality, account?.department].filter(Boolean).join(', ');
    const email = account?.email ?? session?.user.email ?? null;

    return (
        <div className="mx-auto flex w-full max-w-[48rem] flex-col gap-lg px-md py-8 md:px-lg md:py-12">
            <div className="flex flex-wrap items-center justify-between gap-sm">
                <h1 className="font-display text-3xl md:text-4xl">{t('store.account.title')}</h1>
                <button type="button" onClick={() => void signOut()} className={SECONDARY_LINK_BTN}>
                    {t('store.account.logout')}
                </button>
            </div>

            <section aria-labelledby="account-details" className="rounded-lg border border-border bg-surface p-md shadow-cards">
                <h2 id="account-details" className="mb-sm font-display text-xl">
                    {t('store.account.details')}
                </h2>
                <div className="flex flex-col gap-1">
                    {account?.contactName && <p className="font-semibold">{account.contactName}</p>}
                    {email && <p className="text-text-secondary">{email}</p>}
                    {account?.phone && <p className="text-text-secondary">{account.phone}</p>}
                    {place && <p className="text-text-secondary">{place}</p>}
                </div>
            </section>

            <MyOrdersSection />
        </div>
    );
};

/**
 * `/cuenta`: login de tienda si no hay sesion de cliente; con sesion, datos de la cuenta y "Mis
 * pedidos". La sesion es la del cliente de tienda: nunca la del personal interno.
 */
const AccountPage: React.FC = () => {
    const { t } = useTranslation();
    const { session, status } = useStoreSessionStore();

    if (status === 'loading') {
        return (
            <div role="status" className="flex justify-center py-20">
                <span className="sr-only">{t('store.account.sessionLoading')}</span>
                <div aria-hidden="true" className="h-10 w-10 animate-spin rounded-full border-t-2 border-primary" />
            </div>
        );
    }
    return session ? <AccountView /> : <LoginView />;
};

export default AccountPage;
