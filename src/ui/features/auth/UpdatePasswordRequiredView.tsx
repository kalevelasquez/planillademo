import React, { useState } from 'react';
import { Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../../services/authService';
import { Button } from '../../components/Button';
import { MESSAGES } from '../../../config/constants';

import { useTranslation } from 'react-i18next';

export const UpdatePasswordRequiredView: React.FC = () => {
    const { t } = useTranslation();
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const rules = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /[0-9]/.test(password),
    };

    const isStrong = Object.values(rules).every(Boolean);

    const handleSubmit = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setError(null);
        setSuccessMessage(null);

        if (!isStrong) {
            setError(MESSAGES.ERROR.PWD_REQUIREMENTS);
            return;
        }

        setIsSubmitting(true);
        try {
            const { error: updateError } = await supabase.auth.updateUser({
                password: password
            });

            if (updateError) throw updateError;

            // Auditoría (CA1)
            import('../../../services/auditService').then(({ auditService }) => {
                supabase.auth.getUser().then(({ data }) => {
                    if (data.user) {
                        auditService.logAuthEvent('PASSWORD_CHANGE', data.user.email || '', data.user.id);
                    }
                });
            });

            setSuccessMessage(t('users.password_changed'));
            // You might want to redirect the user or let parent component handle this state.
            // window.location.href = '/'; 
        } catch (err: any) {
            console.error('Error updating password:', err);
            setError(err.message || MESSAGES.ERROR.UPDATE_PWD);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-md">
            <div className="w-full max-w-[400px] bg-white p-lg rounded-lg shadow-cards border border-border">
                <div className="flex flex-col items-center mb-md text-center">
                    <div className="w-16 h-16 bg-primary-light rounded-pill flex items-center justify-center mb-md">
                        <Lock className="text-primary w-8 h-8" />
                    </div>
                    <h1 className="text-h1 text-heading">{t('users.force_pass_title')}</h1>
                    <p className="text-text-secondary text-body mt-xs">
                        {t('users.force_pass_desc')}
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-md">
                    <div className="flex flex-col gap-xs">
                        <label className="text-overline text-text-secondary uppercase">
                            {t('users.new_password')}
                        </label>
                        <div className="relative">
                            <div className="absolute left-md top-1/2 -translate-y-1/2 text-text-secondary">
                                <Lock size={18} />
                            </div>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                className="w-full bg-white border-1.5 border-border rounded-sm px-md py-sm pl-[44px] pr-[44px] text-body focus:border-primary focus:ring-4 focus:ring-primary/15 outline-none transition-all"
                                placeholder={t('auth.password_placeholder')}
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

                    {/* Strength Indicator */}
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
                        <div className="p-sm bg-error/10 border border-error/20 rounded-sm text-error text-caption font-medium text-center">
                            {error}
                        </div>
                    )}

                    {successMessage && (
                        <div className="p-sm bg-primary/10 border border-primary/20 rounded-sm text-primary-dark text-caption font-medium text-center animate-in fade-in duration-300">
                            {successMessage}
                        </div>
                    )}

                    <Button
                        type="submit"
                        isLoading={isSubmitting}
                        className="w-full mt-xs"
                        size="lg"
                        disabled={!isStrong || isSubmitting}
                    >
                        {t('common.save')}
                    </Button>
                </form>
            </div>
        </div>
    );
};
