import React, { useState, useEffect } from 'react';
import { tenantService } from '../../../services/tenantService';
import type { Profile } from '../../../services/tenantService';
import { InputField } from '../../components/InputField';
import { Button } from '../../components/Button';
import { Mail, User, Phone, Briefcase, Plus, X, Users, Search, Edit2, Trash2, Send, AlertTriangle, RefreshCw, Clock } from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import { useToast } from '../../../context/ToastContext';
import { ROLES, MESSAGES } from '../../../config/constants';
import { useTranslation } from 'react-i18next';
import { permissionService } from '../../../services/permissionService';
import type { RoleDefinition } from '../../../services/permissionService';

export const TeamView: React.FC = () => {
    const { t } = useTranslation();
    const { profile: currentUser } = useAuthStore();
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Team Data State
    const [employees, setEmployees] = useState<Profile[]>([]);
    const [isLoadingData, setIsLoadingData] = useState(true);

    // Edit Role State
    const [isEditRoleModalOpen, setIsEditRoleModalOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState<Profile | null>(null);
    const [newRole, setNewRole] = useState('');
    const [isUpdatingRole, setIsUpdatingRole] = useState(false);

    // Dynamic Roles state
    const [availableRoles, setAvailableRoles] = useState<RoleDefinition[]>([]);
    const [isLoadingRoles, setIsLoadingRoles] = useState(false);

    // Toast & Delete States
    const { showToast } = useToast();
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [employeeToDelete, setEmployeeToDelete] = useState<Profile | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
    const [employeeToRestore, setEmployeeToRestore] = useState<Profile | null>(null);
    const [isRestoring, setIsRestoring] = useState(false);

    // View roles check
    const isAuthorized = currentUser?.role === ROLES.ADMIN || currentUser?.role === ROLES.SUPERVISOR;
    const isAdmin = currentUser?.role === ROLES.ADMIN;

    // Invite states
    const [email, setEmail] = useState('');
    const [fullName, setFullName] = useState('');
    const [phone, setPhone] = useState('');
    const [role, setRole] = useState('vendedor');

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Fetch Employees Data
    const fetchEmployees = async () => {
        if (!currentUser?.tenant_id) return;
        setIsLoadingData(true);
        try {
            const data = await tenantService.getTenantEmployees(currentUser.tenant_id);
            setEmployees(data);
        } catch (err) {
            console.error('Failed to fetch employees:', err);
        } finally {
            setIsLoadingData(false);
        }
    };

    const fetchRoles = async () => {
        if (!currentUser?.tenant_id) return;
        setIsLoadingRoles(true);
        try {
            const data = await permissionService.getRoles(currentUser.tenant_id);
            setAvailableRoles(data);
        } catch (err) {
            console.error('Failed to fetch roles:', err);
        } finally {
            setIsLoadingRoles(false);
        }
    };

    const formatDate = (date: string | null) => {
        if (!date) return 'N/A';
        return new Intl.DateTimeFormat('es-SV', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(new Date(date));
    };

    useEffect(() => {
        if (isAuthorized) {
            fetchEmployees();
            fetchRoles();
        }
    }, [isAuthorized, currentUser?.tenant_id]);

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let rawValue = e.target.value.replace(/\D/g, '');

        if (rawValue.length > 8) {
            rawValue = rawValue.slice(0, 8);
        }

        let formattedValue = rawValue;
        if (rawValue.length > 4) {
            formattedValue = `${rawValue.slice(0, 4)}-${rawValue.slice(4)}`;
        }

        setPhone(formattedValue);
    };

    const resetForm = () => {
        setEmail('');
        setFullName('');
        setPhone('');
        setRole('vendedor');
        setError(null);
        setSuccessMessage(null);
    };

    const handleOpenModal = () => {
        resetForm();
        setIsModalOpen(true);
    };

    const handleInvite = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        if (isLoading) return;

        setError(null);
        setSuccessMessage(null);

        if (!email || !fullName || !phone) {
            setError(MESSAGES.ERROR.FIELDS_REQUIRED);
            return;
        }

        if (phone.length !== 9) {
            setError(MESSAGES.ERROR.PHONE_8_DIGITS);
            return;
        }

        setIsLoading(true);

        try {
            await tenantService.inviteUserToTenant(email, fullName, phone, role);

            setSuccessMessage(MESSAGES.SUCCESS.INVITATION_SENT(email));

            // Refetch table data to see the new pending user
            fetchEmployees();

            setEmail('');
            setFullName('');
            setPhone('');
            setRole(ROLES.VENDEDOR);

            setTimeout(() => {
                setIsModalOpen(false);
            }, 3000);

        } catch (err: any) {
            console.error('Error enviando invitación:', err);
            setError(err.message || MESSAGES.ERROR.INVITE_SEND);
        } finally {
            setIsLoading(false);
        }
    };

    const handleReinvite = async (employee: Profile) => {
        if (!isAdmin || isLoading) return;
        try {
            await tenantService.inviteUserToTenant(employee.email, employee.full_name, employee.phone, getFirstRole(employee.role));
            showToast(t('team.success_reinvite', { email: employee.email }), 'success');
            fetchEmployees();
        } catch (err: any) {
            console.error('Error re-enviando invitación:', err);
            showToast(err.message || t('common.unknown_error'), 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleOpenEditRoleModal = (employee: Profile) => {
        setEditingEmployee(employee);
        setNewRole(getFirstRole(employee.role));
        setIsEditRoleModalOpen(true);
    };

    const handleUpdateRole = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        if (!isAdmin || !editingEmployee || isUpdatingRole) return;

        // Si no cambio el rol, solo cerramos
        if (newRole === getFirstRole(editingEmployee.role)) {
            setIsEditRoleModalOpen(false);
            return;
        }

        setIsUpdatingRole(true);
        try {
            await tenantService.updateEmployeeRole(editingEmployee.id, newRole);

            // Update local state without fetching again to feel snappier
            setEmployees(prev => prev.map(emp =>
                emp.id === editingEmployee.id ? { ...emp, role: newRole } : emp
            ));

            showToast(t('team.success_role_updated', { name: editingEmployee.full_name }), 'success');
            setIsEditRoleModalOpen(false);
            setEditingEmployee(null);
        } catch (err: any) {
            console.error('Error actualizando rol:', err);
            showToast(err.message || t('common.unknown_error'), 'error');
        } finally {
            setIsUpdatingRole(false);
        }
    };

    const handleDeleteEmployee = async (employee: Profile) => {
        if (!isAdmin) return;

        // Validar que no se está auto-eliminando (seguridad frontend)
        if (employee.id === currentUser?.id) {
            showToast(t('team.error_self_delete'), 'error');
            return;
        }

        setEmployeeToDelete(employee);
        setIsDeleteModalOpen(true);
    };

    const confirmDeleteEmployee = async () => {
        if (!employeeToDelete || isDeleting) return;
        setIsDeleting(true);
        try {
            await tenantService.deleteEmployee(employeeToDelete.id, 'soft-delete');
            showToast(t('team.success_deactivated', { name: employeeToDelete.full_name }), 'success');

            // Set state to DELETED locally
            setEmployees(prev => prev.map(emp => emp.id === employeeToDelete.id ? { ...emp, status: 'DELETED' } : emp));
            setIsDeleteModalOpen(false);
            setEmployeeToDelete(null);
        } catch (err: any) {
            console.error('Error desactivando empleado:', err);
            showToast(err.message || t('common.unknown_error'), 'error');
        } finally {
            setIsDeleting(false);
        }
    };

    const handleRestoreEmployee = (employee: Profile) => {
        if (!isAdmin) return;
        setEmployeeToRestore(employee);
        setIsRestoreModalOpen(true);
    };

    const confirmRestoreEmployee = async () => {
        if (!employeeToRestore || isRestoring) return;
        setIsRestoring(true);
        try {
            await tenantService.deleteEmployee(employeeToRestore.id, 'restore');
            showToast(t('team.success_reactivated', { name: employeeToRestore.full_name }), 'success');

            // Set state to ACTIVE locally
            setEmployees(prev => prev.map(emp => emp.id === employeeToRestore.id ? { ...emp, status: 'ACTIVE' } : emp));
            setIsRestoreModalOpen(false);
            setEmployeeToRestore(null);
        } catch (err: any) {
            console.error('Error reactivando empleado:', err);
            showToast(err.message || t('common.unknown_error'), 'error');
        } finally {
            setIsRestoring(false);
        }
    };

    // Client-side Search and Pagination state
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 10;

    // Filter employees based on search
    const filteredEmployees = employees.filter(emp => {
        // Exclude DELETED users if not Admin
        if (!isAdmin && emp.status === 'DELETED') return false;

        const searchLower = searchTerm.toLowerCase();
        return (
            emp.full_name.toLowerCase().includes(searchLower) ||
            emp.email.toLowerCase().includes(searchLower)
        );
    });

    // Calculate pagination slices
    const totalPages = Math.ceil(filteredEmployees.length / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const currentEmployees = filteredEmployees.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    // Helper to get initials
    const getInitials = (name: string) => {
        const parts = name.split(' ');
        if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
        return name.substring(0, 2).toUpperCase();
    };

    // Helper to color Role Badge
    const getFirstRole = (role: string | string[]) => {
        return Array.isArray(role) ? (role[0] || 'vendedor') : role;
    };

    const getRoleBadgeUI = (userRole: string) => {
        switch (userRole) {
            case ROLES.ADMIN:
                return 'bg-error/10 text-error';
            case ROLES.SUPERVISOR:
                return 'bg-info/10 text-info';
            case ROLES.VENDEDOR:
                return 'bg-primary/20 text-primary-dark';
            case ROLES.DESPACHADOR:
                return 'bg-warning/20 text-warning-dark';
            default:
                // Color neutral para roles personalizados
                return 'bg-surface border border-border text-text-secondary';
        }
    };

    if (!isAuthorized) {
        return (
            <div className="flex flex-col items-center justify-center p-xl min-h-[50vh]">
                <div className="w-16 h-16 bg-error/10 rounded-pill flex items-center justify-center mb-md">
                    <X className="text-error w-8 h-8" />
                </div>
                <h2 className="text-h2 text-heading text-center">{t('team.access_denied_title')}</h2>
                <p className="text-body text-text-secondary text-center mt-xs">
                    {t('team.access_denied_desc')}
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md overflow-hidden">
            {/* Page Header (Desvinculado del Card) */}
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-md border-b border-border pb-md">
                <div className="flex items-center gap-sm min-w-0">
                    <div className="w-10 h-10 md:w-12 md:h-12 bg-primary/10 rounded-lg flex items-center justify-center text-primary shrink-0">
                        <Users size={24} className="w-5 h-5 md:w-6 md:h-6" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-h2 md:text-h1 text-heading truncate">{t('team.header_title')}</h1>
                        <p className="text-caption md:text-body text-text-secondary mt-[2px] truncate">
                            {t('team.header_desc')}
                        </p>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-lg shadow-cards border border-border flex flex-col w-full flex-1 min-h-0 overflow-hidden relative">
                {/* Search Bar Tools Card Header */}
                {(employees.length > 0 || searchTerm) && (
                    <div className="sticky top-0 z-20 bg-surface/80 backdrop-blur-sm border-b border-border p-md flex flex-row gap-sm items-center justify-between animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="relative flex-1 group min-w-0">
                            <Search className="absolute left-md top-1/2 -translate-y-1/2 text-text-secondary w-[18px] h-[18px] group-focus-within:text-primary transition-colors" />
                            <input
                                type="text"
                                placeholder={t('team.search_placeholder')}
                                className="w-full bg-white border border-border rounded-md py-sm pl-10 pr-md text-body focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm transition-all"
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                    setCurrentPage(1); // Reset page on search
                                }}
                            />
                            {searchTerm && (
                                <button onClick={() => { setSearchTerm(''); setCurrentPage(1); }} className="absolute right-md top-1/2 -translate-y-1/2 text-text-secondary hover:text-heading">
                                    <X size={16} />
                                </button>
                            )}
                        </div>
                        {isAdmin && (
                            <Button
                                onClick={handleOpenModal}
                                className="flex items-center justify-center p-sm md:px-md shadow-sm shrink-0 h-[42px] w-auto"
                            >
                                <Plus size={20} className="sm:mr-2" />
                                <span className="hidden sm:inline-block">{t('team.btn_invite')}</span>
                            </Button>
                        )}
                    </div>
                )}

                {/* Content Segment */}
                {isLoadingData ? (
                    <>
                        {/* Mobile Skeleton - Cards */}
                        <div className="grid grid-cols-1 gap-md lg:hidden p-md w-full">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="bg-white rounded-lg shadow-cards border border-border p-md flex flex-col gap-sm animate-pulse">
                                    <div className="flex justify-between items-start gap-md">
                                        <div className="flex gap-2 w-full">
                                            <div className="h-10 w-10 bg-surface rounded-full shrink-0"></div>
                                            <div className="flex flex-col gap-1 w-full">
                                                <div className="h-5 bg-surface rounded w-2/3"></div>
                                                <div className="h-4 bg-surface rounded w-1/3"></div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-xs mt-2">
                                        <div className="h-4 bg-surface rounded w-1/2"></div>
                                        <div className="h-4 bg-surface rounded w-1/3"></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {/* Desktop Skeleton - Table */}
                        <div className="hidden lg:flex flex-col overflow-hidden animate-pulse w-full">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-surface border-b border-border">
                                            <th className="p-md"><div className="h-3 bg-border/50 rounded w-16"></div></th>
                                            <th className="p-md"><div className="h-3 bg-border/50 rounded w-20"></div></th>
                                            <th className="p-md w-40"><div className="h-3 bg-border/50 rounded w-16"></div></th>
                                            <th className="p-md w-44"><div className="h-3 bg-border/50 rounded w-20"></div></th>
                                            {isAdmin && <th className="p-md w-32"><div className="h-3 bg-border/50 rounded w-16 ml-auto"></div></th>}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/50">
                                        {[1, 2, 3, 4, 5].map(i => (
                                            <tr key={i}>
                                                <td className="p-md">
                                                    <div className="flex items-center gap-3">
                                                        <div className="h-10 w-10 bg-surface rounded-full shrink-0"></div>
                                                        <div className="flex flex-col gap-2">
                                                            <div className="h-4 bg-surface rounded w-32"></div>
                                                            <div className="h-3 bg-surface rounded w-24"></div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-md"><div className="h-4 bg-surface rounded w-28"></div></td>
                                                <td className="p-md"><div className="h-4 bg-surface rounded w-24"></div></td>
                                                <td className="p-md"><div className="h-5 bg-surface rounded w-16"></div></td>
                                                {isAdmin && <td className="p-md"><div className="h-8 bg-surface rounded w-20 ml-auto"></div></td>}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                ) : employees.length === 0 ? (
                    <div className="p-xl text-center flex flex-col items-center justify-center min-h-[400px]">
                        <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mb-md">
                            <Users size={32} className="text-text-secondary/50" />
                        </div>
                        <h3 className="text-h3 text-heading">{t('team.no_employees')}</h3>
                        <p className="text-body text-text-secondary mt-xs max-w-[300px]">
                            {t('team.no_employees_desc')}
                        </p>
                        {isAdmin && (
                            <Button
                                variant="secondary"
                                className="mt-md"
                                onClick={handleOpenModal}
                            >
                                {t('team.btn_add_first')}
                            </Button>
                        )}
                    </div>
                ) : filteredEmployees.length === 0 ? (
                    <div className="p-xl text-center flex flex-col items-center justify-center min-h-[400px]">
                        <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mb-md">
                            <Search size={32} className="text-text-secondary/50" />
                        </div>
                        <h3 className="text-h3 text-heading">{t('team.no_results')}</h3>
                        <p className="text-body text-text-secondary mt-xs">
                            {t('team.no_results_desc', { search: searchTerm })}
                        </p>
                        <Button variant="secondary" className="mt-md" onClick={() => { setSearchTerm(''); setCurrentPage(1); }}>
                            {t('team.btn_clear_search')}
                        </Button>
                    </div>
                ) : (
                    <>
                        {/* Mobile View: Cards */}
                        <div className="grid grid-cols-1 gap-md lg:hidden p-md bg-surface/10">
                            {currentEmployees.map(emp => (
                                <div key={emp.id} className={`bg-white rounded-lg shadow-cards border border-border p-md flex flex-col gap-sm ${emp.status === 'DELETED' ? 'opacity-60 grayscale bg-surface/50' : ''}`}>
                                    <div className="flex justify-between items-start gap-md min-w-0">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center text-caption font-bold text-text-secondary shrink-0">
                                                {getInitials(emp.full_name)}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <h3 className="text-h3 font-display text-heading line-clamp-2">{emp.full_name}</h3>
                                                <span className={`inline-flex px-2 py-0.5 mt-1 rounded-sm text-[11px] font-semibold uppercase whitespace-nowrap ${getRoleBadgeUI(getFirstRole(emp.role))}`}>
                                                    {getFirstRole(emp.role)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-xs text-body text-text-secondary mt-2">
                                        <div className="flex items-center gap-xs min-w-0">
                                            <Mail size={16} className="shrink-0" />
                                            <span className="truncate flex-1 min-w-0">{emp.email}</span>
                                        </div>
                                        <div className="flex items-center gap-xs min-w-0">
                                            <Phone size={16} className="shrink-0" />
                                            <span className="truncate flex-1 min-w-0">{emp.phone}</span>
                                        </div>
                                    </div>
                                    <div className="mt-sm pt-sm border-t border-border/50 flex items-center justify-between">
                                        <div>
                                            {emp.status === 'ACTIVE' ? (
                                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium bg-primary/15 text-primary-dark border border-primary/30">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                                                    {t('team.status_active')}
                                                </span>
                                            ) : emp.status === 'DELETED' ? (
                                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium bg-surface text-text-secondary border border-border">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-text-secondary"></span>
                                                    {t('team.status_inactive')}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium bg-warning/15 text-warning-dark border border-warning/30">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-warning"></span>
                                                    {t('team.status_pending')}
                                                </span>
                                            )}
                                        </div>
                                        {isAdmin && (
                                            <div className="flex items-center gap-0">
                                                {emp.status === 'DELETED' ? (
                                                    <Button
                                                        variant="ghost"
                                                        onClick={() => handleRestoreEmployee(emp)}
                                                        className="text-success hover:text-success hover:bg-success/10 h-8 px-2 text-caption flex items-center gap-1 shrink-0"
                                                        title={t('team.action_reactivate')}
                                                    >
                                                        <RefreshCw size={14} /> {t('team.action_reactivate')}
                                                    </Button>
                                                ) : (
                                                    <>
                                                        {emp.status === 'PENDING' && (
                                                            <Button
                                                                variant="ghost"
                                                                onClick={() => handleReinvite(emp)}
                                                                disabled={isLoading}
                                                                className="text-primary hover:text-primary-dark hover:bg-primary/10 h-8 px-2 text-caption flex items-center gap-1 shrink-0"
                                                            >
                                                                <Send size={14} /> {t('team.action_reinvite')}
                                                            </Button>
                                                        )}
                                                        <Button
                                                            variant="ghost"
                                                            onClick={() => handleOpenEditRoleModal(emp)}
                                                            className="text-text-secondary hover:text-heading hover:bg-surface h-8 px-2 text-caption flex items-center gap-1"
                                                        >
                                                            <Edit2 size={14} /> {t('team.action_edit')}
                                                        </Button>
                                                        {emp.id !== currentUser?.id && (
                                                            <Button
                                                                variant="ghost"
                                                                onClick={() => handleDeleteEmployee(emp)}
                                                                className="text-text-secondary hover:text-error hover:bg-error/10 h-8 px-2"
                                                                title={t('team.action_delete')}
                                                            >
                                                                <Trash2 size={14} />
                                                            </Button>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Desktop View: Table */}
                        <div className="hidden lg:flex flex-col overflow-hidden w-full">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse table-fixed">
                                    <thead>
                                        <tr className="bg-surface border-b border-border text-caption text-text-secondary uppercase tracking-wider">
                                            <th className="p-md font-semibold w-[35%] min-w-[250px]">{t('team.table_user')}</th>
                                            <th className="p-md font-semibold w-[15%]">{t('team.table_phone')}</th>
                                            <th className="p-md font-semibold w-[10%] text-center">{t('team.table_role')}</th>
                                            <th className="p-md font-semibold w-[10%] text-center">{t('team.table_status')}</th>
                                            {isAuthorized && <th className="p-md font-semibold w-[15%] text-center">{t('team.table_login')}</th>}
                                            {isAdmin && <th className="p-md font-semibold text-right w-[15%] border-l border-border/10">{t('team.table_actions')}</th>}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/50">
                                        {currentEmployees.map((emp) => (
                                            <tr key={emp.id} className={`hover:bg-surface/50 transition-colors ${emp.status === 'DELETED' ? 'opacity-60 grayscale bg-surface/30' : ''}`}>
                                                <td className="p-md">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center text-caption font-bold text-text-secondary shrink-0">
                                                            {getInitials(emp.full_name)}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="text-body font-medium text-heading truncate">{emp.full_name}</p>
                                                            <p className="text-caption text-text-secondary truncate">{emp.email}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-md text-body text-text truncate max-w-[150px]">
                                                    <div className="flex items-center gap-2">
                                                        <Phone size={14} className="text-text-secondary shrink-0" />
                                                        <span className="truncate">{emp.phone}</span>
                                                    </div>
                                                </td>
                                                <td className="p-md text-center">
                                                    <span className={`px-2 py-1 rounded-sm text-[11px] font-semibold uppercase whitespace-nowrap ${getRoleBadgeUI(getFirstRole(emp.role))}`}>
                                                        {getFirstRole(emp.role)}
                                                    </span>
                                                </td>
                                                <td className="p-md text-center">
                                                    {emp.status === 'ACTIVE' ? (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-primary/15 text-primary-dark border border-primary/30 whitespace-nowrap">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0"></span>
                                                            {t('team.status_active')}
                                                        </span>
                                                    ) : emp.status === 'DELETED' ? (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-surface text-text-secondary border border-border whitespace-nowrap">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-text-secondary shrink-0"></span>
                                                            {t('team.status_inactive')}
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-warning/15 text-warning-dark border border-warning/30 whitespace-nowrap">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0"></span>
                                                            {t('team.status_pending')}
                                                        </span>
                                                    )}
                                                </td>
                                                {isAuthorized && (
                                                    <td className="p-md text-center">
                                                        <div className="flex items-center justify-center gap-1.5 text-xs text-text-secondary whitespace-nowrap">
                                                            <Clock size={12} className="opacity-50" />
                                                            {formatDate(emp.last_login_at)}
                                                        </div>
                                                    </td>
                                                )}
                                                {isAdmin && (
                                                    <td className="p-md text-right">
                                                        <div className="flex items-center justify-end gap-1 flex-nowrap">
                                                            {emp.status === 'DELETED' ? (
                                                                <Button
                                                                    variant="ghost"
                                                                    onClick={() => handleRestoreEmployee(emp)}
                                                                    className="text-success hover:text-success hover:bg-success/10 h-[36px] px-2 shrink-0"
                                                                    title="Reactivar Empleado"
                                                                >
                                                                    <RefreshCw size={16} />
                                                                </Button>
                                                            ) : (
                                                                <>
                                                                    {emp.status === 'PENDING' && (
                                                                        <Button
                                                                            variant="ghost"
                                                                            onClick={() => handleReinvite(emp)}
                                                                            disabled={isLoading}
                                                                            className="text-primary hover:text-primary-dark hover:bg-primary/10 h-[36px] px-2 shrink-0"
                                                                            title={t('team.action_reinvite')}
                                                                        >
                                                                            <Send size={16} />
                                                                        </Button>
                                                                    )}
                                                                    <Button
                                                                        variant="ghost"
                                                                        onClick={() => handleOpenEditRoleModal(emp)}
                                                                        className="text-text-secondary hover:text-heading hover:bg-surface h-[36px] px-2 shrink-0"
                                                                        title={t('team.action_edit')}
                                                                    >
                                                                        <Edit2 size={16} />
                                                                    </Button>
                                                                    {emp.id !== currentUser?.id && (
                                                                        <Button
                                                                            variant="ghost"
                                                                            onClick={() => handleDeleteEmployee(emp)}
                                                                            className="text-text-secondary hover:text-error hover:bg-error/10 h-[36px] px-2 ml-1 shrink-0"
                                                                            title={t('team.action_delete')}
                                                                        >
                                                                            <Trash2 size={16} />
                                                                        </Button>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Pagination Controls */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between bg-surface/50 px-md py-sm border-t border-border mt-auto shrink-0">
                                <Button
                                    variant="ghost"
                                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                    disabled={currentPage === 1}
                                    className="text-text-secondary h-8 px-sm"
                                >
                                    {t('team.pagination_prev')}
                                </Button>
                                <span className="text-caption text-text-secondary">
                                    {t('team.pagination_page', { current: currentPage, total: totalPages })}
                                </span>
                                <Button
                                    variant="ghost"
                                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                    disabled={currentPage === totalPages}
                                    className="text-text-secondary h-8 px-sm"
                                >
                                    {t('team.pagination_next')}
                                </Button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Modal: Invitar Empleado */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-md bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                    <div
                        className="bg-white rounded-lg shadow-modals w-[90vw] md:w-[450px] max-w-full flex flex-col overflow-hidden max-h-[90vh] scale-100 animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header Modal */}
                        <div className="flex justify-between items-center px-lg py-md border-b border-border bg-surface/50">
                            <h2 className="text-h2 text-heading">{t('team.modal_invite_title')}</h2>
                            <button
                                onClick={() => !isLoading && setIsModalOpen(false)}
                                className="p-xs text-text-secondary hover:bg-white hover:text-error rounded-sm transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Body Modal */}
                        <form onSubmit={handleInvite} className="p-lg flex flex-col gap-md overflow-y-auto">

                            <InputField
                                label={t('team.modal_invite_email')}
                                type="email"
                                placeholder={t('auth.email_placeholder')}
                                icon={<Mail size={18} />}
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                disabled={isLoading || !!successMessage}
                                required
                            />

                            <InputField
                                label={t('team.modal_invite_name')}
                                placeholder="Ej: Juan Pérez"
                                icon={<User size={18} />}
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                disabled={isLoading || !!successMessage}
                                required
                            />

                            <div className="flex flex-col gap-xs">
                                <label className="text-overline text-text-secondary uppercase">
                                    {t('team.modal_invite_phone')}
                                </label>
                                <div className="flex w-full items-stretch border-1.5 border-border rounded-sm focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15 transition-all bg-white overflow-hidden">
                                    <div className="flex items-center justify-center bg-surface px-md border-r border-border gap-sm select-none">
                                        <Phone size={18} className="text-text-secondary" />
                                        <span className="text-body font-medium text-text-secondary">+503</span>
                                    </div>
                                    <input
                                        type="tel"
                                        className="w-full px-md py-sm text-body transition-all outline-none placeholder:text-text-secondary/50"
                                        placeholder="XXXX-XXXX"
                                        value={phone}
                                        onChange={handlePhoneChange}
                                        disabled={isLoading || !!successMessage}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col gap-xs mt-xs">
                                <label className="text-overline text-text-secondary uppercase">
                                    {t('team.modal_invite_role')}
                                </label>
                                <div className="relative">
                                    <div className="absolute left-md top-1/2 -translate-y-1/2 text-text-secondary">
                                        <Briefcase size={18} />
                                    </div>
                                    <select
                                        className="w-full bg-white border-1.5 border-border rounded-sm pl-[44px] pr-md py-sm text-body focus:border-primary focus:ring-4 focus:ring-primary/15 outline-none transition-all"
                                        value={role}
                                        onChange={(e) => setRole(e.target.value)}
                                        disabled={isLoading || isLoadingRoles || !!successMessage}
                                    >
                                        {availableRoles.length > 0 ? (
                                            availableRoles.map(r => (
                                                <option key={r.id} value={r.name}>
                                                    {r.is_system ? t(`team.role_${r.name}` as any) : r.name.charAt(0).toUpperCase() + r.name.slice(1)}
                                                </option>
                                            ))
                                        ) : (
                                            <>
                                                <option value={ROLES.VENDEDOR}>{t('team.role_vendedor')}</option>
                                                <option value={ROLES.DESPACHADOR}>{t('team.role_despachador')}</option>
                                                {currentUser?.role === ROLES.ADMIN && (
                                                    <option value={ROLES.SUPERVISOR}>{t('team.role_supervisor')}</option>
                                                )}
                                                {currentUser?.role === ROLES.ADMIN && (
                                                    <option value={ROLES.ADMIN}>{t('team.role_admin')}</option>
                                                )}
                                            </>
                                        )}
                                    </select>
                                </div>
                            </div>

                            {/* Alertas */}
                            {error && (
                                <div className="p-sm bg-error/10 border border-error/20 rounded-sm text-error text-caption font-medium flex items-center gap-2">
                                    <X size={16} className="shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}

                            {successMessage && (
                                <div className="p-sm bg-primary/10 border border-primary/20 rounded-sm text-primary-dark text-caption font-medium animate-in fade-in flex items-center gap-2">
                                    <span>{successMessage}</span>
                                </div>
                            )}

                            {/* Footer / Actions */}
                            <div className="mt-md flex justify-end gap-sm pt-sm border-t border-border">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => !isLoading && setIsModalOpen(false)}
                                    disabled={isLoading}
                                >
                                    {t('team.modal_invite_close')}
                                </Button>
                                {!successMessage && (
                                    <Button
                                        type="submit"
                                        isLoading={isLoading}
                                    >
                                        {isLoading ? t('team.modal_invite_sending') : t('team.modal_invite_btn')}
                                    </Button>
                                )}
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal: Cambiar Rol */}
            {isEditRoleModalOpen && editingEmployee && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-md bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                    <div
                        className="bg-white rounded-lg shadow-modals w-[90vw] md:w-[400px] max-w-full flex flex-col overflow-hidden scale-100 animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header Modal */}
                        <div className="flex justify-between items-center px-lg py-md border-b border-border bg-surface/50">
                            <h2 className="text-h2 text-heading flex items-center gap-2">
                                <Briefcase size={20} className="text-primary" />
                                {t('team.modal_edit_title')}
                            </h2>
                            <button
                                onClick={() => !isUpdatingRole && setIsEditRoleModalOpen(false)}
                                className="p-xs text-text-secondary hover:bg-white hover:text-error rounded-sm transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Body Modal */}
                        <form onSubmit={handleUpdateRole} className="p-lg flex flex-col gap-md">
                            <div>
                                <p className="text-body font-medium text-heading mb-1">{editingEmployee.full_name}</p>
                                <p className="text-caption text-text-secondary">{editingEmployee.email}</p>
                            </div>

                            <div className="flex flex-col gap-xs">
                                <label className="text-overline text-text-secondary uppercase">
                                    {t('team.modal_edit_new_role')}
                                </label>
                                <div className="relative">
                                    <div className="absolute left-md top-1/2 -translate-y-1/2 text-text-secondary">
                                        <Briefcase size={18} />
                                    </div>
                                    <select
                                        className="w-full bg-white border-1.5 border-border rounded-sm pl-[44px] pr-md py-sm text-body focus:border-primary focus:ring-4 focus:ring-primary/15 outline-none transition-all"
                                        value={newRole}
                                        onChange={(e) => setNewRole(e.target.value)}
                                        disabled={isUpdatingRole || isLoadingRoles}
                                    >
                                        {availableRoles.length > 0 ? (
                                            availableRoles.map(r => (
                                                <option key={r.id} value={r.name}>
                                                    {r.is_system ? t(`team.role_${r.name}` as any) : r.name.charAt(0).toUpperCase() + r.name.slice(1)}
                                                </option>
                                            ))
                                        ) : (
                                            <>
                                                <option value={ROLES.VENDEDOR}>Vendedor (Campo)</option>
                                                <option value={ROLES.DESPACHADOR}>Despachador (Bodega)</option>
                                                <option value={ROLES.SUPERVISOR}>Supervisor</option>
                                                <option value={ROLES.ADMIN}>Administrador</option>
                                            </>
                                        )}
                                    </select>
                                </div>
                            </div>

                            {/* Footer / Actions */}
                            <div className="mt-sm flex justify-end gap-sm pt-sm border-t border-border">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => !isUpdatingRole && setIsEditRoleModalOpen(false)}
                                    disabled={isUpdatingRole}
                                >
                                    {t('team.modal_edit_cancel')}
                                </Button>
                                <Button
                                    type="submit"
                                    isLoading={isUpdatingRole}
                                >
                                    {isUpdatingRole ? t('team.modal_edit_saving') : t('team.modal_edit_save')}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal de Confirmación para Eliminar */}
            {isDeleteModalOpen && employeeToDelete && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-md bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                    <div
                        className="bg-white rounded-lg shadow-modals w-[90vw] md:w-[400px] flex flex-col overflow-hidden scale-100 animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-xl flex flex-col items-center text-center gap-md">
                            <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center text-error border border-error/20">
                                <AlertTriangle size={32} />
                            </div>
                            <div>
                                <h3 className="text-h3 text-heading mb-xs">{t('team.modal_delete_title', { name: employeeToDelete.full_name })}</h3>
                                <p className="text-body text-text-secondary">
                                    {t('team.modal_delete_desc')}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-sm p-md border-t border-border bg-surface/30">
                            <Button
                                variant="secondary"
                                className="flex-1"
                                onClick={() => !isDeleting && setIsDeleteModalOpen(false)}
                                disabled={isDeleting}
                            >
                                Cancelar
                            </Button>
                            <Button
                                className="flex-1 bg-error hover:bg-error-dark text-white border-transparent"
                                onClick={confirmDeleteEmployee}
                                isLoading={isDeleting}
                            >
                                {isDeleting ? t('team.modal_delete_deleting') : t('team.modal_delete_btn')}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
            {/* Modal de Confirmación para Reactivar */}
            {isRestoreModalOpen && employeeToRestore && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-md bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                    <div
                        className="bg-white rounded-lg shadow-modals w-[90vw] md:w-[400px] flex flex-col overflow-hidden scale-100 animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-xl flex flex-col items-center text-center gap-md">
                            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center text-success border border-success/20">
                                <RefreshCw size={32} />
                            </div>
                            <div>
                                <h3 className="text-h3 text-heading mb-xs">{t('team.modal_reactivate_title', { name: employeeToRestore.full_name })}</h3>
                                <p className="text-body text-text-secondary">
                                    {t('team.modal_reactivate_desc')}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-sm p-md border-t border-border bg-surface/30">
                            <Button
                                variant="secondary"
                                className="flex-1"
                                onClick={() => !isRestoring && setIsRestoreModalOpen(false)}
                                disabled={isRestoring}
                            >
                                Cancelar
                            </Button>
                            <Button
                                className="flex-1 bg-success hover:bg-success-dark text-white border-transparent"
                                onClick={confirmRestoreEmployee}
                                isLoading={isRestoring}
                            >
                                {isRestoring ? t('team.modal_reactivate_reactivating') : t('team.modal_reactivate_btn')}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
