import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '../../config/supabaseClient';
import { ROUTES } from '../../config/storePaths';

/**
 * Gate de enlaces de email de Supabase en "/" (Site URL). Desde B4 "/" es la landing publica; este
 * gate SOLO se usa cuando la URL trae un enlace de auth admin (ver `hasAuthLinkParams` y App.tsx):
 * invitacion, recovery o error (`otp_expired`, `error_description`...). Esos enlaces siguen
 * llegando al flujo admin:
 *   - con sesion admin  -> /inicio (el cliente admin ya canjeo el token de la URL)
 *   - sin sesion        -> /login
 *
 * NO ejecuta el bootstrap admin (perfil/permisos): solo lee la sesion local del cliente admin.
 * Conserva `search` y `hash` para que los tokens/errores lleguen intactos a AdminApp.
 */
export function RootGate() {
    const location = useLocation();
    const [target, setTarget] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        supabase.auth
            .getSession()
            .then(({ data }) => {
                if (!cancelled) setTarget(data?.session ? ROUTES.ADMIN_HOME : ROUTES.LOGIN);
            })
            .catch(() => {
                if (!cancelled) setTarget(ROUTES.LOGIN);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    if (!target) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-primary" />
            </div>
        );
    }

    return <Navigate to={{ pathname: target, search: location.search, hash: location.hash }} replace />;
}
