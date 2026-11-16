import { supabase } from '../config/supabaseClient';
import { Logger } from '../utils/logger';

export interface Profile {
    id: string;
    full_name: string;
    email: string;
    phone: string;
    role: string | string[]; // Adaptado para multi-roles
    status?: string;
    created_at: string;
    last_login_at: string | null;
}

export const tenantService = {
    async inviteUserToTenant(email: string, fullName: string, phone: string, role: string) {
        // En base a la firma del Edge Function
        const { data, error } = await supabase.functions.invoke('invite-employee', {
            body: { email, full_name: fullName, phone, role }
        });

        if (error) {
            throw new Error(error.message || 'Error crítico invocando la función.');
        }

        // El Edge Function devuelve status 400 u otros con un objeto JSON { error: ..., message: ... }
        if (data?.error) {
            throw new Error(data.message || 'Falló la invitación del empleado.');
        }

        return data; // { success: true, message: ..., user_id: ... }
    },

    async getTenantEmployees(tenantId: string): Promise<Profile[]> {
        const { data, error } = await supabase
            .from('user_profiles')
            .select('id, full_name, email, phone, role, status, created_at, last_login_at')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false });

        if (error) {
            Logger.error('Error al obtener empleados del tenant', { tenantId }, error);
            throw new Error(error.message || 'No se pudieron obtener los empleados.');
        }

        return data as Profile[];
    },

    async updateEmployeeRole(userId: string, newRole: string | string[]) {
        // Normalizar a array plano de strings (previene anidamiento accidental)
        const rolesArray = (Array.isArray(newRole) ? newRole.flat(Infinity) : [newRole])
            .map(r => String(r || '').toLowerCase().trim())
            .filter(Boolean);

        const { error } = await supabase
            .from('user_profiles')
            .update({ role: rolesArray })
            .eq('id', userId);

        if (error) {
            Logger.error('Error al actualizar rol de empleado', { userId, rolesArray }, error);
            throw new Error(error.message || 'Error al actualizar el rol del empleado.');
        }

        return true;
    },

    async deleteEmployee(userId: string, action: 'soft-delete' | 'restore' = 'soft-delete') {
        const { data, error } = await supabase.functions.invoke('delete-employee', {
            body: { userId, action }
        });

        if (error) {
            throw new Error(error.message || 'Error invocando la función para gestionar al empleado.');
        }

        if (data?.error) {
            throw new Error(data.error || 'Falló la operación del empleado.');
        }

        return data; // { success: true, message: ... }
    }
};
