import { useState, useCallback, useEffect } from 'react';
import { useAuthStore } from '../../../../store/authStore';
import { userService } from '../../../../services/userService';
import type { UserManagementProfile } from '../../../../services/userService';
import { canAssignRole } from '../../../../utils/permissionUtils';
import { Logger } from '../../../../utils/logger';

export function useUserManagement() {
    const { profile } = useAuthStore();
    const [users, setUsers] = useState<UserManagementProfile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isActionInProgress, setIsActionInProgress] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const pageSize = 20;

    // Estados para Modales
    const [isFormModalOpen, setIsFormModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<UserManagementProfile | null>(null);
    const [confirmModalState, setConfirmModalState] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        userId: string | null;
        action: 'ACTIVATE' | 'DEACTIVATE' | null;
    }>({
        isOpen: false,
        title: '',
        message: '',
        userId: null,
        action: null,
    });

    const fetchUsers = useCallback(async (page = 1) => {
        if (!profile?.tenant_id) return;
        setIsLoading(true);
        setError(null);
        try {
            const { data, count } = await userService.getUsers(profile.tenant_id, page, pageSize);
            setUsers(data);
            setTotalCount(count);
            setCurrentPage(page);
        } catch (err: any) {
            Logger.error('Error al cargar lista de usuarios', { tenantId: profile.tenant_id, action: 'fetchUsers' }, err);
            setError('Error al cargar la lista de usuarios.');
        } finally {
            setIsLoading(false);
        }
    }, [profile?.tenant_id]);

    useEffect(() => {
        fetchUsers(1);
    }, [fetchUsers]);

    const handlePageChange = (newPage: number) => {
        fetchUsers(newPage);
    };

    const handleOpenForm = (user: UserManagementProfile | null = null) => {
        setEditingUser(user);
        setIsFormModalOpen(true);
    };

    const handleCloseForm = () => {
        setEditingUser(null);
        setIsFormModalOpen(false);
    };

    const handleSubmitUser = async (data: any) => {
        setIsActionInProgress(true);
        setError(null);
        try {
            // CA4 / CA5 (US-ROL-03): Anti-escalación
            if (!canAssignRole(profile?.role, data.roles)) {
                setError("No puede asignar permisos que no tiene.");
                setIsActionInProgress(false);
                return;
            }

            if (editingUser) {
                await userService.updateUser(editingUser.id, {
                    full_name: data.full_name,
                    roles: data.roles,
                    phone: data.phone
                });
            } else {
                await userService.createUser({
                    email: data.email,
                    full_name: data.full_name,
                    roles: data.roles,
                    phone: data.phone
                });
            }
            await fetchUsers();
            handleCloseForm();
        } catch (err: any) {
            Logger.error('Error al guardar/actualizar usuario', { action: editingUser ? 'updateUser' : 'createUser', editingUserId: editingUser?.id }, err);
            // Capturar errores de backend que puedan contener la misma lógica
            const msg = err.message || '';
            if (msg.includes('hierarchy') || msg.includes('higher role')) {
                setError("No puede asignar permisos que no tiene.");
            } else {
                setError('Error al procesar el usuario.');
            }
            throw err;
        } finally {
            setIsActionInProgress(false);
        }
    };

    const handleToggleStatus = (user: UserManagementProfile) => {
        const isCurrentlyActive = user.is_active;
        setConfirmModalState({
            isOpen: true,
            title: isCurrentlyActive ? '¿Desactivar Usuario?' : '¿Reactivar Usuario?',
            message: isCurrentlyActive
                ? `El usuario ${user.full_name} perderá acceso inmediato al sistema.`
                : `Se restablecerá el acceso para ${user.full_name}.`,
            userId: user.id,
            action: isCurrentlyActive ? 'DEACTIVATE' : 'ACTIVATE',
        });
    };

    const confirmToggleStatus = async () => {
        if (!confirmModalState.userId || !confirmModalState.action) return;

        setIsActionInProgress(true);
        try {
            await userService.toggleUserActive(
                confirmModalState.userId,
                confirmModalState.action === 'ACTIVATE'
            );
            await fetchUsers();
            setConfirmModalState(prev => ({ ...prev, isOpen: false }));
        } catch (err: any) {
            Logger.error('Error al cambiar estado de activación de usuario', { userId: confirmModalState.userId, action: confirmModalState.action }, err);
            setError('Error al cambiar el estado del usuario.');
        } finally {
            setIsActionInProgress(false);
        }
    };

    return {
        users,
        isLoading,
        isActionInProgress,
        error,
        totalCount,
        currentPage,
        pageSize,
        isFormModalOpen,
        editingUser,
        confirmModalState,
        handleOpenForm,
        handleCloseForm,
        handleSubmitUser,
        handleToggleStatus,
        confirmToggleStatus,
        handlePageChange,
        closeConfirmModal: () => setConfirmModalState(prev => ({ ...prev, isOpen: false })),
        refresh: () => fetchUsers(currentPage),
    };
}
