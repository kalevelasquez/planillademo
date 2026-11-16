import { supabase } from '../config/supabaseClient';
import { Logger } from '../utils/logger';

export interface Permission {
    resource: string;
    can_view: boolean;
    can_create: boolean;
    can_edit: boolean;
    can_delete: boolean;
    can_export: boolean;
    can_approve: boolean;
    view_scope: 'own' | 'team' | 'all';
    edit_scope: 'own' | 'team' | 'all';
    delete_scope: 'own' | 'team' | 'all';
}

export interface RolePermissions {
    role_name: string;
    permissions: Permission[];
}

const SCOPE_ORDER = ['own', 'team', 'all'];

export const permissionService = {
    async getRolePermissions(tenantId: string, roleName: string): Promise<Permission[]> {
        const { data, error } = await supabase
            .from('permission_matrix')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('role_name', roleName);

        if (error) {
            Logger.error('Error al obtener permisos de rol', { tenantId, roleName }, error);
            throw error;
        }
        return data || [];
    },

    async getAllTenantPermissions(tenantId: string): Promise<RolePermissions[]> {
        const { data, error } = await supabase
            .from('permission_matrix')
            .select('*')
            .eq('tenant_id', tenantId);

        if (error) {
            Logger.error('Error al obtener todos los permisos del tenant', { tenantId }, error);
            throw error;
        }

        // Group by role
        const grouped = (data || []).reduce((acc: any, curr: any) => {
            if (!acc[curr.role_name]) acc[curr.role_name] = [];
            acc[curr.role_name].push(curr);
            return acc;
        }, {});

        return Object.keys(grouped).map(role => ({
            role_name: role,
            permissions: grouped[role]
        }));
    },

    async updatePermission(tenantId: string, roleName: string, resource: string, updates: Partial<Permission>) {
        const { error } = await supabase
            .from('permission_matrix')
            .upsert({
                tenant_id: tenantId,
                role_name: roleName,
                resource,
                ...updates,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'tenant_id, role_name, resource'
            });

        if (error) {
            Logger.error('Error al actualizar permiso', { tenantId, roleName, resource }, error);
            throw error;
        }
    },

    /**
     * Calcula la unión de permisos para múltiples roles
     */
    calculateEffectivePermissions(rolesPermissions: Permission[][]): Permission[] {
        if (rolesPermissions.length === 0) return [];

        const resources = Array.from(new Set(rolesPermissions.flat().map(p => p.resource)));

        return resources.map(res => {
            const resPerms = rolesPermissions.map(rp => rp.find(p => p.resource === res)).filter(Boolean) as Permission[];

            return {
                resource: res,
                can_view: resPerms.some(p => p.can_view),
                can_create: resPerms.some(p => p.can_create),
                can_edit: resPerms.some(p => p.can_edit),
                can_delete: resPerms.some(p => p.can_delete),
                can_export: resPerms.some(p => p.can_export),
                can_approve: resPerms.some(p => p.can_approve),
                view_scope: this.getMaxScope(resPerms.map(p => p.view_scope)),
                edit_scope: this.getMaxScope(resPerms.map(p => p.edit_scope)),
                delete_scope: this.getMaxScope(resPerms.map(p => p.delete_scope)),
            };
        });
    },

    getMaxScope(scopes: string[]): 'own' | 'team' | 'all' {
        let maxIdx = 0;
        scopes.forEach(s => {
            const idx = SCOPE_ORDER.indexOf(s);
            if (idx > maxIdx) maxIdx = idx;
        });
        return SCOPE_ORDER[maxIdx] as 'own' | 'team' | 'all';
    },

    async getMyPermissions(tenantId: string, roles: string[]): Promise<Permission[]> {
        if (!roles.length) return [];

        const { data, error } = await supabase
            .from('permission_matrix')
            .select('*')
            .eq('tenant_id', tenantId)
            .in('role_name', roles);

        if (error) {
            Logger.error('Error al recuperar mis permisos', { tenantId, roles }, error);
            throw error;
        }

        // Group by role to use calculateEffectivePermissions
        const rolePermsMap = (data || []).reduce((acc: any, curr: any) => {
            if (!acc[curr.role_name]) acc[curr.role_name] = [];
            acc[curr.role_name].push(curr);
            return acc;
        }, {});

        const rolesPermissions = Object.values(rolePermsMap) as Permission[][];
        return this.calculateEffectivePermissions(rolesPermissions);
    },

    async getRoles(tenantId: string): Promise<RoleDefinition[]> {
        const { data, error } = await supabase
            .from('roles_with_counts')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('is_system', { ascending: false })
            .order('name', { ascending: true });

        if (error) throw error;
        return data || [];
    },

    async createRole(tenantId: string, name: string, description: string): Promise<RoleDefinition> {
        const { data, error } = await supabase
            .from('roles_definition')
            .insert({
                tenant_id: tenantId,
                name: name.toLowerCase().trim(),
                description,
                is_system: false
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async updateRoleDefinition(tenantId: string, roleId: string, name: string, description: string) {
        // Warning: Changing name might break matrix link if we use name as key.
        // We use role_name in matrix. Let's update both if name changes.

        const { data: oldRole } = await supabase
            .from('roles_definition')
            .select('name')
            .eq('id', roleId)
            .single();

        const newName = name.toLowerCase().trim();

        const { error: defError } = await supabase
            .from('roles_definition')
            .update({ name: newName, description, updated_at: new Date().toISOString() })
            .eq('id', roleId)
            .eq('tenant_id', tenantId);

        if (defError) throw defError;

        // If name changed, update permission matrix
        if (oldRole && oldRole.name !== newName) {
            const { error: matrixError } = await supabase
                .from('permission_matrix')
                .update({ role_name: newName })
                .eq('tenant_id', tenantId)
                .eq('role_name', oldRole.name);

            if (matrixError) throw matrixError;
        }
    },

    async deleteRole(tenantId: string, roleId: string) {
        // Enforce system role protection via RLS but also in service logic
        const { error } = await supabase
            .from('roles_definition')
            .delete()
            .eq('id', roleId)
            .eq('tenant_id', tenantId)
            .eq('is_system', false);

        if (error) throw error;
    },

    async clonePermissions(tenantId: string, sourceRole: string, targetRole: string) {
        const sourcePerms = await this.getRolePermissions(tenantId, sourceRole);

        if (sourcePerms.length === 0) return;

        const insertData = sourcePerms.map(p => ({
            tenant_id: tenantId,
            role_name: targetRole,
            resource: p.resource,
            can_view: p.can_view,
            can_create: p.can_create,
            can_edit: p.can_edit,
            can_delete: p.can_delete,
            can_export: p.can_export,
            can_approve: p.can_approve,
            view_scope: p.view_scope,
            edit_scope: p.edit_scope,
            delete_scope: p.delete_scope
        }));

        const { error } = await supabase
            .from('permission_matrix')
            .insert(insertData);

        if (error) throw error;
    }
};

export interface RoleDefinition {
    id: string;
    tenant_id: string;
    name: string;
    description: string;
    is_system: boolean;
    user_count: number;
    created_at: string;
}
