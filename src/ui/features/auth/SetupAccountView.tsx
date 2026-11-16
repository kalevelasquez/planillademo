import React, { useState } from 'react';
import { supabase } from '../../../services/authService';
import { useAuthStore } from '../../../store/authStore';
import { Button } from '../../components/Button';
import { InputField } from '../../components/InputField';
import { CheckCircle2, Eye, EyeOff, Lock, Phone, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SetupAccountViewProps {
    onComplete: () => void;
}

export const SetupAccountView: React.FC<SetupAccountViewProps> = ({ onComplete }) => {
    const { t } = useTranslation();
    const { profile, setAuth } = useAuthStore();
    const [fullName, setFullName] = useState(profile?.full_name || '');
    const [phone, setPhone] = useState(profile?.phone || '');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const rules = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /[0-9]/.test(password),
        match: password === confirmPassword && password.length > 0
    };

    const isStrong = Object.values(rules).every(Boolean);

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let rawValue = e.target.value.replace(/\D/g, '');

        if (rawValue.length > 8) {
            rawValue = rawValue.slice(0, 8);
        }

        let formattedValue = rawValue;
        if (rawValue.length > 4) {
            formattedValue = `${rawValue.slice(0, 4)}-${rawValue.slice(4)}`;
        }

        setPhone(formattedValue);
    };

    const handleSubmit = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        if (isLoading) return;
        setError(null);

        if (!isStrong) {
            setError(t('auth.error_pwd_requirements'));
            return;
        }

        if (!fullName.trim()) {
            setError(t('auth.error_fullname_required'));
            return;
        }

        if (phone.length !== 9) { // 4 digits + dash + 4 digits = 9
            setError(t('auth.error_phone_digits'));
            return;
        }

        setIsLoading(true);

        try {
            // Paso 1: Update Password
            const { data: authData, error: authError } = await supabase.auth.updateUser({ password });

            if (authError) throw authError;
            if (!authData.user) throw new Error(t('common.unknown_error'));

            // Auditoría (CA1)
            import('../../../services/auditService').then(({ auditService }) => {
                const user = authData.user;
                if (user) {
                    auditService.logAuthEvent('PASSWORD_CHANGE', user.email || 'Configuración inicial', user.id);
                }
            });

            // Paso 2: Update Profile
            const { error: profileError } = await supabase
                .from('user_profiles')
                .update({ full_name: fullName, phone: phone.replace('-', '') })
                .eq('id', authData.user.id);

            if (profileError) {
                console.error("Profile update error:", profileError);
                setError(t('auth.error_profile_saving'));
                setIsLoading(false);
                return;
            }

            // Éxito completo: Actualizar store local con nuevos datos (re-fetch rápido)
            const { data: updatedProfile } = await supabase
                .from('user_profiles')
                .select('*')
                .eq('id', authData.user.id)
                .single();

            if (updatedProfile) {
                setAuth(updatedProfile);
            }

            // Limpiamos URL para no volver a entrar a setup-account en refresh
            window.history.replaceState(null, '', window.location.pathname);

            // Avisar a App.tsx que terminó
            onComplete();

        } catch (err: any) {
            console.error('Error setup account:', err);
            setError(err.message || t('auth.error_setup_account'));
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-md">
            <div className="w-full max-w-[450px] bg-white p-lg rounded-lg shadow-cards border border-border">
                <div className="flex flex-col items-center mb-md text-center">
                    <div className="w-16 h-16 bg-primary-light rounded-pill flex items-center justify-center mb-md">
                        <User className="text-primary w-8 h-8" />
                    </div>
                    <h1 className="text-h1 text-heading">{t('auth.setup_welcome')}</h1>
                    <p className="text-text-secondary text-body mt-xs">
                        {t('auth.setup_desc')}
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-md">
                    <InputField
                        label={t('auth.setup_full_name')}
                        placeholder="Ej: Juan Pérez"
                        icon={<User size={18} />}
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                        disabled={isLoading}
                    />

                    <div className="flex flex-col gap-xs">
                        <label className="text-overline text-text-secondary uppercase">
                            {t('auth.setup_phone')}
                        </label>
                        <div className="flex w-full items-stretch border-1.5 border-border rounded-sm focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15 transition-all bg-white overflow-hidden">
                            <div className="flex items-center justify-center bg-surface px-md border-r border-border gap-sm select-none">
                                <Phone size={18} className="text-text-secondary" />
                                <span className="text-body font-medium text-text-secondary">+503</span>
                            </div>
                            <input
                                type="tel"
                                className="w-full px-md py-sm text-body transition-all outline-none placeholder:text-text-secondary/50"
                                placeholder={t('auth.setup_phone_placeholder')}
                                value={phone}
                                onChange={handlePhoneChange}
                                disabled={isLoading}
                                required
                            />
                        </div>
                    </div>

                    <div className="flex flex-col gap-xs mt-sm">
                        <label className="text-overline text-text-secondary uppercase">
                            {t('auth.setup_new_password')}
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
                                disabled={isLoading}
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

                    <div className="flex flex-col gap-xs">
                        <label className="text-overline text-text-secondary uppercase">
                            {t('auth.setup_confirm_password')}
                        </label>
                        <div className="relative">
                            <div className="absolute left-md top-1/2 -translate-y-1/2 text-text-secondary">
                                <Lock size={18} />
                            </div>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                className="w-full bg-white border-1.5 border-border rounded-sm px-md py-sm pl-[44px] pr-[44px] text-body focus:border-primary focus:ring-4 focus:ring-primary/15 outline-none transition-all"
                                placeholder="••••••••"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                disabled={isLoading}
                                required
                            />
                        </div>
                    </div>

                    {/* Strength Indicator */}
                    <div className="bg-background-light p-sm rounded-sm border border-border">
                        <p className="text-caption font-semibold text-heading mb-xs">{t('auth.reset_requirements')}:</p>
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
                            <li className={`flex items-center gap-xs text-caption transition-colors ${rules.match ? 'text-primary' : 'text-text-secondary'}`}>
                                <CheckCircle2 size={14} className={rules.match ? 'text-primary' : 'text-border'} />
                                <span>{t('auth.setup_match')}</span>
                            </li>
                        </ul>
                    </div>

                    {error && (
                        <div className="p-sm bg-error/10 border border-error/20 rounded-sm text-error text-caption font-medium text-center">
                            {error}
                        </div>
                    )}

                    <Button
                        type="submit"
                        isLoading={isLoading}
                        className="w-full mt-xs"
                        size="lg"
                        disabled={!isStrong || !fullName.trim() || phone.length !== 9 || isLoading}
                    >
                        {isLoading ? t('auth.setup_saving') : t('auth.setup_submit')}
                    </Button>
                </form>
            </div>
        </div>
    );
};
