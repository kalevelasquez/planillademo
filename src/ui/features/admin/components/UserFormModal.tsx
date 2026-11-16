import React, { useState, useEffect } from 'react';
import { X, User, Shield } from 'lucide-react';
import { Button } from '../../../components/Button';
import { InputField } from '../../../components/InputField';
import { useTranslation } from 'react-i18next';
import type { UserManagementProfile } from '../../../../services/userService';
import { permissionService } from '../../../../services/permissionService';
import { useAuthStore } from '../../../../store/authStore';

interface UserFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: any) => Promise<void>;
    user: UserManagementProfile | null;
    isLoading: boolean;
}

const ROLES_OPTIONS = [
    { value: 'admin', label: 'Administrador' },
    { value: 'supervisor', label: 'Supervisor' },
    { value: 'vendedor', label: 'Vendedor' },
    { value: 'despachador', label: 'Despachador' },
];

export const UserFormModal: React.FC<UserFormModalProps> = ({
    isOpen,
    onClose,
    onSubmit,
    user,
    isLoading
}) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const [formData, setFormData] = useState({
        full_name: '',
        email: '',
        phone: '',
        roles: [] as string[]
    });
    const [availableRoles, setAvailableRoles] = useState<{ value: string, label: string }[]>(ROLES_OPTIONS);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchAvailableRoles = async () => {
            if (!profile?.tenant_id || !isOpen) return;
            try {
                const rolesData = await permissionService.getRoles(profile.tenant_id);
                if (rolesData && rolesData.length > 0) {
                    // Deduplicar por nombre por si la vista trae duplicados
                    const uniqueRolesMap = new Map();
                    rolesData.forEach(r => uniqueRolesMap.set(r.name.toLowerCase(), r));
                    const uniqueRoles = Array.from(uniqueRolesMap.values());

                    setAvailableRoles(uniqueRoles.map(r => ({
                        value: r.name,
                        label: r.name.charAt(0).toUpperCase() + r.name.slice(1)
                    })));
                }
            } catch (err) {
                console.error("Error fetching available roles:", err);
                setAvailableRoles(ROLES_OPTIONS);
            }
        };
        fetchAvailableRoles();
    }, [isOpen, profile?.tenant_id]);

    useEffect(() => {
        if (user) {
            setFormData({
                full_name: user.full_name,
                email: user.email,
                phone: user.phone || '',
                roles: user.role || []
            });
        } else {
            setFormData({
                full_name: '',
                email: '',
                phone: '',
                roles: ['vendedor']
            });
        }
    }, [user, isOpen]);

    if (!isOpen) return null;

    const handleToggleRole = (roleValue: string) => {
        setFormData(prev => ({
            ...prev,
            roles: prev.roles.includes(roleValue)
                ? prev.roles.filter(r => r !== roleValue)
                : [...prev.roles, roleValue]
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.full_name || !formData.email || formData.roles.length === 0) {
            setError('Por favor completa los campos obligatorios y selecciona al menos un rol.');
            return;
        }
        setError(null);
        try {
            await onSubmit(formData);
        } catch (err: any) {
            setError(err.message || 'Error al procesar la solicitud.');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-heading/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-modals w-full max-w-[32rem] min-w-[400px] overflow-hidden border border-border">
                {/* Header */}
                <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-surface/30">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                            <User size={20} />
                        </div>
                        <div>
                            <h3 className="text-lg font-display font-bold text-heading">
                                {user ? t('users.modal_edit') : t('users.modal_create')}
                            </h3>
                            <p className="text-xs text-text-secondary">
                                {user ? 'Actualiza los permisos del usuario' : 'Registra un nuevo integrante al equipo'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-surface rounded-full transition-colors text-text-secondary">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {error && (
                        <div className="p-3 bg-error/10 border border-error/20 rounded-lg text-error text-sm font-medium">
                            {error}
                        </div>
                    )}

                    <InputField
                        label={t('users.input_name')}
                        placeholder="Ej: Juan Pérez"
                        value={formData.full_name}
                        onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                        required
                    />

                    <InputField
                        label={t('users.input_email')}
                        type="email"
                        placeholder="ejemplo@imporfrut.com"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        disabled={!!user} // El email no se edita por regla de auth normal
                        required
                    />

                    <InputField
                        label={t('users.input_phone')}
                        placeholder="7000-0000"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />

                    <div className="space-y-3">
                        <label className="text-sm font-semibold text-heading flex items-center gap-2">
                            <Shield size={16} className="text-primary" />
                            {t('users.input_roles')}
                        </label>
                        <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto p-1">
                            {availableRoles.map(option => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => handleToggleRole(option.value)}
                                    className={`flex items-center justify-center px-4 py-2.5 rounded-xl border-2 text-sm font-medium transition-all
                                        ${formData.roles.includes(option.value)
                                            ? 'bg-primary/5 border-primary text-primary shadow-sm'
                                            : 'bg-white border-border text-text-secondary hover:border-primary/30 hover:text-primary/70'
                                        }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {!user && (
                        <p className="text-[11px] text-text-secondary italic">
                            * Se enviará una invitación por correo con una contraseña temporal.
                        </p>
                    )}

                    <div className="pt-4 flex gap-3">
                        <Button
                            type="button"
                            variant="ghost"
                            className="flex-1"
                            onClick={onClose}
                            disabled={isLoading}
                        >
                            {t('common.cancel')}
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            className="flex-1"
                            isLoading={isLoading}
                        >
                            {t('common.save')}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};
