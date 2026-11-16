import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { permissionService, type Permission } from '../services/permissionService';
import { Logger } from '../utils/logger';

/**
 * Permisos efectivos del usuario actual para un recurso puntual de permission_matrix.
 * Reusable entre features (Planilla, etc.) para no repetir el fetch de MainLayout.tsx.
 */
export function usePermission(resource: string): Permission | null {
    const { profile } = useAuthStore();
    const [permission, setPermission] = useState<Permission | null>(null);

    useEffect(() => {
        const fetchPermission = async () => {
            if (!profile?.id || !profile?.tenant_id) return;
            try {
                const perms = await permissionService.getMyPermissions(
                    profile.tenant_id,
                    profile.roles || (profile.role ? [profile.role] : [])
                );
                setPermission(perms.find(p => p.resource === resource) ?? null);
            } catch (error) {
                Logger.error('Error al cargar permiso de recurso', { resource, tenantId: profile.tenant_id }, error);
            }
        };
        fetchPermission();
    }, [profile?.id, profile?.tenant_id, JSON.stringify(profile?.roles), resource]);

    return permission;
}
