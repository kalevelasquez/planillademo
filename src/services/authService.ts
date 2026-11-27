import { supabase } from '../config/supabaseClient';
export { supabase };


export interface UserProfile {
    id: string;
    tenant_id: string;
    role: string; // Para compatibilidad hacia atrás (UI legacy)
    roles: string[]; // US-AUTH-06: Múltiples roles
    full_name: string | null;
    phone: string | null;
    is_active: boolean; // US-AUTH-06: Control de acceso instantáneo
    needs_password_change?: boolean; // De user_metadata
}

import { Logger } from '../utils/logger';
import { getFriendlyError } from '../utils/errorMapper';
import { withTimeout } from '../utils/networkUtils';

export const authService = {
    /**
     * Inicia sesión con email y contraseña.
     * La lógica de RLS en base de datos asegura el aislamiento una vez autenticado.
     */
    async login(email: string, pass: string): Promise<{ profile: UserProfile } | null> {
        try {
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email,
                password: pass,
            });

            if (authError) {
                Logger.warn('Fallo de inicio de sesión', { email, action: 'login' }, authError);

                const { friendlyMessage } = getFriendlyError(authError);
                throw new Error(friendlyMessage);
            }

            if (authData.user) {
                // Obtenemos el perfil del usuario para tener tenant_id y rol a mano en el cliente
                const { data: profile, error: profileError } = await supabase
                    .from('user_profiles')
                    .select('*')
                    .eq('id', authData.user.id)
                    .single();

                if (profileError) {
                    Logger.error('Perfil no encontrado tras login exitoso (Inconsistencia)', {
                        userId: authData.user.id,
                        email,
                        action: 'login_check_profile'
                    }, profileError);

                    await supabase.auth.signOut();
                    throw new Error('No se encontró un perfil asociado a este usuario.');
                }

                const rawRoles = (profile as any).role || [];
                const roleArray = Array.isArray(rawRoles) ? rawRoles : [rawRoles];

                const result = {
                    profile: {
                        ...(profile as any),
                        role: roleArray[0] || '',
                        roles: roleArray,
                        needs_password_change: !!authData.user.user_metadata?.needs_password_change
                    } as UserProfile
                };

                Logger.info('Inicio de sesión exitoso', { userId: authData.user.id, action: 'login_success' });
                return result;
            }

            return null;
        } catch (error) {
            throw error;
        }
    },

    async logout() {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                import('./auditService').then(({ auditService }) => {
                    auditService.logAuthEvent('LOGOUT', user.email || '', user.id);
                });
            }
        } catch (err) {
            console.warn('[Auth] Error al auditar logout:', err);
        }
        return await supabase.auth.signOut();
    },

    async getProfile(userId: string): Promise<UserProfile | null> {
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (!profile) return null;

        const rawRoles = (profile as any).role || [];
        const roleArray = Array.isArray(rawRoles) ? rawRoles : [rawRoles];

        return {
            ...(profile as any),
            role: roleArray[0] || '',
            roles: roleArray,
        } as UserProfile;
    },

    async getCurrentSession() {
        try {
            const { data: { session } } = await withTimeout(supabase.auth.getSession(), 5000, 'Fallo al recuperar sesión inicial.');
            if (!session) return null;

            const profile = await withTimeout(this.getProfile(session.user.id), 5000, 'Fallo al cargar perfil inicial.');
            if (profile) {
                return {
                    profile: {
                        ...profile,
                        needs_password_change: !!session.user.user_metadata?.needs_password_change
                    },
                    permissions: [],
                    serverTime: null,
                    session
                };
            }
            return null;
        } catch (error) {
            Logger.error('Fallo controlado en getCurrentSession (Timeout)', { action: 'get_session' }, error);
            throw error;
        }
    },

    /**
     * US-PERF-01: Obtiene perfil y permisos en una sola llamada RPC.
     * Esto elimina el waterfall de peticiones secuenciales.
     */
    async getBootstrapData() {
        // Obtenemos la sesión actual de forma ligera antes del RPC grueso
        const { data: sessionData } = await withTimeout(supabase.auth.getSession(), 5000, 'Error de autenticación (Timeout)');
        const session = sessionData?.session;
        if (!session) return null;

        try {
            // Intentamos la carga consolidada (Velocidad Pro)
            // US-PERF-01: Aumentamos a 15s para redes móviles inestables
            const { data, error } = await withTimeout<{ data: any; error: any }>(
                supabase.rpc('get_bootstrap_data') as any,
                15000,
                'El servidor de datos no responde a tiempo (RPC Bootstrap Timeout).'
            );

            if (error) {
                Logger.warn('Sync: get_bootstrap_data (RPC) falló, intentando fallback tradicional...', { userId: session.user.id, error });
                return this.getCurrentSession();
            }

            // Sin perfil interno (p. ej. un cliente de la tienda web: usuario de auth sin user_profiles)
            // el RPC responde { error: 'Profile not found' }. Es un resultado esperado, no una falla:
            // se devuelve null de forma explicita (antes pasaba por un TypeError accidental + fallback).
            if (!data || data.error || !data.profile) {
                return null;
            }

            const profileRaw = data.profile;
            const rawRoles = profileRaw.roles || profileRaw.role || [];
            const roleArray = Array.isArray(rawRoles) ? rawRoles : [rawRoles];

            return {
                profile: {
                    ...profileRaw,
                    role: roleArray[0] || '',
                    roles: roleArray,
                    needs_password_change: !!session.user.user_metadata?.needs_password_change
                } as UserProfile,
                permissions: (data.permissions || []) as any[],
                serverTime: data.server_time as string,
                session
            };
        } catch (error) {
            // US-OBS-01: Si el RPC falla por Timeout o Red, NO matamos la sesión aún.
            // Intentamos el fallback tradicional (llamadas secuenciales directas a tablas) que suele ser más tolerante.
            Logger.warn('Sync: Fallo crítico o timeout en Bootstrap RPC. Activando modo compatibilidad...', { action: 'bootstrap_fallback' });
            try {
                return await this.getCurrentSession();
            } catch (fallbackError) {
                Logger.error('Sync: Fallo total en sistema de autenticación (RPC y Fallback)', { userId: session.user.id }, fallbackError);
                throw fallbackError;
            }
        }
    }
};
