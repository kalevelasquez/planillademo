import { createClient } from '@supabase/supabase-js'
import { isStorePath } from './storePaths'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase URL or Anon Key is missing. Check your .env.local file.')
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
    auth: {
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        autoRefreshToken: true,
        persistSession: true,
        // H5: en /tienda* y /cuenta* este cliente NO debe tocar la URL (capturaria el token de
        // confirmacion de la tienda). En el resto de rutas (incluida "/") sigue activo.
        detectSessionInUrl: !(typeof window !== 'undefined' && isStorePath(window.location.pathname)),
    }
})

// Desfibrilador de Pestañas: Revive la conexión de Supabase cuando el usuario regresa a la app
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            // Fuerza a Supabase a verificar la sesión y reconectar sockets en segundo plano
            supabase.auth.getSession().catch(console.error);
        }
    });
}
