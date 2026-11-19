import React, { useState, useEffect } from 'react';
import { Mail, Lock } from 'lucide-react';
import BrandLogo from '../../../assets/images/logo-teknergy.png';
import { authService } from '../../../services/authService';
import { useAuthStore } from '../../../store/authStore';
import { Button } from '../../components/Button';
import { InputField } from '../../components/InputField';
import { useTranslation } from 'react-i18next';

interface LoginViewProps {
    onForgotPassword: () => void;
    initialError?: string | null;
}

export const LoginView: React.FC<LoginViewProps> = ({ onForgotPassword, initialError }) => {
    const { t } = useTranslation();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(initialError || null);

    useEffect(() => {
        if (initialError) {
            setError(initialError);
        }
    }, [initialError]);

    const setAuth = useAuthStore((state) => state.setAuth);

    const handleSubmit = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setError(null);
        setIsSubmitting(true);

        try {
            const result = await authService.login(email, password);
            if (result) {
                setAuth(result.profile);
            }
        } catch (err: any) {
            console.error('Login error:', err);
            setError(err.message || t('auth.error_invalid'));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-md">
            <div className="w-full max-w-[400px] bg-white p-lg rounded-lg shadow-cards border border-border">
                {/* Header con estilo de Design System */}
                <div className="flex flex-col items-center mb-xl">
                    <img src={BrandLogo} alt="Logo Teknergy" className="h-20 w-auto max-w-full object-contain" />
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

                    <InputField
                        id="password"
                        label={t('auth.password_label')}
                        type="password"
                        placeholder={t('auth.password_placeholder')}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        icon={<Lock size={20} />}
                        required
                        disabled={isSubmitting}
                    />

                    {error && (
                        <div className="p-sm bg-error/10 border border-error/20 rounded-sm text-error text-caption font-medium">
                            <span>{error}</span>
                        </div>
                    )}

                    <Button
                        type="submit"
                        isLoading={isSubmitting}
                        className="w-full mt-sm"
                        size="lg"
                    >
                        {t('auth.login_button')}
                    </Button>

                    <button
                        type="button"
                        onClick={onForgotPassword}
                        className="text-primary hover:text-primary-dark text-caption font-semibold mt-sm underline underline-offset-2 transition-colors"
                        disabled={isSubmitting}
                    >
                        {t('auth.forgot_password')}
                    </button>

                    <footer className="mt-lg text-center">
                        <p className="text-caption text-text-secondary">
                            © 2026 Teknergy Inc. — v1.0
                        </p>
                    </footer>
                </form>
            </div>
        </div>
    );
};
