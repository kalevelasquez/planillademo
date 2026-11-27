import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '../../config/supabaseClient';
import { ROUTES } from '../../config/storePaths';

/**
 * Gate INTERINO de "/" (B2). Existe solo hasta que la landing publica (B4) ocupe esa ruta.
 *
 * Mantiene el comportamiento previo para quien entra a "/" (PWA instaladas con start_url '/',
 * links viejos, Site URL de Supabase):
 *   - con sesion admin  -> /inicio (el dashboard, que ya no vive en "/")
 *   - sin sesion        -> /login
 *
 * NO ejecuta el bootstrap admin (perfil/permisos): solo lee la sesion local del cliente admin.
 * Conserva `search` y `hash` para que los errores/tokens de enlaces de email que caen en el
 * Site URL (ej. `#error_code=otp_expired`) lleguen intactos a AdminApp.
 *
 * TODO(B4): reemplazar este gate por `LandingPage` en `PublicApp`.
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
