import React from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { useNetworkHealth } from '../../hooks/useNetworkHealth';
import { Button } from './Button';
import { Banner } from './Banner';

export interface NetworkStatusBannerProps {
    forceVisible?: boolean;
    isInline?: boolean;
}

export const NetworkStatusBanner: React.FC<NetworkStatusBannerProps> = ({ forceVisible, isInline }) => {
    const { isOnline, isRetrying, retryNow } = useNetworkHealth();

    if (isOnline && !forceVisible) return null;

    const bannerContent = (
        <Banner
            variant="warning"
            title={isRetrying ? 'Reconectando...' : 'Sin conexión'}
            description={isRetrying ? 'Buscando red...' : 'Revisa tu conexión'}
            icon={
                isRetrying ? (
                    <RefreshCw size={20} className="animate-spin" />
                ) : (
                    <WifiOff size={20} />
                )
            }
            action={
                !isRetrying && (
                    <Button
                        variant="warning"
                        size="sm"
                        onClick={retryNow}
                    >
                        Reintentar
                    </Button>
                )
            }
            className={isInline ? "" : "shadow-cards"}
        />
    );

    if (isInline) {
        return <div className="mb-4">{bannerContent}</div>;
    }

    return (
        <div className="fixed top-4 right-4 z-[9999] animate-in slide-in-from-right-4 fade-in duration-300 min-w-[320px] max-w-[24rem]">
            {bannerContent}
        </div>
    );
};
