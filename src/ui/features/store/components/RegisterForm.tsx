import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ROUTES } from '../../../../config/storePaths';
import { validateEmail, validateNewPassword, validateRequired, type FieldError } from '../utils/storeValidation';
import { TextField } from './TextField';
import { CaptchaSlot } from './CaptchaSlot';
import { SUBMIT_BTN } from '../utils/storeStyles';

export interface RegisterValues {
    fullName: string;
    phone: string;
    email: string;
    password: string;
    address: string;
    department: string;
    municipality: string;
}

interface RegisterFormProps {
    onSubmit: (values: RegisterValues) => void;
    submitting?: boolean;
    errorMessage?: string | null;
}

const EMPTY: RegisterValues = {
    fullName: '',
    phone: '',
    email: '',
    password: '',
    address: '',
    department: '',
    municipality: '',
};

type Errors = Partial<Record<'fullName' | 'phone' | 'email' | 'password', FieldError>>;

export const RegisterForm: React.FC<RegisterFormProps> = ({ onSubmit, submitting = false, errorMessage }) => {
    const { t } = useTranslation();
    const [values, setValues] = useState<RegisterValues>(EMPTY);
    const [errors, setErrors] = useState<Errors>({});

    const set = (key: keyof RegisterValues) => (value: string) => setValues((v) => ({ ...v, [key]: value }));
    const msg = (e?: FieldError) => (e ? t(`store.account.validation.${e}`) : null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const next: Errors = {
            fullName: validateRequired(values.fullName),
            phone: validateRequired(values.phone),
            email: validateEmail(values.email),
            password: validateNewPassword(values.password),
        };
        setErrors(next);
        if (Object.values(next).some(Boolean)) return;
        onSubmit({
            fullName: values.fullName.trim(),
            phone: values.phone.trim(),
            email: values.email.trim(),
            password: values.password,
            address: values.address.trim(),
            department: values.department.trim(),
            municipality: values.municipality.trim(),
        });
    };

    return (
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-md">
            {errorMessage && (
                <p role="alert" className="rounded-md border border-error/40 bg-error-light px-md py-sm text-sm font-medium text-error-dark">
                    {errorMessage}
                </p>
            )}
            <TextField label={t('store.account.fullName')} autoComplete="name" value={values.fullName} onChange={set('fullName')} error={msg(errors.fullName)} disabled={submitting} />
            <TextField label={t('store.account.phone')} type="tel" autoComplete="tel" value={values.phone} onChange={set('phone')} error={msg(errors.phone)} disabled={submitting} />
            <TextField label={t('store.account.email')} type="email" autoComplete="email" value={values.email} onChange={set('email')} error={msg(errors.email)} disabled={submitting} />
            <TextField
                label={t('store.account.password')}
                type="password"
                autoComplete="new-password"
                value={values.password}
                onChange={set('password')}
                error={msg(errors.password)}
                hint={t('store.account.passwordHint')}
                disabled={submitting}
            />
            <TextField label={t('store.account.address')} autoComplete="street-address" value={values.address} onChange={set('address')} disabled={submitting} />
            <TextField label={t('store.account.department')} autoComplete="address-level1" value={values.department} onChange={set('department')} disabled={submitting} />
            <TextField label={t('store.account.municipality')} autoComplete="address-level2" value={values.municipality} onChange={set('municipality')} disabled={submitting} />
            <CaptchaSlot />
            <button type="submit" disabled={submitting} className={SUBMIT_BTN}>
                {submitting ? t('store.account.registering') : t('store.account.register')}
            </button>
            <p className="text-center text-sm text-text-secondary">
                {t('store.account.haveAccount')}{' '}
                <Link to={ROUTES.ACCOUNT} className="font-semibold text-primary underline-offset-4 hover:underline">
                    {t('store.account.loginLink')}
                </Link>
            </p>
        </form>
    );
};
