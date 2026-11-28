import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ROUTES } from '../../../../config/storePaths';
import { validateEmail, validateRequired, type FieldError } from '../utils/storeValidation';
import { SUBMIT_BTN } from '../utils/storeStyles';
import { TextField } from './TextField';
import { CaptchaSlot } from './CaptchaSlot';

export interface LoginValues {
    email: string;
    password: string;
}

interface LoginFormProps {
    onSubmit: (values: LoginValues) => void;
    submitting?: boolean;
    /** Mensaje ya traducido del error del servidor. */
    errorMessage?: string | null;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onSubmit, submitting = false, errorMessage }) => {
    const { t } = useTranslation();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [errors, setErrors] = useState<{ email: FieldError; password: FieldError }>({ email: null, password: null });

    const msg = (e: FieldError) => (e ? t(`store.account.validation.${e}`) : null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const next = { email: validateEmail(email), password: validateRequired(password) };
        setErrors(next);
        if (next.email || next.password) return;
        onSubmit({ email: email.trim(), password });
    };

    return (
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-md">
            {errorMessage && (
                <p role="alert" className="rounded-md border border-error/40 bg-error-light px-md py-sm text-sm font-medium text-error-dark">
                    {errorMessage}
                </p>
            )}
            <TextField
                label={t('store.account.email')}
                type="email"
                autoComplete="email"
                value={email}
                onChange={setEmail}
                error={msg(errors.email)}
                disabled={submitting}
            />
            <TextField
                label={t('store.account.password')}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
                error={msg(errors.password)}
                disabled={submitting}
            />
            <CaptchaSlot />
            <button type="submit" disabled={submitting} className={SUBMIT_BTN}>
                {submitting ? t('store.account.loggingIn') : t('store.account.login')}
            </button>
            <p className="text-center text-sm text-text-secondary">
                {t('store.account.noAccount')}{' '}
                <Link to={`${ROUTES.ACCOUNT}/registro`} className="font-semibold text-primary underline-offset-4 hover:underline">
                    {t('store.account.register')}
                </Link>
            </p>
        </form>
    );
};
