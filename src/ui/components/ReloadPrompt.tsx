import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { setupSwUpdateChecks } from '../../utils/swUpdate';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';

/**
 * Con registerType 'autoUpdate' las versiones nuevas se activan y recargan la pagina solas
 * (vite-plugin-pwa), asi que aca solo queda el aviso "lista para usar sin conexion" y el chequeo
 * periodico de updates (ver swUpdate.ts).
 */
const ReloadPrompt: React.FC = () => {
    const { t } = useTranslation();
    const {
        offlineReady: [offlineReady, setOfflineReady],
    } = useRegisterSW({
        onRegisteredSW(_url: string, r: ServiceWorkerRegistration | undefined) {
            cleanupRef.current?.();
            cleanupRef.current = setupSwUpdateChecks(r);
        },
        onRegisterError(error: unknown) {
            console.log('SW registration error', error);
        },
    });
    const cleanupRef = useRef<(() => void) | null>(null);
    useEffect(() => () => cleanupRef.current?.(), []);

    if (!offlineReady) return null;

    return (
        <div className="fixed bottom-6 right-6 z-[9999] transition-all duration-300">
            <div className="bg-white rounded-2xl shadow-2xl border border-border p-5 max-w-[400px] backdrop-blur-md bg-white/95">
                <div className="flex items-start gap-4">
                    <div className="bg-primary/10 p-3 rounded-xl shrink-0">
                        <RefreshCw size={24} className="text-primary animate-spin-slow" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold text-heading">{t('pwa.offline_ready_title')}</h4>
                        <p className="text-xs text-text-secondary mt-1 leading-relaxed">{t('pwa.offline_ready_desc')}</p>
                        <div className="mt-4 flex items-center gap-2">
                            <button
                                onClick={() => setOfflineReady(false)}
                                className="px-4 py-2 border border-border text-xs font-bold text-text-secondary rounded-lg hover:bg-surface transition-all active:scale-95 flex items-center gap-2"
                            >
                                <X size={14} />
                                {t('pwa.close')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReloadPrompt;
