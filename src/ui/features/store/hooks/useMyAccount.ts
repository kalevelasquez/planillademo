import { useEffect, useState } from 'react';
import { getMyAccount, type StoreAccount } from '../../../../services/storeService';

/** Datos de contacto/entrega del cliente. Un fallo no es fatal: devuelve `null` (la UI omite el bloque). */
export function useMyAccount(): StoreAccount | null {
    const [account, setAccount] = useState<StoreAccount | null>(null);

    useEffect(() => {
        let cancelled = false;
        getMyAccount()
            .then((a) => {
                if (!cancelled) setAccount(a);
            })
            .catch(() => {
                if (!cancelled) setAccount(null);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return account;
}
