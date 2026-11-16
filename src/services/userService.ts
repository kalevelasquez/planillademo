import { supabase } from '../config/supabaseClient';
import { Logger } from '../utils/logger';

export type UserManagementProfile = {
    id: string;
    tenant_id: string;
    email: string;
    full_name: string;
    phone: string | null;
    role: string[];
    is_active: boolean;
    status: 'PENDING' | 'ACTIVE' | 'INACTIVE';
    created_at: string;
    last_login_at: string | null;
};

export type UserAction = 'CREATE_USER' | 'UPDATE_USER' | 'TOGGLE_ACTIVE' | 'RESET_PASSWORD';

export const userService = {
    /**
     * Nombre de un usuario por id (US-QNA-08 CA1, revisión épica por épica) — usado para
     * mostrar "quién" hizo una transición de quincena (enviada_por, aprobada_por, etc.),
     * datos que hoy solo se guardan como UUID.
     */
    async getNombrePorId(id: string): Promise<string | null> {
        const { data, error } = await supabase.from('user_profiles').select('full_name').eq('id', id).single();
        if (error) throw error;
        return data?.full_name ?? null;
    },

    /**
     * Helper para normalizar y aplanar arrays de roles (previene corrupción)
     */
    flattenRoles(roles: any): string[] {
        if (!roles) return [];
        const flat = Array.isArray(roles) ? roles.flat(Infinity) : [roles];
        const normalized = flat
            .map(r => String(r || '').toLowerCase().trim())
            .filter(Boolean);
        return Array.from(new Set(normalized));
    },

    /**
     * Obtiene los perfiles de usuario del tenant actual con soporte para paginación.
     */
    async getUsers(tenantId: string, page?: number, limit?: number): Promise<{ data: UserManagementProfile[]; count: number }> {
        let query = supabase
            .from('user_profiles')
            .select('*', { count: 'exact' })
            .eq('tenant_id', tenantId)
            .order('full_name', { ascending: true });

        if (page && limit) {
            const from = (page - 1) * limit;
            const to = from + limit - 1;
            query = query.range(from, to);
        }

        const { data, error, count } = await query;

        if (error) throw error;

        return {
            data: (data || []).map(u => ({
                ...u,
                role: this.flattenRoles(u.role)
            })) as UserManagementProfile[],
            count: count || 0
        };
    },

    /**
     * Llama a la Edge Function 'manage-users' para operaciones administrativas.
     */
    async manageUser(action: UserAction, payload: any): Promise<{ success: boolean; data?: any; error?: string }> {
        // Obtenemos la sesión actual para asegurar el token más reciente
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
            throw new Error('No hay una sesión activa. Por favor, inicia sesión de nuevo.');
        }

        const { data, error } = await supabase.functions.invoke('manage-users', {
            body: { action, payload },
            headers: {
                Authorization: `Bearer ${session.access_token}`
            }
        });

        if (error) {
            Logger.error(`Error en Edge Function manage-users (${action})`, { action, payload }, error);
            throw error;
        }

        return data;
    },

    /**
     * Helper para crear un usuario.
     */
    async createUser(userData: { email: string; full_name: string; roles: string[]; phone?: string }) {
        return this.manageUser('CREATE_USER', {
            ...userData,
            roles: this.flattenRoles(userData.roles)
        });
    },

    /**
     * Helper para actualizar roles/datos de un usuario.
     */
    async updateUser(userId: string, userData: { full_name?: string; roles?: string[]; phone?: string }) {
        return this.manageUser('UPDATE_USER', {
            id: userId,
            ...userData,
            roles: this.flattenRoles(userData.roles)
        });
    },

    /**
     * Helper para activar/desactivar un usuario (Soft Delete + Ban).
     */
    async toggleUserActive(userId: string, active: boolean) {
        return this.manageUser('TOGGLE_ACTIVE', { id: userId, is_active: active });
    }
};
