import { useEffect, useState } from 'react';
import { supabase } from '../../../../config/supabaseClient';

/**
 * `true` si el navegador tiene una sesion del cliente ADMIN (personal interno). Solo lee la sesion
 * local: NO ejecuta el bootstrap admin (perfil/permisos/notificaciones). Se usa unicamente para
 * ofrecer el acceso "Ir al panel" en el shell publico. Cualquier fallo => `false`.
 */
export function useStaffSession(): boolean {
    const [active, setActive] = useState(false);

    useEffect(() => {
        let cancelled = false;
        supabase.auth
            .getSession()
            .then(({ data }) => {
                if (!cancelled) setActive(!!data?.session);
            })
            .catch(() => {
                if (!cancelled) setActive(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return active;
}
