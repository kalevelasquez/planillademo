import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { getStoreSession, subscribeStoreAuth, signOutStoreCustomer } from '../services/storeAuthService';

/**
 * Sesion del CLIENTE de la tienda (cliente `storeSupabase`). Totalmente independiente de `authStore`
 * (personal interno): puede haber las dos a la vez en el mismo navegador.
 */
interface StoreSessionState {
    session: Session | null;
    /** `loading` hasta conocer si hay sesion guardada (evita parpadeos y redirects falsos). */
    status: 'loading' | 'ready';
    /** Inicia la escucha (idempotente). Devuelve el cleanup. */
    init: () => () => void;
    signOut: () => Promise<void>;
    reset: () => void;
}

let unsubscribe: (() => void) | null = null;

export const useStoreSessionStore = create<StoreSessionState>((set) => ({
    session: null,
    status: 'loading',

    init: () => {
        if (!unsubscribe) {
            unsubscribe = subscribeStoreAuth((session) => set({ session, status: 'ready' }));
            void getStoreSession().then((session) =>
                // Si onAuthStateChange ya entrego una sesion mas reciente, no se pisa con la lectura inicial.
                set((s) => (s.status === 'ready' ? s : { session, status: 'ready' })),
            );
        }
        return () => {
            unsubscribe?.();
            unsubscribe = null;
        };
    },

    signOut: async () => {
        await signOutStoreCustomer();
        set({ session: null });
    },

    reset: () => {
        unsubscribe?.();
        unsubscribe = null;
        set({ session: null, status: 'loading' });
    },
}));
