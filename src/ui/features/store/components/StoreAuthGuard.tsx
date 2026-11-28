import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ROUTES } from '../../../../config/storePaths';
import { useStoreSessionStore } from '../../../../store/storeSessionStore';

/**
 * Guard de rutas que requieren sesion de CLIENTE de tienda (checkout, mis pedidos). Sin sesion
 * redirige al login de `/cuenta` conservando la ruta pedida en `state.from`. Es independiente de
 * `ProtectedRoute` (admin): usa solo la sesion del cliente de tienda.
 */
export const StoreAuthGuard: React.FC = () => {
    const { t } = useTranslation();
    const location = useLocation();
    const { session, status } = useStoreSessionStore();

    if (status === 'loading') {
        return (
            <div role="status" className="flex justify-center py-20">
                <span className="sr-only">{t('store.account.sessionLoading')}</span>
                <div aria-hidden="true" className="h-10 w-10 animate-spin rounded-full border-t-2 border-primary" />
            </div>
        );
    }
    if (!session) return <Navigate to={ROUTES.ACCOUNT} replace state={{ from: location }} />;
    return <Outlet />;
};
