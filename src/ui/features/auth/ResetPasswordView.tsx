import React, { useState, useEffect } from 'react';
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import { supabase } from '../../../services/authService';
import { Button } from '../../components/Button';
import { MESSAGES } from '../../../config/constants';

import { useTranslation } from 'react-i18next';

export const ResetPasswordView: React.FC = () => {
    const { t } = useTranslation();
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSuccess, setIsSuccess] = useState(false);
    const [isVerifying, setIsVerifying] = useState(true);
    const [isInvalidLink, setIsInvalidLink] = useState(false);

    // Requisitos de contraseña
    const rules = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /[0-9]/.test(password),
    };

    const isStrong = Object.values(rules).every(Boolean);

    // 1. Verificar sesión de recuperación al montar
    useEffect(() => {
        const verifyRecoverySession = async () => {
            // Esperar un momento breve para que Supabase procese el hash de la URL si acaba de llegar
            await new Promise(resolve => setTimeout(resolve, 1000));

            const { data: { session } } = await supabase.auth.getSession();

            if (!session) {
                // Si no hay sesión, verificamos si hay un error en la URL
                const hash = window.location.hash;
                if (hash.includes('error=')) {
                    setIsInvalidLink(true);
                } else {
                    // Si no hay error pero no hay sesión, el enlace probablemente ya se usó o expiró
                    setIsInvalidLink(true);
                }
            }
            setIsVerifying(false);
        };

        verifyRecoverySession();
    }, []);

    const handleSubmit = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setError(null);

        if (!isStrong) {
            setError(MESSAGES.ERROR.RESET_PWD_REQUIREMENTS);
            return;
        }

        setIsSubmitting(true);
        try {
            const { data: sessionData } = await supabase.auth.getSession();

            if (!sessionData.session) {
                throw new Error(t('auth.reset_session_expired', { defaultValue: 'La sesión de recuperación ha expirado. Por favor solicita un nuevo enlace.' }));
            }

            const { error: resetError } = await supabase.auth.updateUser({
                password: password
            });

            if (resetError) throw resetError;

            // Auditoría (CA1)
            import('../../../services/auditService').then(({ auditService }) => {
                const sessionEmail = sessionData.session?.user?.email || t('common.unknown');
                const sessionUserId = sessionData.session?.user?.id;
                auditService.logAuthEvent('PASSWORD_CHANGE', sessionEmail, sessionUserId);
            });

            setIsSuccess(true);

            // Destruir la sesión actual temporal
            await supabase.auth.signOut();

            // Limpiar URL
            window.history.replaceState(null, '', window.location.pathname);

            // Redirección después de éxito
            setTimeout(() => {
                window.location.href = '/login';
            }, 3000);

        } catch (error: any) {
            setError(error.message || t('auth.reset_error', { defaultValue: 'Error al restablecer la contraseña.' }));
            setIsSubmitting(false);
        }
    };

    const handleBackToLogin = () => {
        window.location.href = '/login';
    };

    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-md">
            <div className="w-full max-w-[400px] bg-white p-lg rounded-lg shadow-cards border border-border">

                {isVerifying ? (
                    <div className="flex flex-col items-center justify-center py-xl text-center">
                        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-md"></div>
                        <h2 className="text-h3 text-heading">{t('auth.reset_verifying')}</h2>
                        <p className="text-text-secondary text-caption mt-xs">{t('auth.reset_verifying_desc')}</p>
                    </div>
                ) : isInvalidLink ? (
                    <div className="flex flex-col items-center justify-center py-xl text-center animate-in fade-in zoom-in-95 duration-300">
                        <div className="w-20 h-20 bg-error/10 rounded-pill flex items-center justify-center mb-md">
                            <AlertCircle className="text-error w-10 h-10" />
                        </div>
                        <h1 className="text-h2 text-heading mb-xs">{t('auth.reset_invalid_title')}</h1>
                        <p className="text-text-secondary text-body mb-lg">
                            {t('auth.reset_invalid_desc')}
                        </p>
                        <Button onClick={handleBackToLogin} className="w-full" variant="secondary">
                            <ArrowLeft size={18} className="mr-2" />
                            {t('auth.reset_invalid_back')}
                        </Button>
                    </div>
                ) : isSuccess ? (
                    <div className="flex flex-col items-center justify-center py-xl text-center animate-fade-in">
                        <div className="w-20 h-20 bg-primary/10 rounded-pill flex items-center justify-center mb-md scale-in">
                            <CheckCircle2 className="text-primary w-10 h-10" />
                        </div>
                        <h1 className="text-h1 text-heading mb-xs">{t('auth.reset_success_title')}</h1>
                        <p className="text-text-secondary text-body mb-lg">
                            {t('auth.reset_success_desc')}
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="flex flex-col items-center mb-md text-center">
                            <div className="w-16 h-16 bg-primary-light rounded-pill flex items-center justify-center mb-md">
                                <Lock className="text-primary w-8 h-8" />
                            </div>
                            <h1 className="text-h1 text-heading">{t('auth.reset_title')}</h1>
                            <p className="text-text-secondary text-body mt-xs">
                                {t('auth.reset_desc')}
                            </p>
                        </div>

                        <form onSubmit={handleSubmit} className="flex flex-col gap-md">
                            <div className="flex flex-col gap-xs">
                                <label className="text-overline text-text-secondary uppercase font-bold text-[10px]">
                                    {t('auth.reset_new_password')}
                                </label>
                                <div className="relative">
                                    <div className="absolute left-md top-1/2 -translate-y-1/2 text-text-secondary">
                                        <Lock size={18} />
                                    </div>
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        className="w-full bg-white border-1.5 border-border rounded-sm px-md py-sm pl-[44px] pr-[44px] text-body focus:border-primary focus:ring-4 focus:ring-primary/15 outline-none transition-all"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-md top-1/2 -translate-y-1/2 text-text-secondary hover:text-heading transition-colors"
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>

                            <div className="bg-background-light p-sm rounded-sm border border-border">
                                <p className="text-caption font-semibold text-heading mb-xs">{t('auth.reset_requirements')}</p>
                                <ul className="flex flex-col gap-[2px]">
                                    <li className={`flex items-center gap-xs text-caption transition-colors ${rules.length ? 'text-primary' : 'text-text-secondary'}`}>
                                        <CheckCircle2 size={14} className={rules.length ? 'text-primary' : 'text-border'} />
                                        <span>{t('auth.reset_rule_length')}</span>
                                    </li>
                                    <li className={`flex items-center gap-xs text-caption transition-colors ${rules.uppercase ? 'text-primary' : 'text-text-secondary'}`}>
                                        <CheckCircle2 size={14} className={rules.uppercase ? 'text-primary' : 'text-border'} />
                                        <span>{t('auth.reset_rule_uppercase')}</span>
                                    </li>
                                    <li className={`flex items-center gap-xs text-caption transition-colors ${rules.lowercase ? 'text-primary' : 'text-text-secondary'}`}>
                                        <CheckCircle2 size={14} className={rules.lowercase ? 'text-primary' : 'text-border'} />
                                        <span>{t('auth.reset_rule_lowercase')}</span>
                                    </li>
                                    <li className={`flex items-center gap-xs text-caption transition-colors ${rules.number ? 'text-primary' : 'text-text-secondary'}`}>
                                        <CheckCircle2 size={14} className={rules.number ? 'text-primary' : 'text-border'} />
                                        <span>{t('auth.reset_rule_number')}</span>
                                    </li>
                                </ul>
                            </div>

                            {error && (
                                <div className="p-sm bg-error/10 border border-error/20 rounded-sm text-error text-caption font-medium text-center animate-shake">
                                    {error}
                                </div>
                            )}

                            <Button
                                type="submit"
                                isLoading={isSubmitting}
                                className="w-full mt-xs shadow-lg shadow-primary/20"
                                size="lg"
                                disabled={!isStrong || isSubmitting}
                            >
                                {t('auth.reset_submit')}
                            </Button>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
};

