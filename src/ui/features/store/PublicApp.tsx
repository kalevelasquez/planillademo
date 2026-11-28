import React, { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StoreHeader } from './components/StoreHeader';
import { StoreFooter } from './components/StoreFooter';
import { useStaffSession } from './hooks/useStaffSession';

/**
 * Shell PUBLICO (landing, tienda). Header + contenido + footer. NO ejecuta el bootstrap admin
 * (perfil, permisos, notificaciones): lo unico "admin" que toca es leer la sesion local para
 * ofrecer "Ir al panel" al personal que ya inicio sesion. Se carga lazy desde App.tsx.
 */
const PublicApp: React.FC = () => {
    const { t } = useTranslation();
    const hasStaffSession = useStaffSession();

    return (
        <div className="flex min-h-screen flex-col bg-surface-paper">
            <StoreHeader showPanelLink={hasStaffSession} />
            <main id="contenido" tabIndex={-1} className="flex-1 outline-none">
                <Suspense
                    fallback={
                        <div role="status" className="flex justify-center py-20">
                            <span className="sr-only">{t('store.catalog.loading')}</span>
                            <div aria-hidden="true" className="h-10 w-10 animate-spin rounded-full border-t-2 border-primary" />
                        </div>
                    }
                >
                    <Outlet />
                </Suspense>
            </main>
            <StoreFooter />
        </div>
    );
};

export default PublicApp;
