import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Shield, Save, AlertCircle, Info, ChevronRight, Lock, ArrowLeft, CheckSquare } from 'lucide-react';
import { Button } from '../../components/Button';
import { permissionService, type Permission } from '../../../services/permissionService';
import { useAuthStore } from '../../../store/authStore';
import { ROLES } from '../../../config/constants';
import { useToast } from '../../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { useTranslation, Trans } from 'react-i18next';

const RESOURCES = [
    { id: 'pedidos', label: 'Pedidos' },
    { id: 'clientes', label: 'Clientes' },
    { id: 'inventario', label: 'Inventario' },
    { id: 'reportes', label: 'Reportes' },
    { id: 'usuarios', label: 'Usuarios' },
    { id: 'roles', label: 'Roles' },
    { id: 'config', label: 'Configuración' },
    { id: 'auditoria', label: 'Auditoría' },
    { id: 'planilla_empleados', label: 'Planilla' },
];

const ACTIONS = [
    { id: 'can_view', label: 'Ver' },
    { id: 'can_create', label: 'Crear' },
    { id: 'can_edit', label: 'Editar' },
    { id: 'can_delete', label: 'Eliminar' },
    { id: 'can_export', label: 'Exportar' },
    { id: 'can_approve', label: 'Aprobar' },
];

const SCOPES = [
    { value: 'own', label: 'Solo Propios' },
    { value: 'team', label: 'Equipo' },
    { value: 'all', label: 'Todos' },
];

const STANDARD_ROLES = [
    { id: ROLES.ADMIN, label: 'Administrador' },
    { id: ROLES.SUPERVISOR, label: 'Supervisor' },
    { id: ROLES.VENDEDOR, label: 'Vendedor' },
    { id: ROLES.DESPACHADOR, label: 'Despachador' },
];

