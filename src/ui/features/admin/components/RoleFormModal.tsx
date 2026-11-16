import React, { useState, useEffect } from 'react';
import { Shield, X, AlertCircle } from 'lucide-react';
import { Button } from '../../../components/Button';
import { InputField } from '../../../components/InputField';
import type { RoleDefinition } from '../../../../services/permissionService';

interface RoleFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (name: string, description: string) => Promise<void>;
    isLoading: boolean;
    cloneSource: string | null;
    editingRole: RoleDefinition | null;
}

export const RoleFormModal: React.FC<RoleFormModalProps> = ({
    isOpen,
    onClose,
    onSubmit,
    isLoading,
    cloneSource,
    editingRole
}) => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            if (editingRole) {
                setName(editingRole.name);
                setDescription(editingRole.description || '');
            } else if (cloneSource) {
                setName(`${cloneSource}_copy`);
                setDescription(`Clonado de ${cloneSource}`);
            } else {
                setName('');
                setDescription('');
            }
            setError(null);
        }
    }, [isOpen, cloneSource, editingRole]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return setError('El nombre del rol es obligatorio.');

        setError(null);
        try {
            await onSubmit(name, description);
        } catch (err: any) {
            setError(err.message || 'Error al guardar el rol.');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-heading/60 backdrop-blur-md animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-modals w-full max-w-[36rem] min-w-[320px] md:min-w-[480px] overflow-hidden border border-border animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between px-8 py-6 border-b border-border bg-surface/50">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary shadow-inner">
                            <Shield size={24} />
                        </div>
                        <div>
                            <h2 className="text-h2 font-bold text-heading">
                                {editingRole ? `Editar Rol: ${editingRole.name}` : cloneSource ? `Clonar Rol: ${cloneSource}` : 'Crear Nuevo Rol'}
                            </h2>
                            <p className="text-caption text-text-secondary mt-1">
                                {editingRole ? 'Modifica el nombre o descripción del rol.' : cloneSource ? 'Se copiarán todos los permisos del rol original.' : 'Define el nombre y propósito del rol.'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white rounded-full transition-colors text-text-secondary">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-8 space-y-6">
                    {error && (
                        <div className="flex items-center gap-3 p-4 bg-error/10 border border-error/20 rounded-xl text-error text-sm animate-in slide-in-from-top-2">
                            <AlertCircle size={18} />
                            <p className="font-medium">{error}</p>
                        </div>
                    )}

                    <InputField
                        label="Nombre del Rol"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ej. Gerente Regional, Vendedor Junior"
                        required
                        disabled={isLoading}
                    />

                    <div className="flex flex-col gap-1.5">
                        <label className="text-body font-bold text-heading">Descripción</label>
                        <textarea
                            className="bg-surface border border-border rounded-xl px-4 py-3 min-h-[100px] text-body focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-text-secondary/40"
                            placeholder="Escribe una breve descripción del propósito de este rol..."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            disabled={isLoading}
                        />
                    </div>

                    <div className="flex gap-4 pt-4 border-t border-border mt-4">
                        <Button type="button" variant="ghost" onClick={onClose} className="flex-1" disabled={isLoading}>
                            Cancelar
                        </Button>
                        <Button type="submit" variant="primary" className="flex-1 shadow-lg shadow-primary/20" isLoading={isLoading}>
                            {editingRole ? 'Actualizar Rol' : cloneSource ? 'Clonar y Guardar' : 'Crear Rol'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};
