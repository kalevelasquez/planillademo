import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, X, Share } from 'lucide-react';
import { Button } from './Button';

/**
 * PWAInstallPrompt
 * Detecta y gestiona la invitación a instalar la PWA (US-PWA-01).
 * Soporta disparador nativo en Chromium y guía manual en iOS.
 */
export const PWAInstallPrompt: React.FC = () => {
    const { t } = useTranslation();
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [isIOS, setIsIOS] = useState(false);
    const [isStandalone, setIsStandalone] = useState(false);

    useEffect(() => {
        // 1. Verificar si ya está en modo standalone (PWA ya abierta)
        const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches
            || (window.navigator as any).standalone
            || document.referrer.includes('android-app://');

        setIsStandalone(isStandaloneMode);

        // 2. Detectar iOS
        const userAgent = window.navigator.userAgent.toLowerCase();
        const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
        setIsIOS(isIOSDevice);

        // 3. Escuchar evento de instalación (Chromium)
        const handleBeforeInstallPrompt = (e: any) => {
            e.preventDefault();
            setDeferredPrompt(e);

            // Solo mostramos si no estamos ya en standalone y han pasado unos segundos
            if (!isStandaloneMode) {
                setTimeout(() => setIsVisible(true), 5000);
            }
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        // 4. Lógica para iOS (No tiene evento, mostramos por user agent si no es standalone)
        if (isIOSDevice && !isStandaloneMode) {
            // Revisar si ya fue cerrado en esta sesión para no ser intrusivos
            const wasDismissed = sessionStorage.getItem('pwa-prompt-dismissed');
            if (!wasDismissed) {
                setTimeout(() => setIsVisible(true), 8000);
            }
        }

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        };
    }, []);

    const handleInstallClick = async () => {
        if (!deferredPrompt) return;

        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;

        if (outcome === 'accepted') {
            setDeferredPrompt(null);
            setIsVisible(false);
        }
    };

    const handleClose = () => {
        setIsVisible(false);
        sessionStorage.setItem('pwa-prompt-dismissed', 'true');
    };

    // No mostrar si ya está instalado o no es visible
    if (isStandalone || !isVisible) return null;

    return (
        <div className="fixed bottom-10 inset-x-0 mx-auto w-[92%] sm:w-[85%] md:w-full max-w-[32rem] z-[100] animate-slide-up">
            <div className="w-full bg-heading text-white p-6 md:p-8 rounded-2xl shadow-2xl border border-white/10 relative overflow-hidden">
                {/* Background Decoration */}
                <div className="absolute -top-12 -right-12 w-32 h-32 bg-primary/20 rounded-full blur-3xl pointer-events-none" />

                <button
                    onClick={handleClose}
                    className="absolute top-3 right-3 p-1 text-white/40 hover:text-white transition-colors"
                >
                    <X size={20} />
                </button>

                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 shrink-0 bg-primary/20 rounded-xl flex items-center justify-center text-primary-light">
                        {isIOS ? <Share size={24} /> : <Download size={24} />}
                    </div>

                    <div className="flex-1">
                        <h4 className="font-display font-bold text-xl mb-1">{t('pwa.install_title')}</h4>
                        <p className="text-white/70 text-base leading-relaxed">
                            {isIOS ? t('pwa.ios_msg') : t('pwa.install_desc')}
                        </p>
                    </div>
                </div>

                {!isIOS && deferredPrompt && (
                    <div className="mt-6 flex flex-col sm:flex-row sm:justify-end gap-3">
                        <Button
                            variant="primary"
                            className="w-full sm:w-auto py-1 px-6 text-sm h-10 shadow-lg shadow-primary/20 font-bold"
                            onClick={handleInstallClick}
                        >
                            {t('pwa.install_button')}
                        </Button>
                        <button
                            onClick={handleClose}
                            className="w-full sm:w-auto bg-white/5 hover:bg-white/10 text-white/80 text-sm font-bold rounded-lg transition-colors border border-white/10 h-10 px-6"
                        >
                            {t('pwa.not_now')}
                        </button>
                    </div>
                )}

                {isIOS && (
                    <div className="mt-4 pt-4 border-t border-white/10">
                        <button
                            onClick={handleClose}
                            className="w-full text-center text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors py-1"
                        >
                            {t('pwa.not_now')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