export const RoleMatrixView: React.FC = () => {
    const { t } = useTranslation();
    const { roleName } = useParams<{ roleName: string }>();
    const navigate = useNavigate();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const [selectedRole, setSelectedRole] = useState<string>(roleName || ROLES.ADMIN);
    const [permissions, setPermissions] = useState<Permission[]>([]);
    const [myPermissions, setMyPermissions] = useState<Permission[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const [showSaveWarning, setShowSaveWarning] = useState(false);
    const isFocusedView = !!roleName;

    const fetchPermissions = useCallback(async () => {
        if (!profile?.tenant_id) return;
        setIsLoading(true);
        try {
            const [data, myData] = await Promise.all([
                permissionService.getRolePermissions(profile.tenant_id, selectedRole),
                permissionService.getMyPermissions(
                    profile.tenant_id,
                    profile.roles || (profile.role ? [profile.role] : [])
                )
            ]);
            setPermissions(data);
            setMyPermissions(myData);
            setHasChanges(false);
        } catch (error) {
            console.error('Error fetching permissions:', error);
            showToast('No se pudieron cargar los permisos.', 'error');
        } finally {
            setIsLoading(false);
        }
    }, [profile?.tenant_id, selectedRole, showToast, profile?.roles, profile?.role]);

    useEffect(() => {
        fetchPermissions();
    }, [fetchPermissions]);

    const handleToggle = (resourceId: string, actionKey: keyof Permission) => {
        setPermissions(prev => {
            const index = prev.findIndex(p => p.resource === resourceId);
            const newPerms = [...prev];

            if (index === -1) {
                const newPerm: any = {
                    resource: resourceId,
                    can_view: false,
                    can_create: false,
                    can_edit: false,
                    can_delete: false,
                    can_export: false,
                    can_approve: false,
                    view_scope: 'own',
                    edit_scope: 'own',
                    delete_scope: 'own',
                };
                newPerm[actionKey] = !newPerm[actionKey];
                newPerms.push(newPerm);
            } else {
                newPerms[index] = {
                    ...newPerms[index],
                    [actionKey]: !newPerms[index][actionKey]
                };
            }
            return newPerms;
        });
        setHasChanges(true);
    };

    const handleToggleRow = (resourceId: string, checked: boolean) => {
        setPermissions(prev => {
            const index = prev.findIndex(p => p.resource === resourceId);
            const newPerms = [...prev];
            const myPerm = myPermissions.find(p => p.resource === resourceId);

            if (index === -1) {
                newPerms.push({
                    resource: resourceId,
                    can_view: !!myPerm?.can_view && checked,
                    can_create: !!myPerm?.can_create && checked,
                    can_edit: !!myPerm?.can_edit && checked,
                    can_delete: !!myPerm?.can_delete && checked,
                    can_export: !!myPerm?.can_export && checked,
                    can_approve: !!myPerm?.can_approve && checked,
                    view_scope: 'own',
                    edit_scope: 'own',
                    delete_scope: 'own',
                } as any);
            } else {
                newPerms[index] = {
                    ...newPerms[index],
                    can_view: !!myPerm?.can_view ? checked : newPerms[index].can_view,
                    can_create: !!myPerm?.can_create ? checked : newPerms[index].can_create,
                    can_edit: !!myPerm?.can_edit ? checked : newPerms[index].can_edit,
                    can_delete: !!myPerm?.can_delete ? checked : newPerms[index].can_delete,
                    can_export: !!myPerm?.can_export ? checked : newPerms[index].can_export,
                    can_approve: !!myPerm?.can_approve ? checked : newPerms[index].can_approve,
                };
            }
            return newPerms;
        });
        setHasChanges(true);
    };

    const handleScopeChange = (resourceId: string, scopeKey: 'view_scope' | 'edit_scope' | 'delete_scope', value: any) => {
        setPermissions(prev => {
            const index = prev.findIndex(p => p.resource === resourceId);
            const newPerms = [...prev];
            if (index !== -1) {
                newPerms[index] = { ...newPerms[index], [scopeKey]: value };
            }
            return newPerms;
        });
        setHasChanges(true);
    };

    const handleSave = async () => {
        if (!profile?.tenant_id) return;
        setIsSaving(true);
        try {
            const promises = permissions.map(p =>
                permissionService.updatePermission(profile.tenant_id, selectedRole, p.resource, p)
            );
            await Promise.all(promises);
            showToast('Permisos actualizados correctamente.', 'success');
            setHasChanges(false);
            setShowSaveWarning(false);
        } catch (error) {
            console.error('Error saving permissions:', error);
            showToast('Error al guardar los permisos.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-12 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            <PageHeader
                icon={Lock}
                title={isFocusedView ? t('matrix.configuring_role', { role: selectedRole.toUpperCase() }) : t('matrix.header_title')}
                description={isFocusedView ? t('matrix.configuring_desc') : t('matrix.header_desc')}
            />

            <div className="flex items-center justify-end gap-3 -mt-6">
                {isFocusedView && (
                    <Button
                        variant="ghost"
                        onClick={() => navigate('/administrar/roles')}
                        className="text-text-secondary hover:text-primary transition-all rounded-xl"
                    >
                        <ArrowLeft size={18} className="mr-2" />
                        {t('matrix.back_to_roles')}
                    </Button>
                )}
                {hasChanges && (
                    <Button
                        variant="primary"
                        onClick={() => setShowSaveWarning(true)}
                        className="shadow-lg shadow-primary/20 h-11 px-6 rounded-xl"
                        isLoading={isSaving}
                    >
                        <Save size={18} className="mr-2" />
                        {t('matrix.save_changes')}
                    </Button>
                )}
            </div>

            <div className={`grid grid-cols-1 ${isFocusedView ? '' : 'lg:grid-cols-4'} gap-lg`}>
                {/* Sidebar: Role Selector (Only if not focused) */}
                {!isFocusedView && (
                    <div className="lg:col-span-1 space-y-md">
                        <div className="bg-white rounded-2xl border border-border shadow-sm p-5">
                            <h3 className="text-overline text-text-secondary mb-4">{t('matrix.select_role')}</h3>
                            <div className="flex flex-col gap-2">
                                {STANDARD_ROLES.map(role => (
                                    <button
                                        key={role.id}
                                        onClick={() => {
                                            if (hasChanges) {
                                                if (confirm(t('matrix.unsaved_changes_confirm'))) {
                                                    setSelectedRole(role.id);
                                                }
                                            } else {
                                                setSelectedRole(role.id);
                                            }
                                        }}
                                        className={`flex items-center justify-between px-4 py-3 rounded-xl transition-all text-left ${selectedRole === role.id
                                            ? 'bg-primary text-white shadow-lg shadow-primary/20'
                                            : 'bg-surface text-text-secondary hover:bg-primary/5 hover:text-primary'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <Shield size={18} opacity={selectedRole === role.id ? 1 : 0.5} />
                                            <span className="font-bold">{t(`status.${role.id.toLowerCase()}` as any, { defaultValue: role.label })}</span>
                                        </div>
                                        {selectedRole === role.id && <ChevronRight size={18} />}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5 flex gap-4 text-primary-dark shadow-inner">
                            <Info size={24} className="shrink-0 text-primary" />
                            <p className="text-caption leading-relaxed font-medium">
                                <Trans i18nKey="matrix.additive_info" components={[<strong key="0" />]} />
                            </p>
                        </div>
                    </div>
                )}

                {/* Main Matrix */}
                <div className={isFocusedView ? 'lg:col-span-4' : 'lg:col-span-3'}>
                    <div className="bg-white rounded-2xl border border-border shadow-cards overflow-hidden">
                        {isLoading ? (
                            <div className="p-24 flex flex-col items-center justify-center gap-4">
                                <div className="w-12 h-12 border-4 border-primary/10 border-t-primary rounded-full animate-spin"></div>
                                <p className="text-body text-text-secondary font-medium animate-pulse">{t('matrix.loading_matrix')}</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-surface/50 border-b border-border">
                                            <th className="p-6 text-overline text-text-secondary w-48">{t('matrix.module_resource')}</th>
                                            <th className="p-6 text-overline text-text-secondary text-center w-24">{t('matrix.action')}</th>
                                            {ACTIONS.map(action => (
                                                <th key={action.id} className="p-6 text-overline text-text-secondary text-center">
                                                    {t(`audit.labels.can_${action.id.replace('can_', '')}` as any, { defaultValue: action.label })}
                                                </th>
                                            ))}
                                            <th className="p-6 text-overline text-text-secondary text-center w-48">{t('matrix.default_scope')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/50">
                                        {RESOURCES.map(resource => {
                                            const perm = permissions.find(p => p.resource === resource.id) || {
                                                resource: resource.id,
                                                can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false, can_approve: false,
                                                view_scope: 'own', edit_scope: 'own', delete_scope: 'own'
                                            };

                                            const allChecked = ACTIONS.every(a => (perm as any)[a.id]);

                                            return (
                                                <tr key={resource.id} className="group hover:bg-primary/[0.02] transition-colors">
                                                    <td className="p-6">
                                                        <span className="text-body font-bold text-heading capitalize block">{t(`matrix.resources.${resource.id}` as any, { defaultValue: resource.label })}</span>
                                                        <span className="text-[10px] text-text-secondary opacity-50 font-mono">{resource.id}</span>
                                                    </td>
                                                    <td className="p-6 text-center">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleToggleRow(resource.id, !allChecked)}
                                                            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${allChecked ? 'bg-primary text-white shadow-sm' : 'bg-surface text-text-secondary hover:bg-border'}`}
                                                            title={t('matrix.select_all_row')}
                                                        >
                                                            <CheckSquare size={16} />
                                                        </button>
                                                    </td>
                                                    {ACTIONS.map(action => {
                                                        const myPerm = myPermissions.find(p => p.resource === resource.id);
                                                        const canIGrant = !!(myPerm as any)?.[action.id];

                                                        return (
                                                            <td key={action.id} className="p-6 text-center">
                                                                <div
                                                                    className="flex justify-center"
                                                                    title={!canIGrant ? t('matrix.delegate_warning') : ""}
                                                                >
                                                                    <label className={`relative inline-flex items-center justify-center ${canIGrant ? 'cursor-pointer' : 'cursor-not-allowed opacity-30 grayscale'}`}>
                                                                        <input
                                                                            type="checkbox"
                                                                            className="sr-only peer"
                                                                            checked={(perm as any)?.[action.id] || false}
                                                                            onChange={() => canIGrant && handleToggle(resource.id, action.id as keyof Permission)}
                                                                            disabled={!canIGrant}
                                                                        />
                                                                        <div className="w-10 h-5 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                                                                    </label>
                                                                </div>
                                                            </td>
                                                        );
                                                    })}
                                                    <td className="p-6">
                                                        <select
                                                            className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-caption font-medium text-heading focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all disabled:opacity-40"
                                                            value={perm.view_scope}
                                                            onChange={(e) => handleScopeChange(resource.id, 'view_scope', e.target.value)}
                                                            disabled={!perm.can_view || !(myPermissions.find(p => p.resource === resource.id)?.can_view)}
                                                        >
                                                            {SCOPES.map(s => (
                                                                <option key={s.value} value={s.value}>{t(`matrix.scopes.${s.value}` as any, { defaultValue: s.label })}</option>
                                                            ))}
                                                        </select>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Save Confirmation Modal */}
            {showSaveWarning && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-heading/60 backdrop-blur-md animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl shadow-modals w-full max-w-[32rem] min-w-[420px] overflow-hidden border border-border p-10 space-y-8 animate-in zoom-in-95 duration-200">
                        <div className="flex flex-col items-center text-center gap-4">
                            <div className="w-20 h-20 rounded-full bg-warning/10 flex items-center justify-center text-warning shadow-inner">
                                <AlertCircle size={40} />
                            </div>
                            <div>
                                <h3 className="text-h2 font-bold text-heading">{t('matrix.confirm_changes_title')}</h3>
                                <p className="text-body text-text-secondary mt-2">
                                    <Trans i18nKey="matrix.confirm_changes_msg" values={{ role: selectedRole }} components={[<strong key="0" />, <span className="text-primary font-bold uppercase" key="2" />]} />
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <Button
                                variant="ghost"
                                className="flex-1 h-12 rounded-xl"
                                onClick={() => setShowSaveWarning(false)}
                                disabled={isSaving}
                            >
                                {t('matrix.review_again')}
                            </Button>
                            <Button
                                variant="primary"
                                className="flex-1 h-12 rounded-xl shadow-lg shadow-primary/20"
                                onClick={handleSave}
                                isLoading={isSaving}
                            >
                                {t('matrix.apply_changes')}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
