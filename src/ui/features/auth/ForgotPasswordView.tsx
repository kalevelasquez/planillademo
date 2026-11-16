import React, { useState } from 'react';
import { Mail, KeyRound } from 'lucide-react';
import { supabase } from '../../../services/authService';
import { Button } from '../../components/Button';
import { InputField } from '../../components/InputField';
import { MESSAGES } from '../../../config/constants';

import { useTranslation, Trans } from 'react-i18next';

export const ForgotPasswordView: React.FC<{ onBackToLogin: () => void }> = ({ onBackToLogin }) => {
    const { t } = useTranslation();
    const [email, setEmail] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setError(null);
        setIsSubmitting(true);

        try {
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password`,
            });

            if (resetError) throw resetError;

            setSuccess(true);
        } catch (err: any) {
            console.error('Password reset request error:', err);
            setError(err.message || t('auth.error_invalid', { defaultValue: MESSAGES.ERROR.FORGOT_PWD }));
        } finally {
            setIsSubmitting(false);
        }
    };

    if (success) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center p-md">
                <div className="w-full max-w-[400px] bg-white p-lg rounded-lg shadow-cards border border-border text-center">
                    <div className="w-16 h-16 bg-primary-light rounded-pill flex items-center justify-center mx-auto mb-md">
                        <Mail className="text-primary w-8 h-8" />
                    </div>
                    <h1 className="text-h1 text-heading">{t('auth.forgot_success_title')}</h1>
                    <p className="text-text-secondary text-body mt-xs mb-md">
                        <Trans
                            i18nKey="auth.forgot_success_desc"
                            values={{ email }}
                            components={[<b key="email" />]}
                        />
                    </p>
                    <Button onClick={onBackToLogin} className="w-full mt-sm" size="lg">
                        {t('auth.forgot_success_back')}
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-md">
            <div className="w-full max-w-[400px] bg-white p-lg rounded-lg shadow-cards border border-border">
                <div className="flex flex-col items-center mb-md text-center">
                    <div className="w-16 h-16 bg-primary-light rounded-pill flex items-center justify-center mb-md">
                        <KeyRound className="text-primary w-8 h-8" />
                    </div>
                    <h1 className="text-h1 text-heading">{t('auth.forgot_title')}</h1>
                    <p className="text-text-secondary text-body mt-xs">
                        {t('auth.forgot_desc')}
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-md">
                    <InputField
                        id="email"
                        label={t('auth.email_label')}
                        type="email"
                        placeholder={t('auth.email_placeholder')}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        icon={<Mail size={20} />}
                        required
                        disabled={isSubmitting}
                    />

                    {error && (
                        <div className="p-sm bg-error/10 border border-error/20 rounded-sm text-error text-caption font-medium text-center">
                            {error}
                        </div>
                    )}

                    <Button
                        type="submit"
                        isLoading={isSubmitting}
                        className="w-full mt-xs"
                        size="lg"
                        disabled={!email || isSubmitting}
                    >
                        {t('auth.forgot_submit')}
                    </Button>

                    <button
                        type="button"
                        onClick={onBackToLogin}
                        className="text-primary hover:text-primary-dark text-caption font-semibold mt-sm underline underline-offset-2 transition-colors"
                        disabled={isSubmitting}
                    >
                        {t('auth.forgot_cancel')}
                    </button>
                </form>
            </div>
        </div>
    );
};
