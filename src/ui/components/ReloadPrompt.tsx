import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';

const ReloadPrompt: React.FC = () => {
    const {
        offlineReady: [offlineReady, setOfflineReady],
        needRefresh: [needRefresh, setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegistered(r: ServiceWorkerRegistration | undefined) {
            console.log('SW Registered: ' + r);
        },
        onRegisterError(error: unknown) {
            console.log('SW registration error', error);
        },
    });

    const close = () => {
        setOfflineReady(false);
        setNeedRefresh(false);
    };

    if (!offlineReady && !needRefresh) return null;

    return (
        <div className="fixed bottom-6 right-6 z-[9999] transition-all duration-300">
            <div className="bg-white rounded-2xl shadow-2xl border border-border p-5 max-w-[400px] backdrop-blur-md bg-white/95">
                <div className="flex items-start gap-4">
                    <div className="bg-primary/10 p-3 rounded-xl shrink-0">
                        <RefreshCw size={24} className="text-primary animate-spin-slow" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold text-heading">
                            {offlineReady ? 'App lista para usar sin conexión' : '¡Nueva versión disponible!'}
                        </h4>
                        <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                            {offlineReady
                                ? 'La aplicación se ha optimizado para trabajar incluso sin internet.'
                                : 'Hay cambios importantes. Actualiza para disfrutar de las últimas mejoras.'}
                        </p>
                        <div className="mt-4 flex items-center gap-2">
                            {needRefresh && (
                                <button
                                    onClick={() => updateServiceWorker(true)}
                                    className="px-4 py-2 bg-primary text-white text-xs font-bold rounded-lg shadow-md shadow-primary/20 hover:bg-primary-dark transition-all active:scale-95"
                                >
                                    Actualizar ahora
                                </button>
                            )}
                            <button
                                onClick={close}
                                className="px-4 py-2 border border-border text-xs font-bold text-text-secondary rounded-lg hover:bg-surface transition-all active:scale-95 flex items-center gap-2"
                            >
                                <X size={14} />
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReloadPrompt;
