import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Shield,
    Plus,
    Copy,
    Settings,
    Trash2,
    Users,
    Lock,
    ShieldAlert,
    History,
    AlertCircle,
    Edit3
} from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { useRoleManagement } from './hooks/useRoleManagement';
import { RoleFormModal } from './components/RoleFormModal';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export const RoleManagementView: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const {
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
        handleDeleteRole
    } = useRoleManagement();

    const [roleToDelete, setRoleToDelete] = useState<{ id: string, name: string } | null>(null);

    const onConfirmDelete = async () => {
        if (!roleToDelete) return;
        await handleDeleteRole(roleToDelete.id);
        setRoleToDelete(null);
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-12 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            <PageHeader
                icon={Shield}
                title={t('roles.header_title')}
                description={t('roles.header_desc')}
            />

            <div className="flex items-center justify-end gap-3 -mt-6">
                <Button
                    variant="ghost"
                    onClick={() => navigate('/administrar/auditoria?resource=roles')}
                    className="hidden sm:flex text-text-secondary hover:text-primary transition-all rounded-xl"
                >
                    <History size={18} className="mr-2" />
                    {t('roles.history')}
                </Button>
                <Button
                    onClick={() => openCreateModal()}
                    variant="primary"
                    className="shadow-lg shadow-primary/20 h-11 px-6 rounded-xl"
                >
                    <Plus size={18} className="mr-2" />
                    {t('roles.new_role')}
                </Button>
            </div>

            {error && (
                <div className="flex items-center gap-3 p-4 bg-error/10 border border-error/20 rounded-xl text-error text-sm font-medium animate-in slide-in-from-top-2">
                    <AlertCircle size={18} />
                    {error}
                </div>
            )}

            {/* Roles Grid or List */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-[200px] bg-white rounded-2xl animate-pulse border border-border"></div>
                    ))
                ) : (
                    roles.length === 0 ? (
                        <div className="col-span-full py-20 flex flex-col items-center justify-center bg-white rounded-2xl border border-dashed border-border text-text-secondary">
                            <ShieldAlert size={48} className="opacity-20 mb-4" />
                            <p className="font-medium">{t('roles.no_roles')}</p>
                        </div>
                    ) : (
                        roles.map((role) => (
                            <div
                                key={role.id}
                                className="group relative bg-white hover:bg-surface/30 rounded-2xl border border-border shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden flex flex-col h-full"
                            >
                                {/* Header Card */}
                                <div className="p-6 pb-4">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-inner ${role.is_system ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success'}`}>
                                            <Lock size={20} />
                                        </div>
                                        <Badge
                                            variant={role.is_system ? 'primary' : 'success'}
                                            label={role.is_system ? t('roles.system') : t('roles.custom')}
                                            className="text-[9px] font-black tracking-widest px-2 py-0.5 rounded-full"
                                        />
                                    </div>

                                    <h3 className="text-h3 font-bold text-heading group-hover:text-primary transition-colors leading-tight capitalize">
                                        {role.name}
                                    </h3>

                                    <p className="text-caption text-text-secondary mt-2 line-clamp-2 min-h-[40px]">
                                        {role.description || t('roles.no_desc')}
                                    </p>
                                </div>

                                {/* Stats & Divider */}
                                <div className="mt-auto px-6 py-4 bg-surface/40 border-t border-border/50 flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-caption font-bold text-text-secondary">
                                        <Users size={14} className="opacity-50" />
                                        <span>{role.user_count} {role.user_count === 1 ? t('roles.user_count') : t('roles.user_count_plural')}</span>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        {/* Actions */}
                                        <button
                                            className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-border text-text-secondary hover:text-primary transition-all shadow-sm"
                                            title={t('roles.action_configure')}
                                            onClick={() => navigate(`/administrar/roles/${role.name}`)}
                                        >
                                            <Settings size={16} />
                                        </button>
                                        <button
                                            className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-border text-text-secondary hover:text-success transition-all shadow-sm"
                                            title={t('roles.action_clone')}
                                            onClick={() => openCreateModal(role.name)}
                                        >
                                            <Copy size={16} />
                                        </button>
                                        {!role.is_system && (
                                            <>
                                                <button
                                                    className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-border text-text-secondary hover:text-primary transition-all shadow-sm"
                                                    title={t('roles.action_edit')}
                                                    onClick={() => openEditModal(role)}
                                                >
                                                    <Edit3 size={16} />
                                                </button>
                                                <button
                                                    className="p-2 hover:bg-error/5 rounded-lg border border-transparent hover:border-error/20 text-text-secondary hover:text-error transition-all shadow-sm"
                                                    title={t('roles.action_delete')}
                                                    onClick={() => setRoleToDelete({ id: role.id, name: role.name })}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    )
                )}
            </div>

            {/* Modals */}
            <RoleFormModal
                isOpen={isFormModalOpen}
                onClose={closeFormModal}
                onSubmit={handleSaveRole}
                isLoading={isActionInProgress}
                cloneSource={cloneSourceRole}
                editingRole={editingRole}
            />

            <ConfirmModal
                isOpen={!!roleToDelete}
                onClose={() => setRoleToDelete(null)}
                onConfirm={onConfirmDelete}
                title={t('roles.delete_title')}
                message={t('roles.delete_msg', { name: roleToDelete?.name })}
                confirmLabel={t('roles.delete_confirm')}
                variant="danger"
                isLoading={isActionInProgress}
                Icon={Trash2}
            />
        </div>
    );
};
