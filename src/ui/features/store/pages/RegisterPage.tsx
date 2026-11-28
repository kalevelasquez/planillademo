import React, { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MailCheck } from 'lucide-react';
import { ROUTES } from '../../../../config/storePaths';
import { signUpStoreCustomer } from '../../../../services/storeAuthService';
import { useStoreSessionStore } from '../../../../store/storeSessionStore';
import { RegisterForm, type RegisterValues } from '../components/RegisterForm';
import { storeErrorMessage } from '../utils/storeErrors';
import { PRIMARY_LINK_BTN } from '../utils/storeStyles';

/**
 * `/cuenta/registro`. Exito y "correo ya registrado" se ven IGUAL (no se revela si el email existe).
 * Si el registro esta deshabilitado en el servidor, se muestra un mensaje amable y el formulario sigue.
 */
const RegisterPage: React.FC = () => {
    const { t } = useTranslation();
    const session = useStoreSessionStore((s) => s.session);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    if (session) return <Navigate to={ROUTES.ACCOUNT} replace />;

    const handleSubmit = async (values: RegisterValues) => {
        setSubmitting(true);
        setError(null);
        try {
            await signUpStoreCustomer(values);
            setDone(true);
        } catch (err) {
            setError(storeErrorMessage(t, err));
        } finally {
            setSubmitting(false);
        }
    };

    if (done) {
        return (
            <div className="mx-auto w-full max-w-[32rem] px-md py-8 md:py-12">
                <div className="flex flex-col items-center gap-md rounded-lg border border-border bg-surface-paper px-lg py-xl text-center shadow-cards">
                    <MailCheck size={48} aria-hidden="true" className="text-primary" />
                    <h1 className="font-display text-3xl">{t('store.account.checkEmailTitle')}</h1>
                    <p className="text-text-secondary">{t('store.account.checkEmail')}</p>
                    <Link to={ROUTES.ACCOUNT} className={PRIMARY_LINK_BTN}>
                        {t('store.account.goToLogin')}
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto w-full max-w-[28rem] px-md py-8 md:py-12">
            <h1 className="font-display text-3xl">{t('store.account.registerTitle')}</h1>
            <p className="mt-1 mb-lg text-text-secondary">{t('store.account.registerSubtitle')}</p>
            <RegisterForm onSubmit={handleSubmit} submitting={submitting} errorMessage={error} />
        </div>
    );
};

export default RegisterPage;
