import type { Session } from '@supabase/supabase-js';
import { storeSupabase } from '../config/storeSupabaseClient';
import { ROUTES } from '../config/storePaths';
import { StoreError, type StoreErrorKey } from './storeService';

/**
 * storeAuthService.ts
 * ─────────────────────────────────────────────────────────────────
 * Auth de CLIENTES de la tienda. Usa SIEMPRE `storeSupabase` (storageKey 'sb-teknergy-store', PKCE),
 * jamas el cliente admin: asi una sesion de cliente y una de personal conviven en el mismo
 * navegador y cerrar una no cierra la otra.
 *
 *  - El signup manda solo datos de contacto en `options.data`; el servidor (trigger 0b) decide el
 *    tenant y crea el `customers`. Nunca se mandan roles ni tenant (el trigger los ignoraria igual).
 *  - Los errores se traducen a claves i18n; el mensaje de GoTrue no llega a la UI.
 *  - `captchaToken` es opcional (v1 sin captcha; ver CaptchaSlot).
 */

interface AuthErrorLike {
    code?: string | null;
    status?: number | null;
    message?: string | null;
}

const has = (e: AuthErrorLike, re: RegExp): boolean => re.test(e.message ?? '');

const toAuthError = (e: AuthErrorLike): StoreError => {
    const code = e.code ?? '';
    let key: StoreErrorKey = 'store.errors.generic';
    if (code === 'invalid_credentials' || has(e, /invalid login credentials/i)) {
        key = 'store.errors.invalid_credentials';
    } else if (code === 'email_not_confirmed' || has(e, /email not confirmed/i)) {
        key = 'store.errors.email_unconfirmed';
    } else if (code === 'signup_disabled' || code === 'email_provider_disabled' || has(e, /signups? not allowed|signups? (are )?disabled/i)) {
        // El signup esta apagado en el dashboard hasta C3: mensaje amable, sin detalles.
        key = 'store.errors.signup_unavailable';
    } else if (code === 'weak_password' || has(e, /password should be/i)) {
        key = 'store.errors.weak_password';
    } else if (code.startsWith('over_') || e.status === 429) {
        key = 'store.errors.rate_limited';
    } else if (code === 'validation_failed' || code === 'email_address_invalid' || has(e, /unable to validate email/i)) {
        key = 'store.errors.invalid_email';
    }
    return new StoreError(key);
};

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export interface StoreSignInInput {
    email: string;
    password: string;
    captchaToken?: string;
}

export async function signInStoreCustomer({ email, password, captchaToken }: StoreSignInInput): Promise<void> {
    try {
        const { error } = await storeSupabase.auth.signInWithPassword({
            email: normalizeEmail(email),
            password,
            ...(captchaToken ? { options: { captchaToken } } : {}),
        });
        if (error) throw toAuthError(error);
    } catch (e) {
        throw e instanceof StoreError ? e : new StoreError('store.errors.generic');
    }
}

export interface StoreSignUpInput {
    email: string;
    password: string;
    fullName: string;
    phone: string;
    address?: string;
    department?: string;
    municipality?: string;
    captchaToken?: string;
}

const compact = (entries: Record<string, string | undefined>): Record<string, string> =>
    Object.fromEntries(
        Object.entries(entries)
            .map(([k, v]) => [k, v?.trim()] as const)
            .filter((entry): entry is readonly [string, string] => !!entry[1]),
    );

/**
 * Registra un cliente. Un email ya registrado resuelve igual que uno nuevo (GoTrue responde de forma
 * ofuscada con `identities` vacio): la UI siempre dice "revisa tu correo" y no revela si existe.
 */
export async function signUpStoreCustomer(input: StoreSignUpInput): Promise<void> {
    try {
        const { error } = await storeSupabase.auth.signUp({
            email: normalizeEmail(input.email),
            password: input.password,
            options: {
                data: compact({
                    full_name: input.fullName,
                    phone: input.phone,
                    address: input.address,
                    department: input.department,
                    municipality: input.municipality,
                }),
                emailRedirectTo: `${window.location.origin}${ROUTES.ACCOUNT}/confirmado`,
                ...(input.captchaToken ? { captchaToken: input.captchaToken } : {}),
            },
        });
        if (error && error.code !== 'user_already_exists') throw toAuthError(error);
    } catch (e) {
        throw e instanceof StoreError ? e : new StoreError('store.errors.generic');
    }
}

/**
 * Cierra SOLO la sesion local de la tienda. `scope: 'local'` no revoca otras sesiones del usuario ni
 * toca el cliente admin. Cualquier fallo se ignora: la UI limpia su estado de todos modos.
 */
export async function signOutStoreCustomer(): Promise<void> {
    try {
        await storeSupabase.auth.signOut({ scope: 'local' });
    } catch {
        /* sin accion: el estado local se limpia igual */
    }
}

export async function getStoreSession(): Promise<Session | null> {
    try {
        const { data } = await storeSupabase.auth.getSession();
        return data?.session ?? null;
    } catch {
        return null;
    }
}

/** Escucha cambios de sesion de la TIENDA. Devuelve la funcion para cancelar la suscripcion. */
export function subscribeStoreAuth(onChange: (session: Session | null) => void): () => void {
    const { data } = storeSupabase.auth.onAuthStateChange((_event, session) => onChange(session ?? null));
    return () => data.subscription.unsubscribe();
}
