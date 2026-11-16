import React, { useState } from 'react';
import { Lock, Eye, EyeOff, CheckCircle2, ShieldAlert } from 'lucide-react';
import { supabase } from '../../../services/authService';
import { Button } from '../../components/Button';
import { useTranslation } from 'react-i18next';

export const ForcePasswordChangeView: React.FC = () => {
    const { t } = useTranslation();
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSuccess, setIsSuccess] = useState(false);

    const rules = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /[0-9]/.test(password),
        match: password === confirmPassword && password !== '',
    };

    const isStrong = Object.values(rules).every(Boolean);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setError(null);

        if (!isStrong) {
            setError(t('auth.error_pwd_requirements'));
            return;
        }

        setIsSubmitting(true);
        try {
            // 1. Actualizar contraseña y LIMPIAR el flag de metadata
            const { error: updateError } = await supabase.auth.updateUser({
                password: password,
                data: { needs_password_change: false } // Limpiamos el flag
            });

            if (updateError) throw updateError;

            // Auditoría (CA1)
            supabase.auth.getUser().then(({ data }) => {
                const user = data.user;
                if (user) {
                    import('../../../services/auditService').then(({ auditService }) => {
                        auditService.logAuthEvent('PASSWORD_CHANGE', user.email || 'Sesión forzada', user.id);
                    });
                }
            });

            setIsSuccess(true);

            // 2. Refresh de la página para recargar el estado del AuthStore y entrar al dashboard
            setTimeout(() => {
                window.location.reload();
            }, 2000);

        } catch (error: any) {
            console.error('Error al forzar cambio de clave:', error);
            setError(error.message || t('common.unknown_error'));
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-500">
            <div className="w-full max-w-[32rem] min-w-0 sm:min-w-[440px] bg-white rounded-3xl shadow-xl border border-border overflow-hidden">
                <div className="h-2 bg-primary w-full" />

                <div className="p-6 sm:p-10">
                    {isSuccess ? (
                        <div className="text-center space-y-4 py-8 animate-in zoom-in-95">
                            <div className="w-20 h-20 bg-success/10 text-success rounded-full flex items-center justify-center mx-auto mb-6">
                                <CheckCircle2 size={40} />
                            </div>
                            <h2 className="text-2xl font-display font-bold text-heading">
                                {t('users.password_changed')}
                            </h2>
                            <p className="text-text-secondary">
                                {t('users.force_pass_success')}
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="flex flex-col items-center text-center mb-8">
                                <div className="w-16 h-16 bg-warning/10 text-warning rounded-2xl flex items-center justify-center mb-4">
                                    <ShieldAlert size={32} />
                                </div>
                                <h2 className="text-2xl font-display font-bold text-heading">
                                    {t('users.force_pass_title')}
                                </h2>
                                <p className="text-text-secondary mt-2 text-sm">
                                    {t('users.force_pass_desc')}
                                </p>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-6">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-heading uppercase tracking-wider">
                                        {t('users.new_password')}
                                    </label>
                                    <div className="relative">
                                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary">
                                            <Lock size={18} />
                                        </div>
                                        <input
                                            type={showPassword ? 'text' : 'password'}
                                            className="w-full h-12 bg-surface/50 border border-border rounded-xl pl-11 pr-12 focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none transition-all text-sm font-medium italic"
                                            placeholder={t('users.force_pass_placeholder')}
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            required
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary hover:text-primary transition-colors"
                                        >
                                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-heading uppercase tracking-wider">
                                        {t('users.confirm_password')}
                                    </label>
                                    <div className="relative">
                                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary">
                                            <Lock size={18} />
                                        </div>
                                        <input
                                            type={showPassword ? 'text' : 'password'}
                                            className="w-full h-12 bg-surface/50 border border-border rounded-xl pl-11 pr-4 focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none transition-all text-sm font-medium italic"
                                            placeholder={t('users.force_pass_confirm_placeholder')}
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            required
                                        />
                                    </div>
                                </div>

                                {/* Checklist de requisitos */}
                                <div className="bg-surface/30 p-4 rounded-2xl border border-border space-y-2">
                                    <p className="text-[11px] font-bold text-heading uppercase tracking-tight mb-2 opacity-60">
                                        {t('users.force_pass_requirements_title')}
                                    </p>
                                    <div className="grid grid-cols-1 gap-y-2">
                                        <RequirementItem met={rules.length} label={t('auth.reset_rule_length')} />
                                        <RequirementItem met={rules.uppercase} label={t('auth.reset_rule_uppercase')} />
                                        <RequirementItem met={rules.lowercase} label={t('auth.reset_rule_lowercase')} />
                                        <RequirementItem met={rules.number} label={t('auth.reset_rule_number')} />
                                        <RequirementItem met={rules.match} label={t('auth.setup_match')} />
                                    </div>
                                </div>

                                {error && (
                                    <div className="p-3 bg-error/10 border border-error/20 rounded-xl text-error text-[13px] font-medium text-center italic">
                                        {error}
                                    </div>
                                )}

                                <Button
                                    type="submit"
                                    className="w-full h-12 shadow-md shadow-primary/20"
                                    disabled={!isStrong || isSubmitting}
                                    isLoading={isSubmitting}
                                >
                                    {t('users.save_and_continue')}
                                </Button>
                            </form>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

const RequirementItem: React.FC<{ met: boolean; label: string }> = ({ met, label }) => (
    <div className={`flex items-center gap-2 text-xs transition-colors ${met ? 'text-success' : 'text-text-secondary opacity-60'}`}>
        <CheckCircle2 size={14} className={met ? 'text-success' : 'text-border'} />
        <span className={met ? 'font-medium' : ''}>{label}</span>
    </div>
);
