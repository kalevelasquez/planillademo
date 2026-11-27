import { createClient } from '@supabase/supabase-js'
import { isAccountPath } from './storePaths'

/**
 * Cliente Supabase de la TIENDA (clientes finales). Sesion aislada del cliente admin:
 *  - `storageKey` propia: la sesion de un cliente nunca pisa la de un vendedor (ni al reves),
 *    y cerrar sesion en uno no cierra el otro.
 *  - `flowType: 'pkce'`: el code_verifier vive solo en este storage; el cliente admin no puede
 *    canjear el code del email de confirmacion.
 *  - `detectSessionInUrl` solo en `/cuenta*` (confirmacion de email); el cliente admin queda
 *    en `false` en esas rutas (ver supabaseClient.ts, H5).
 *
 * Se crea con la misma URL/anon key: la autorizacion real vive en RLS y en las RPCs DEFINER.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const STORE_STORAGE_KEY = 'sb-teknergy-store'

export const storeSupabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
    auth: {
        storageKey: STORE_STORAGE_KEY,
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        flowType: 'pkce',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: typeof window !== 'undefined' && isAccountPath(window.location.pathname),
    },
})
