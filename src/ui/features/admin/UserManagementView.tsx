import React from 'react';
import {
    Users,
    UserPlus,
    Mail,
    Clock,
    Power,
    PowerOff,
    Edit3
} from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { Pagination } from '../../components/Pagination';
import { useTranslation } from 'react-i18next';
import { useUserManagement } from './hooks/useUserManagement';
import { UserFormModal } from './components/UserFormModal';
import { ConfirmModal } from '../../components/ConfirmModal';

const ROLE_COLORS: Record<string, string> = {
    admin: 'bg-error/10 text-error border-error/20',
    supervisor: 'bg-primary/10 text-primary border-primary/20',
    vendedor: 'bg-success/10 text-success border-success/20',
    despachador: 'bg-warning/10 text-warning border-warning/20',
};

export const UserManagementView: React.FC = () => {
    const { t } = useTranslation();
    const {
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
        closeConfirmModal
    } = useUserManagement();

    const totalPages = Math.ceil(totalCount / pageSize);

    const formatDate = (date: string | null) => {
        if (!date) return t('common.not_available');
        return new Intl.DateTimeFormat('es-SV', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(new Date(date));
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-12 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            <PageHeader
                icon={Users}
                title={t('users.header_title')}
                description={t('users.header_desc')}
            />

            <div className="flex justify-end">
                <Button
                    onClick={() => handleOpenForm()}
                    variant="primary"
                    className="shadow-lg shadow-primary/20 h-11 px-6"
                >
                    <UserPlus size={18} className="mr-2" />
                    {t('users.new_user')}
                </Button>
            </div>

            {error && (
                <div className="p-4 bg-error/10 border border-error/20 rounded-xl text-error text-sm font-medium animate-in slide-in-from-top-2">
                    {error}
                </div>
            )}

            <div className="flex flex-col gap-md">
                {/* ════════════════  MOBILE — Lista de Cards  ════════════════ */}
                <div className="flex flex-col gap-md lg:hidden">
                    {isLoading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="bg-white rounded-xl p-md border border-border animate-pulse h-40" />
                        ))
                    ) : users.length === 0 ? (
                        <div className="bg-white rounded-xl p-xl border border-border text-center text-text-secondary opacity-40">
                            <Users size={48} className="mx-auto mb-2" />
                            <p>{t('common.no_results')}</p>
                        </div>
                    ) : (
                        users.map((user) => (
                            <div key={user.id} className="bg-white rounded-xl border border-border shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
                                <div className="p-md pb-sm border-b border-border/50 bg-surface/30">
                                    <div className="flex items-start justify-between gap-3 mb-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-10 h-10 rounded-full bg-white border border-border flex items-center justify-center text-primary font-bold shadow-inner shrink-0 text-md uppercase">
                                                {user.full_name.charAt(0)}
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <span className="text-sm font-bold text-heading truncate">
                                                    {user.full_name}
                                                </span>
                                                <span className="text-[11px] text-text-secondary flex items-center gap-1 truncate opacity-80">
                                                    <Mail size={10} className="shrink-0" />
                                                    {user.email}
                                                </span>
                                                <div className="flex flex-wrap gap-1 mt-1.5">
                                                    {user.role.map((r: string, idx: number) => (
                                                        <span
                                                            key={`${r}-${idx}`}
                                                            className={`text-[9px] uppercase font-black px-1.5 py-0.5 rounded border shadow-xs ${ROLE_COLORS[r] || 'bg-surface text-text-secondary'}`}
                                                        >
                                                            {r}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex gap-1.5 shrink-0">
                                            <button
                                                onClick={() => handleOpenForm(user)}
                                                className="p-1.5 bg-white border border-border rounded-md text-text-secondary hover:text-primary transition-colors shadow-sm active:scale-95"
                                                title="Editar"
                                            >
                                                <Edit3 size={14} />
                                            </button>
                                            <button
                                                onClick={() => handleToggleStatus(user)}
                                                className={`p-1.5 bg-white border border-border rounded-md shadow-sm transition-colors active:scale-95
                                                    ${user.is_active
                                                        ? 'text-text-secondary hover:text-error hover:border-error/30'
                                                        : 'text-text-secondary hover:text-success hover:border-success/30'
                                                    }`}
                                                title={user.is_active ? 'Desactivar' : 'Activar'}
                                            >
                                                {user.is_active ? <PowerOff size={14} /> : <Power size={14} />}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between text-[11px]">
                                        <div className="flex items-center gap-1.5 text-text-secondary opacity-80">
                                            <Clock size={12} className="opacity-50" />
                                            <span>{formatDate(user.last_login_at)}</span>
                                        </div>
                                        <Badge
                                            variant={!user.is_active ? 'error' : (user.status === 'PENDING' ? 'warning' : 'success')}
                                            label={!user.is_active ? t('users.status_inactive').toUpperCase() : (user.status === 'PENDING' ? t('status.pending').toUpperCase() : t('users.status_active').toUpperCase())}
                                            dot={user.is_active && user.status === 'ACTIVE'}
                                            className="h-5 px-1.5 text-[9px]"
                                        />
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* ════════════════  DESKTOP — Tabla  ════════════════ */}
                <div className="hidden lg:block bg-white/70 backdrop-blur-md rounded-2xl shadow-cards border border-border overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-surface/50 border-b border-border">
                                    <th className="px-6 py-4 text-xs font-bold text-text-secondary uppercase tracking-wider">
                                        {t('users.table_name')}
                                    </th>
                                    <th className="px-6 py-4 text-xs font-bold text-text-secondary uppercase tracking-wider">
                                        {t('users.table_role')}
                                    </th>
                                    <th className="px-6 py-4 text-xs font-bold text-text-secondary uppercase tracking-wider">
                                        {t('users.table_status')}
                                    </th>
                                    <th className="px-6 py-4 text-xs font-bold text-text-secondary uppercase tracking-wider">
                                        {t('users.table_login')}
                                    </th>
                                    <th className="px-6 py-4 text-right"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {isLoading ? (
                                    Array.from({ length: 3 }).map((_, i) => (
                                        <tr key={i} className="animate-pulse">
                                            <td colSpan={5} className="px-6 py-8">
                                                <div className="h-4 bg-surface rounded w-3/4 mb-2"></div>
                                                <div className="h-3 bg-surface rounded w-1/2"></div>
                                            </td>
                                        </tr>
                                    ))
                                ) : users.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-20 text-center text-text-secondary">
                                            <div className="flex flex-col items-center gap-2 opacity-40">
                                                <Users size={48} />
                                                <p>{t('common.no_results')}</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    users.map((user) => (
                                        <tr key={user.id} className="hover:bg-primary/5 transition-colors group">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center text-heading font-bold overflow-hidden shadow-inner uppercase">
                                                        {user.full_name.charAt(0)}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-bold text-heading leading-tight italic">
                                                            {user.full_name}
                                                        </span>
                                                        <span className="text-xs text-text-secondary flex items-center gap-1">
                                                            <Mail size={12} className="opacity-60" />
                                                            {user.email}
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-wrap gap-1">
                                                    {user.role.map((r: string, idx: number) => (
                                                        <span
                                                            key={`${r}-${idx}`}
                                                            className={`text-[10px] uppercase font-black px-2 py-0.5 rounded-full border shadow-sm ${ROLE_COLORS[r] || 'bg-surface text-text-secondary'}`}
                                                        >
                                                            {r}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <Badge
                                                    variant={!user.is_active ? 'error' : (user.status === 'PENDING' ? 'warning' : 'success')}
                                                    label={!user.is_active ? t('users.status_inactive').toUpperCase() : (user.status === 'PENDING' ? t('status.pending').toUpperCase() : t('users.status_active').toUpperCase())}
                                                    dot={user.is_active && user.status === 'ACTIVE'}
                                                />
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2 text-xs text-text-secondary">
                                                    <Clock size={14} className="opacity-50" />
                                                    {formatDate(user.last_login_at)}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={() => handleOpenForm(user)}
                                                        className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-border text-text-secondary hover:text-primary transition-all shadow-sm"
                                                        title="Editar"
                                                    >
                                                        <Edit3 size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleToggleStatus(user)}
                                                        className={`p-2 rounded-lg border border-transparent shadow-sm transition-all
                                                            ${user.is_active
                                                                ? 'hover:bg-error/5 hover:border-error/20 text-text-secondary hover:text-error'
                                                                : 'hover:bg-success/5 hover:border-success/20 text-text-secondary hover:text-success'
                                                            }`}
                                                        title={user.is_active ? t('common.cancel').toLowerCase() : t('common.edit').toLowerCase()}
                                                    >
                                                        {user.is_active ? <PowerOff size={16} /> : <Power size={16} />}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {totalPages > 1 && (
                    <div className="bg-white/70 backdrop-blur-md border border-border lg:border-t-0 p-md lg:rounded-b-2xl shadow-cards lg:shadow-none">
                        <Pagination
                            currentPage={currentPage}
                            totalPages={totalPages}
                            totalItems={totalCount}
                            pageSize={pageSize}
                            onPageChange={handlePageChange}
                        />
                    </div>
                )}
            </div>

            {/* Modales */}
            <UserFormModal
                isOpen={isFormModalOpen}
                onClose={handleCloseForm}
                onSubmit={handleSubmitUser}
                user={editingUser}
                isLoading={isActionInProgress}
            />

            <ConfirmModal
                isOpen={confirmModalState.isOpen}
                onClose={closeConfirmModal}
                onConfirm={confirmToggleStatus}
                title={confirmModalState.title}
                message={confirmModalState.message}
                confirmLabel={confirmModalState.action === 'ACTIVATE' ? t('common.save') : t('common.cancel')}
                variant={confirmModalState.action === 'ACTIVATE' ? 'primary' : 'danger'}
                isLoading={isActionInProgress}
                Icon={confirmModalState.action === 'ACTIVATE' ? Power : PowerOff}
            />
        </div>
    );
};
