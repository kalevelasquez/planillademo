import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../../store/authStore';
import { permissionService, type RoleDefinition } from '../../../../services/permissionService';
import { useToast } from '../../../../context/ToastContext';

export const useRoleManagement = () => {
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const [roles, setRoles] = useState<RoleDefinition[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isActionInProgress, setIsActionInProgress] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [isFormModalOpen, setIsFormModalOpen] = useState(false);
    const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
    const [cloneSourceRole, setCloneSourceRole] = useState<string | null>(null);

    const fetchRoles = useCallback(async () => {
        if (!profile?.tenant_id) return;
        setIsLoading(true);
        setError(null);
        try {
            const data = await permissionService.getRoles(profile.tenant_id);
            setRoles(data);
        } catch (err: any) {
            console.error('Error fetching roles:', err);
            setError('No se pudieron cargar los roles.');
        } finally {
            setIsLoading(false);
        }
    }, [profile?.tenant_id]);

    useEffect(() => {
        fetchRoles();
    }, [fetchRoles]);

    const handleSaveRole = async (name: string, description: string) => {
        if (!profile?.tenant_id) return;
        setIsActionInProgress(true);
        try {
            if (editingRole) {
                await permissionService.updateRoleDefinition(profile.tenant_id, editingRole.id, name, description);
                showToast(`Rol ${name} actualizado correctamente.`, 'success');
            } else {
                const newRole = await permissionService.createRole(profile.tenant_id, name, description);

                // Si hay un rol origen para clonar permisos
                if (cloneSourceRole) {
                    await permissionService.clonePermissions(profile.tenant_id, cloneSourceRole, newRole.name);
                    showToast(`Rol ${name} creado y permisos clonados de ${cloneSourceRole}.`, 'success');
                } else {
                    showToast(`Rol ${name} creado exitosamente.`, 'success');
                }
            }

            closeFormModal();
            fetchRoles();
        } catch (err: any) {
            console.error('Error saving role:', err);
            showToast(err.message || 'Error al guardar el rol.', 'error');
        } finally {
            setIsActionInProgress(false);
        }
    };

    const handleDeleteRole = async (roleId: string) => {
        if (!profile?.tenant_id) return;
        setIsActionInProgress(true);
        try {
            await permissionService.deleteRole(profile.tenant_id, roleId);
            showToast('Rol eliminado correctamente.', 'success');
            fetchRoles();
        } catch (err: any) {
            console.error('Error deleting role:', err);
            showToast('No se pudo eliminar el rol.', 'error');
        } finally {
            setIsActionInProgress(false);
        }
    };

    const openCreateModal = (sourceRole: string | null = null) => {
        setCloneSourceRole(sourceRole);
        setEditingRole(null);
        setIsFormModalOpen(true);
    };

    const openEditModal = (role: RoleDefinition) => {
        setEditingRole(role);
        setCloneSourceRole(null);
        setIsFormModalOpen(true);
    };

    const closeFormModal = () => {
        setIsFormModalOpen(false);
        setEditingRole(null);
        setCloneSourceRole(null);
    };

    return {
        roles,
        isLoading,
        isActionInProgress,
        error,
        isFormModalOpen,
        editingRole,
        cloneSourceRole,
        openCreateModal,
        openEditModal,
        closeFormModal,
        handleSaveRole,
        handleDeleteRole,
        refresh: fetchRoles
    };
};
